// OpenAI ChatGPT-Codex-backend adapter (PLAN.md §6a "custom adapter"). Used
// when OAuth mode (a) — token-exchange for a plain `sk-` API key — isn't
// available on the account (issue #11: this is the common case, not the
// exception). Standard OpenAI Responses API request shape, but against
// chatgpt.com/backend-api/codex with the OAuth access_token as bearer and a
// `chatgpt-account-id` header. Full streaming chat is Phase 4 — this module
// only needs a live "Test" call and a model list for Phase 3.
import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4Content,
  LanguageModelV4StreamPart,
} from '@ai-sdk/provider';
import { OPENAI_OAUTH } from '../firstparty.ts';
import type { ModelInfo, ProviderTestResult } from '../types.ts';
import { flattenPrompt, nullUsage, parseSseJsonStream } from './text-prompt.ts';

const TEST_PROMPT = 'Reply with the single word: ok';

const DEFAULT_TEST_MODEL = 'gpt-5.6-terra';

// The Codex backend identifies its caller by this header; the Rust Codex CLI
// sends `codex_cli_rs`. Not an auth gate (issue #15 confirmed the 400s happen
// with or without it), but it's what the backend expects, so send it.
const CODEX_ORIGINATOR = 'codex_cli_rs';

function codexHeaders(accessToken: string, accountId: string | undefined): Record<string, string> {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${accessToken}`,
    ...(accountId ? { 'chatgpt-account-id': accountId } : {}),
    originator: CODEX_ORIGINATOR,
  };
}

/** Body shared by the test call and the LanguageModel adapter. `stream` is
 *  always true — the ChatGPT-account Codex backend hard-rejects non-streaming
 *  requests with `400 {"detail":"Stream must be set to true"}` (issue #15). */
function codexRequestBody(
  model: string,
  instructions: string | undefined,
  input: unknown[],
  extra: Record<string, unknown> = {},
): unknown {
  return {
    model,
    ...(instructions ? { instructions } : {}),
    input,
    tools: null,
    tool_choice: 'auto',
    parallel_tool_calls: true,
    reasoning: null,
    store: false,
    stream: true,
    include: [],
    ...extra,
  };
}

/** Collect the full assistant text from a streamed Codex `/responses` body. */
async function collectStreamedText(body: ReadableStream<Uint8Array>): Promise<string> {
  let text = '';
  for await (const event of parseSseJsonStream(body)) {
    const evt = event as ResponsesStreamEvent;
    if (evt.type === 'response.output_text.delta' && typeof evt.delta === 'string') {
      text += evt.delta;
    } else if (evt.type === 'response.failed') {
      throw new Error('Codex backend reported response.failed');
    }
  }
  return text;
}

export async function codexResponsesTest(
  accessToken: string,
  accountId: string | undefined,
): Promise<ProviderTestResult> {
  const start = Date.now();
  const res = await fetch(`${OPENAI_OAUTH.codexBackendUrl}/responses`, {
    method: 'POST',
    headers: { ...codexHeaders(accessToken, accountId), accept: 'text/event-stream' },
    body: JSON.stringify(
      codexRequestBody(DEFAULT_TEST_MODEL, TEST_PROMPT, [
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: TEST_PROMPT }] },
      ]),
    ),
  });
  if (!res.ok || !res.body) {
    return { ok: false, latencyMs: Date.now() - start, message: `${res.status} ${await res.text()}` };
  }
  try {
    const text = await collectStreamedText(res.body);
    const latencyMs = Date.now() - start;
    if (!text.trim()) return { ok: false, latencyMs, message: 'no text returned by the Codex backend' };
    return { ok: true, latencyMs, message: text.trim() };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/** No public model-listing endpoint for the Codex backend — curated static list
 *  of the models the Codex CLI itself offers. Verified live against a real
 *  ChatGPT-plan account (issue #15): the whole previous `gpt-5.1-codex*` list
 *  is rejected outright, as is every other `*-codex` name. Known to drift —
 *  cross-check against the real Codex CLI's `~/.codex/config.toml` `model`
 *  setting if "not supported when using Codex with a ChatGPT account" 400s
 *  start appearing again. */
export function codexListModels(): ModelInfo[] {
  return [
    { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra' },
    { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' },
  ];
}

// --- LanguageModelV4 adapter (Phase 4 — POST /api/chat's streamText) -------
// Text-only, streamText-focused implementation (see text-prompt.ts's doc
// comment for why tool-calling isn't wired in here). Both entry points
// stream: the ChatGPT-account Codex backend rejects `stream:false` outright
// (issue #15), so there is no non-streaming envelope to parse — only the
// `response.output_text.delta` events collectStreamedText aggregates.
interface ResponsesStreamEvent {
  type: string;
  delta?: string;
}

export interface CodexBackendLanguageModelOptions {
  accessToken: string;
  accountId: string | undefined;
  modelId: string;
}

export class CodexBackendLanguageModel implements LanguageModelV4 {
  readonly specificationVersion = 'v4' as const;
  readonly provider = 'openai-codex-backend';
  readonly modelId: string;
  readonly supportedUrls = {};

  private readonly accessToken: string;
  private readonly accountId: string | undefined;

  constructor(options: CodexBackendLanguageModelOptions) {
    this.accessToken = options.accessToken;
    this.accountId = options.accountId;
    this.modelId = options.modelId;
  }

  private headers(): Record<string, string> {
    return { ...codexHeaders(this.accessToken, this.accountId), accept: 'text/event-stream' };
  }

  private buildRequestBody(options: LanguageModelV4CallOptions): unknown {
    const { system, turns } = flattenPrompt(options.prompt);
    return codexRequestBody(
      this.modelId,
      system,
      turns.map((turn) => ({
        type: 'message',
        role: turn.role,
        content: [{ type: turn.role === 'user' ? 'input_text' : 'output_text', text: turn.text }],
      })),
      {
        ...(options.maxOutputTokens ? { max_output_tokens: options.maxOutputTokens } : {}),
        ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      },
    );
  }

  // NOTE: this streams even though it's the non-streaming entry point. The
  // ChatGPT-account Codex backend rejects `stream:false` outright (issue
  // #15), so the only way to serve a `doGenerate` call is to stream and
  // aggregate the deltas back into one string.
  async doGenerate(options: LanguageModelV4CallOptions) {
    const res = await fetch(`${OPENAI_OAUTH.codexBackendUrl}/responses`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(this.buildRequestBody(options)),
      signal: options.abortSignal ?? null,
    });
    if (!res.ok || !res.body) {
      throw new Error(`Codex backend responses call failed: ${res.status} ${await res.text()}`);
    }
    const text = await collectStreamedText(res.body);
    const content: LanguageModelV4Content[] = text ? [{ type: 'text', text }] : [];
    return {
      content,
      finishReason: { unified: 'stop' as const, raw: undefined },
      usage: nullUsage(),
      warnings: [],
    };
  }

  async doStream(options: LanguageModelV4CallOptions) {
    const res = await fetch(`${OPENAI_OAUTH.codexBackendUrl}/responses`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(this.buildRequestBody(options)),
      signal: options.abortSignal ?? null,
    });
    if (!res.ok || !res.body) {
      throw new Error(`Codex backend responses stream failed: ${res.status} ${await res.text()}`);
    }
    const body = res.body;

    const stream = new ReadableStream<LanguageModelV4StreamPart>({
      async start(controller) {
        controller.enqueue({ type: 'stream-start', warnings: [] });
        controller.enqueue({ type: 'text-start', id: '0' });
        let sawText = false;
        try {
          for await (const event of parseSseJsonStream(body)) {
            const evt = event as ResponsesStreamEvent;
            if (evt.type === 'response.output_text.delta' && typeof evt.delta === 'string') {
              sawText = true;
              controller.enqueue({ type: 'text-delta', id: '0', delta: evt.delta });
            } else if (evt.type === 'response.failed') {
              throw new Error('Codex backend reported response.failed');
            }
          }
          controller.enqueue({ type: 'text-end', id: '0' });
          controller.enqueue({
            type: 'finish',
            finishReason: { unified: sawText ? 'stop' : 'other', raw: undefined },
            usage: nullUsage(),
          });
        } catch (err) {
          controller.enqueue({ type: 'error', error: err instanceof Error ? err.message : String(err) });
        } finally {
          controller.close();
        }
      },
    });

    return { stream };
  }
}
