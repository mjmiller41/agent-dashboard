// Unit tests for CodeAssistLanguageModel with a mocked `fetch` — Google's
// OAuth flow isn't live-testable in this environment (no account, per
// DECISIONS.md "Phase 3"), so this is the only verification available for
// this adapter's request/response parsing (see DECISIONS.md "Phase 4").
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LanguageModelV4CallOptions } from '@ai-sdk/provider';
import { CodeAssistLanguageModel } from './google-code-assist.ts';

function sseChunk(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

function sseBody(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

const baseOptions: LanguageModelV4CallOptions = {
  prompt: [
    { role: 'system', content: 'be terse' },
    { role: 'user', content: [{ type: 'text', text: 'hi' }] },
  ],
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CodeAssistLanguageModel', () => {
  it('doStream: onboards (already-onboarded shortcut), then emits incremental text-delta chunks', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes(':loadCodeAssist')) {
        return new Response(
          JSON.stringify({ currentTier: { id: 'free-tier' }, cloudaicompanionProject: 'proj-123' }),
          { status: 200 },
        );
      }
      if (href.includes(':streamGenerateContent')) {
        return new Response(
          sseBody(
            sseChunk({ response: { candidates: [{ content: { parts: [{ text: 'Hel' }] } }] } }),
            sseChunk({
              response: { candidates: [{ content: { parts: [{ text: 'lo!' }] }, finishReason: 'STOP' }] },
            }),
          ),
          { status: 200, headers: { 'content-type': 'text/event-stream' } },
        );
      }
      throw new Error(`unexpected fetch to ${href}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const model = new CodeAssistLanguageModel({
      accessToken: 'tok',
      projectId: undefined,
      modelId: 'gemini-2.5-flash',
    });
    const { stream } = await model.doStream(baseOptions);
    const parts = [];
    for await (const part of stream as unknown as AsyncIterable<{ type: string; delta?: string }>)
      parts.push(part);

    const deltas = parts.filter((p) => p.type === 'text-delta').map((p) => p.delta);
    expect(deltas).toEqual(['Hel', 'lo!']);
    expect(parts.some((p) => p.type === 'finish')).toBe(true);
  });

  it('doGenerate: returns the full generated text as a single text content part', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request) => {
        const href = String(url);
        if (href.includes(':loadCodeAssist')) {
          return new Response(
            JSON.stringify({ currentTier: { id: 'free-tier' }, cloudaicompanionProject: 'p' }),
            {
              status: 200,
            },
          );
        }
        if (href.includes(':generateContent')) {
          return new Response(
            JSON.stringify({
              response: { candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }] },
            }),
            { status: 200 },
          );
        }
        throw new Error(`unexpected fetch to ${href}`);
      }),
    );

    const model = new CodeAssistLanguageModel({
      accessToken: 'tok',
      projectId: undefined,
      modelId: 'gemini-2.5-flash',
    });
    const result = await model.doGenerate(baseOptions);
    expect(result.content).toEqual([{ type: 'text', text: 'ok' }]);
    expect(result.finishReason.unified).toBe('stop');
  });
});
