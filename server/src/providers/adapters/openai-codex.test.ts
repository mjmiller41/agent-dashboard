// Unit tests for CodexBackendLanguageModel with a mocked `fetch` — the
// ChatGPT OAuth flow isn't live-testable in this environment (no account,
// per DECISIONS.md "Phase 3"), so this is the only verification available
// for this adapter's request/response parsing (see DECISIONS.md "Phase 4").
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LanguageModelV4CallOptions } from '@ai-sdk/provider';
import { CodexBackendLanguageModel } from './openai-codex.ts';

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

describe('CodexBackendLanguageModel', () => {
  it('doStream: emits incremental text-delta chunks from response.output_text.delta events', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            sseBody(
              sseChunk({ type: 'response.output_text.delta', delta: 'Hel' }),
              sseChunk({ type: 'response.output_text.delta', delta: 'lo!' }),
              sseChunk({ type: 'response.completed' }),
            ),
            { status: 200, headers: { 'content-type': 'text/event-stream' } },
          ),
      ),
    );

    const model = new CodexBackendLanguageModel({
      accessToken: 'tok',
      accountId: 'acct',
      modelId: 'gpt-5.1-codex',
    });
    const { stream } = await model.doStream(baseOptions);
    const parts = [];
    for await (const part of stream as unknown as AsyncIterable<{ type: string; delta?: string }>)
      parts.push(part);

    const deltas = parts.filter((p) => p.type === 'text-delta').map((p) => p.delta);
    expect(deltas).toEqual(['Hel', 'lo!']);
    expect(parts.some((p) => p.type === 'finish')).toBe(true);
  });

  it('doStream: surfaces response.failed as an error stream part instead of hanging', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(sseBody(sseChunk({ type: 'response.failed' })), {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
          }),
      ),
    );

    const model = new CodexBackendLanguageModel({
      accessToken: 'tok',
      accountId: undefined,
      modelId: 'gpt-5.1-codex',
    });
    const { stream } = await model.doStream(baseOptions);
    const parts = [];
    for await (const part of stream as unknown as AsyncIterable<{ type: string }>) parts.push(part);
    expect(parts.some((p) => p.type === 'error')).toBe(true);
  });

  it('doGenerate: extracts output_text from a non-streaming Responses API envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }],
            }),
            { status: 200 },
          ),
      ),
    );

    const model = new CodexBackendLanguageModel({
      accessToken: 'tok',
      accountId: undefined,
      modelId: 'gpt-5.1-codex',
    });
    const result = await model.doGenerate(baseOptions);
    expect(result.content).toEqual([{ type: 'text', text: 'ok' }]);
    expect(result.finishReason.unified).toBe('stop');
  });
});
