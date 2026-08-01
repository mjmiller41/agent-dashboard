// Unit tests for CodexBackendLanguageModel with a mocked `fetch`. These
// mocks are now shaped to match what the REAL ChatGPT-account Codex backend
// actually does, verified live in issue #15 — in particular that it only
// ever streams (`stream:false` is rejected with `400 {"detail":"Stream must
// be set to true"}`), so both doStream *and* doGenerate consume SSE. The
// earlier version of this file mocked a non-streaming JSON envelope for
// doGenerate, which the backend never returns; that fiction is exactly why
// the stale `stream:false` bug survived Phase 3/4 unnoticed.
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
      modelId: 'gpt-5.6-terra',
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
      modelId: 'gpt-5.6-terra',
    });
    const { stream } = await model.doStream(baseOptions);
    const parts = [];
    for await (const part of stream as unknown as AsyncIterable<{ type: string }>) parts.push(part);
    expect(parts.some((p) => p.type === 'error')).toBe(true);
  });

  it('doGenerate: aggregates streamed deltas into one text part', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            sseBody(
              sseChunk({ type: 'response.output_text.delta', delta: 'o' }),
              sseChunk({ type: 'response.output_text.delta', delta: 'k' }),
              sseChunk({ type: 'response.completed' }),
            ),
            { status: 200, headers: { 'content-type': 'text/event-stream' } },
          ),
      ),
    );

    const model = new CodexBackendLanguageModel({
      accessToken: 'tok',
      accountId: undefined,
      modelId: 'gpt-5.6-terra',
    });
    const result = await model.doGenerate(baseOptions);
    expect(result.content).toEqual([{ type: 'text', text: 'ok' }]);
    expect(result.finishReason.unified).toBe('stop');
  });

  // Regression guard for issue #15: the backend hard-rejects stream:false,
  // so every request this adapter builds must set stream:true.
  it('always sends stream:true — the backend rejects non-streaming requests', async () => {
    const fetchMock = vi.fn(async (...[, init]: [string | URL | Request, RequestInit?]) => {
      void init;
      return new Response(sseBody(sseChunk({ type: 'response.completed' })), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const model = new CodexBackendLanguageModel({
      accessToken: 'tok',
      accountId: 'acct',
      modelId: 'gpt-5.6-terra',
    });
    await model.doGenerate(baseOptions);
    await model.doStream(baseOptions);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchMock.mock.calls) {
      expect(JSON.parse(init?.body as string).stream).toBe(true);
      expect((init?.headers as Record<string, string>).originator).toBe('codex_cli_rs');
    }
  });
});
