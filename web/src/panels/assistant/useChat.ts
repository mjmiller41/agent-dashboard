// Hand-rolled client for POST /api/chat's AI SDK UI-message SSE stream
// (PLAN.md §2: hand-rolled SSE handling, same ethos as sse.ts — no `ai/react`
// dependency). Parses `data: {...}\n\n` frames directly off the fetch
// response body, same protocol shape streamed by `toUIMessageStreamResponse`
// server-side (see server/src/routes/chat.ts).
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatUiMessage, ToolCallInfo } from './types';

export interface UseChatOptions {
  providerId: string | null;
  model: string | null;
  workspaceTools: boolean;
}

export interface UseChatResult {
  messages: ChatUiMessage[];
  send: (text: string) => Promise<void>;
  stop: () => void;
  streaming: boolean;
  error: string | null;
  clear: () => void;
}

interface UiMessageChunk {
  type: string;
  delta?: string;
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Math.random().toString(36).slice(2)}`;
}

function upsertToolCall(toolCalls: ToolCallInfo[], id: string, patch: Partial<ToolCallInfo>): ToolCallInfo[] {
  const index = toolCalls.findIndex((tc) => tc.id === id);
  if (index === -1) {
    return [...toolCalls, { id, toolName: patch.toolName ?? 'unknown', status: 'running', ...patch }];
  }
  const next = toolCalls.slice();
  next[index] = { ...next[index]!, ...patch };
  return next;
}

async function parseErrorBody(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error ?? `request failed: ${res.status}`;
  } catch {
    return `request failed: ${res.status}`;
  }
}

export function useChat({ providerId, model, workspaceTools }: UseChatOptions): UseChatResult {
  const [messages, setMessages] = useState<ChatUiMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const messagesRef = useRef<ChatUiMessage[]>(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const abortRef = useRef<AbortController | null>(null);
  const conversationIdRef = useRef<string>(newId());

  const applyChunk = useCallback((assistantId: string, chunk: UiMessageChunk) => {
    if (chunk.type === 'error') {
      setError(chunk.errorText ?? 'The assistant stream reported an error.');
      return;
    }
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== assistantId) return m;
        switch (chunk.type) {
          case 'text-delta':
            return { ...m, content: m.content + (chunk.delta ?? '') };
          case 'tool-input-available':
            return {
              ...m,
              toolCalls: upsertToolCall(m.toolCalls, chunk.toolCallId ?? newId(), {
                ...(chunk.toolName !== undefined ? { toolName: chunk.toolName } : {}),
                input: chunk.input,
                status: 'running',
              }),
            };
          case 'tool-output-available':
            return {
              ...m,
              toolCalls: upsertToolCall(m.toolCalls, chunk.toolCallId ?? newId(), {
                output: chunk.output,
                status: 'done',
              }),
            };
          case 'tool-output-error':
          case 'tool-input-error':
            return {
              ...m,
              toolCalls: upsertToolCall(m.toolCalls, chunk.toolCallId ?? newId(), {
                status: 'error',
                ...(chunk.errorText !== undefined ? { errorText: chunk.errorText } : {}),
              }),
            };
          default:
            return m;
        }
      }),
    );
  }, []);

  const send = useCallback(
    async (text: string) => {
      if (!providerId || !model || streaming) return;
      setError(null);

      const userMessage: ChatUiMessage = { id: newId(), role: 'user', content: text, toolCalls: [] };
      const assistantId = newId();
      const assistantMessage: ChatUiMessage = {
        id: assistantId,
        role: 'assistant',
        content: '',
        toolCalls: [],
      };
      const requestMessages = [...messagesRef.current, userMessage].map((m) => ({
        role: m.role,
        content: m.content,
      }));

      setMessages((prev) => [...prev, userMessage, assistantMessage]);
      setStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            providerId,
            model,
            messages: requestMessages,
            workspaceTools,
            conversationId: conversationIdRef.current,
          }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) throw new Error(await parseErrorBody(res));

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split('\n\n');
          buffer = frames.pop() ?? '';
          for (const frame of frames) {
            for (const line of frame.split('\n')) {
              const trimmed = line.trim();
              if (!trimmed.startsWith('data:')) continue;
              const payload = trimmed.slice(5).trim();
              if (!payload || payload === '[DONE]') continue;
              try {
                applyChunk(assistantId, JSON.parse(payload) as UiMessageChunk);
              } catch {
                // malformed frame — skip it, the stream continues
              }
            }
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          // user-initiated stop — not an error condition
        } else {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [providerId, model, workspaceTools, streaming, applyChunk],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const clear = useCallback(() => {
    setMessages([]);
    setError(null);
    conversationIdRef.current = newId();
  }, []);

  return { messages, send, stop, streaming, error, clear };
}
