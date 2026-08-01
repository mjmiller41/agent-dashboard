// One chat bubble: markdown-rendered assistant text (marked + DOMPurify,
// PLAN.md §2/§12 guardrail 4 — never render unvalidated HTML unsanitized)
// plus collapsible tool-call rows, e.g. "used write_workspace_file:
// sprints.json" (PLAN.md §6 "tool-call visibility").
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { useMemo } from 'react';
import type { ChatUiMessage, ToolCallInfo } from './types';

function renderMarkdown(content: string): string {
  const raw = marked.parse(content, { async: false, breaks: true }) as string;
  return DOMPurify.sanitize(raw);
}

function summarizeInput(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const record = input as Record<string, unknown>;
  if (typeof record.path === 'string') return record.path;
  if (typeof record.taskId === 'string') return record.taskId;
  if (typeof record.agentId === 'string') return record.agentId;
  return '';
}

function ToolCallRow({ toolCall }: { toolCall: ToolCallInfo }) {
  const summary = summarizeInput(toolCall.input);
  const label = `used ${toolCall.toolName}${summary ? `: ${summary}` : ''}`;
  const statusLabel =
    toolCall.status === 'running' ? ' (running…)' : toolCall.status === 'error' ? ' (failed)' : '';

  return (
    <details className={`tool-call-row tool-call-row--${toolCall.status}`}>
      <summary>
        {label}
        {statusLabel}
      </summary>
      {toolCall.input !== undefined && (
        <div className="tool-call-row__section">
          <strong>input</strong>
          <pre>{JSON.stringify(toolCall.input, null, 2)}</pre>
        </div>
      )}
      {toolCall.output !== undefined && (
        <div className="tool-call-row__section">
          <strong>output</strong>
          <pre>{JSON.stringify(toolCall.output, null, 2)}</pre>
        </div>
      )}
      {toolCall.errorText && (
        <div className="tool-call-row__section tool-call-row__section--error">
          <strong>error</strong>
          <pre>{toolCall.errorText}</pre>
        </div>
      )}
    </details>
  );
}

export function ChatMessage({ message }: { message: ChatUiMessage }) {
  const html = useMemo(
    () => (message.role === 'assistant' ? renderMarkdown(message.content || '…') : null),
    [message.role, message.content],
  );

  return (
    <div className={`chat-message chat-message--${message.role}`}>
      <div className="chat-message__role">{message.role === 'user' ? 'You' : 'Assistant'}</div>
      {message.toolCalls.length > 0 && (
        <div className="chat-message__tool-calls">
          {message.toolCalls.map((tc) => (
            <ToolCallRow key={tc.id} toolCall={tc} />
          ))}
        </div>
      )}
      {message.role === 'assistant' ? (
        // Sanitized via DOMPurify in renderMarkdown() above — PLAN.md §12 guardrail 4.
        <div className="chat-message__content" dangerouslySetInnerHTML={{ __html: html ?? '' }} />
      ) : (
        <div className="chat-message__content chat-message__content--plain">{message.content}</div>
      )}
    </div>
  );
}
