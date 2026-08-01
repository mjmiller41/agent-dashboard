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

const DEFAULT_TEST_MODEL = 'gpt-5.1-codex';

export async function codexResponsesTest(
  accessToken: string,
  accountId: string | undefined,
): Promise<ProviderTestResult> {
  const start = Date.now();
  const res = await fetch(`${OPENAI_OAUTH.codexBackendUrl}/responses`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken}`,
      ...(accountId ? { 'chatgpt-account-id': accountId } : {}),
    },
    body: JSON.stringify({
      model: DEFAULT_TEST_MODEL,
      instructions: 'Reply with the single word: ok',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'Reply with the single word: ok' }],
        },
      ],
      tools: null,
      tool_choice: 'auto',
      parallel_tool_calls: true,
      reasoning: null,
      store: false,
      stream: false,
      include: [],
    }),
  });
  const latencyMs = Date.now() - start;
  if (!res.ok) return { ok: false, latencyMs, message: `${res.status} ${await res.text()}` };
  return { ok: true, latencyMs };
}

/** No public model-listing endpoint for the Codex backend — curated static list
 *  of the models the Codex CLI itself offers. See DECISIONS.md "Phase 3". */
export function codexListModels(): ModelInfo[] {
  return [
    { id: 'gpt-5.1-codex', name: 'GPT-5.1 Codex' },
    { id: 'gpt-5.1-codex-mini', name: 'GPT-5.1 Codex mini' },
  ];
}

// --- LanguageModelV4 adapter (Phase 4 — POST /api/chat's streamText) -------
// Text-only, streamText-focused implementation (see text-prompt.ts's doc
// comment for why tool-calling isn't wired in here). OpenAI's ChatGPT OAuth
// flow isn't live-testable in this environment (no account, per
// DECISIONS.md Phase 3) so this is verified via unit tests with a mocked
// `fetch` only — not a real Codex backend account.
interface ResponsesOutputTextPart {
  type: string;
  text?: string;
}
interface ResponsesOutputItem {
  type: string;
  content?: ResponsesOutputTextPart[];
}
interface ResponsesEnvelope {
  output?: ResponsesOutputItem[];
}

function extractResponsesText(envelope: ResponsesEnvelope): string {
  const message = envelope.output?.find((item) => item.type === 'message');
  return (message?.content ?? [])
    .filter((part) => part.type === 'output_text' && typeof part.text === 'string')
    .map((part) => part.text ?? '')
    .join('');
}

interface ResponsesStreamEvent {
  type: string;
  delta?: string;
  response?: ResponsesEnvelope;
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
    return {
      'content-type': 'application/json',
      authorization: `Bearer ${this.accessToken}`,
      ...(this.accountId ? { 'chatgpt-account-id': this.accountId } : {}),
    };
  }

  private buildRequestBody(options: LanguageModelV4CallOptions, stream: boolean): unknown {
    const { system, turns } = flattenPrompt(options.prompt);
    return {
      model: this.modelId,
      ...(system ? { instructions: system } : {}),
      input: turns.map((turn) => ({
        type: 'message',
        role: turn.role,
        content: [{ type: turn.role === 'user' ? 'input_text' : 'output_text', text: turn.text }],
      })),
      tools: null,
      tool_choice: 'auto',
      parallel_tool_calls: true,
      reasoning: null,
      store: false,
      stream,
      include: [],
      ...(options.maxOutputTokens ? { max_output_tokens: options.maxOutputTokens } : {}),
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    };
  }

  async doGenerate(options: LanguageModelV4CallOptions) {
    const res = await fetch(`${OPENAI_OAUTH.codexBackendUrl}/responses`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(this.buildRequestBody(options, false)),
      signal: options.abortSignal ?? null,
    });
    if (!res.ok) throw new Error(`Codex backend responses call failed: ${res.status} ${await res.text()}`);
    const envelope = (await res.json()) as ResponsesEnvelope;
    const text = extractResponsesText(envelope);
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
      body: JSON.stringify(this.buildRequestBody(options, true)),
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
