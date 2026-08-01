// Shared helper for the two custom LanguageModelV4 adapters (Google Code
// Assist, OpenAI Codex backend). Both are text-only, streamText-only
// adapters (PLAN.md §6a "custom adapter" — see DECISIONS.md "Phase 4" for
// why tool-calling isn't wired into these two: neither OAuth account is
// available to test against, and the Ollama/Custom path already exercises
// the real workspace-tools loop end-to-end). This flattens an AI SDK
// `LanguageModelV4Prompt` down to a plain system string + ordered
// user/assistant text turns, discarding non-text parts (files, tool calls)
// since neither backend call in this file sends anything but text.
import type { LanguageModelV4Prompt } from '@ai-sdk/provider';

export interface TextTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface FlattenedPrompt {
  system: string | undefined;
  turns: TextTurn[];
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((part): part is { type: string; text?: string } => typeof part === 'object' && part !== null)
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('');
}

export function flattenPrompt(prompt: LanguageModelV4Prompt): FlattenedPrompt {
  const systemParts: string[] = [];
  const turns: TextTurn[] = [];
  for (const message of prompt) {
    if (message.role === 'system') {
      systemParts.push(message.content);
      continue;
    }
    if (message.role === 'tool') continue; // not supported by these text-only adapters
    const text = extractText(message.content);
    if (!text) continue;
    turns.push({ role: message.role, text });
  }
  return { system: systemParts.length > 0 ? systemParts.join('\n\n') : undefined, turns };
}

export function nullUsage() {
  return {
    inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: undefined, text: undefined, reasoning: undefined },
  };
}

/** Parse a `data: {...}` SSE-framed response body into decoded JSON events. */
export async function* parseSseJsonStream(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split('\n\n');
      buffer = chunks.pop() ?? '';
      for (const chunk of chunks) {
        for (const line of chunk.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            yield JSON.parse(payload);
          } catch {
            // partial/malformed line — skip it, the stream continues
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
