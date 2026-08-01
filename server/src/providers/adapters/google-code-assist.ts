// Google Code Assist API adapter (PLAN.md §6a "custom adapter"). OAuth'd
// Gemini access does NOT go through the public generativelanguage.googleapis.com
// API — it goes through the Code Assist API used by gemini-cli, which needs
// a loadCodeAssist/onboardUser handshake before any :generateContent call.
// Envelopes ported verbatim from issue #12's research (google-gemini/gemini-cli
// packages/core/src/code_assist/*). Full streaming chat is Phase 4 — this
// module only needs to support a live "Test" call and (a static) model list
// for Phase 3, per the build brief.
import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4Content,
  LanguageModelV4StreamPart,
} from '@ai-sdk/provider';
import { GOOGLE_OAUTH } from '../firstparty.ts';
import type { ModelInfo, ProviderTestResult } from '../types.ts';
import { flattenPrompt, nullUsage, parseSseJsonStream } from './text-prompt.ts';

export class GoogleValidationRequiredError extends Error {
  readonly validationUrl: string;
  constructor(validationUrl: string) {
    super('Google account requires verification before Code Assist can be used');
    this.name = 'GoogleValidationRequiredError';
    this.validationUrl = validationUrl;
  }
}

export class GoogleNumericProjectIdError extends Error {
  constructor() {
    super('GOOGLE_CLOUD_PROJECT must be the string Project ID, not the numeric Project Number');
    this.name = 'GoogleNumericProjectIdError';
  }
}

interface LoadCodeAssistResponse {
  currentTier?: { id: string };
  allowedTiers?: Array<{ id: string; isDefault?: boolean }>;
  ineligibleTiers?: Array<{ reasonCode: string; reasonMessage?: string; validationUrl?: string }>;
  cloudaicompanionProject?: string;
}

interface OnboardOperation {
  name: string;
  done?: boolean;
  response?: { cloudaicompanionProject?: { id: string } };
}

async function callInternal(accessToken: string, method: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${GOOGLE_OAUTH.codeAssistBaseUrl}:${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Code Assist ${method} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/**
 * Resolve the `cloudaicompanionProject` id required for every
 * :generateContent call, onboarding the account if this is the first use
 * (free-tier: auto-managed project, no user input needed; Workspace/other
 * tiers: require the caller-supplied `projectId`).
 */
export async function ensureCodeAssistProject(accessToken: string, projectId?: string): Promise<string> {
  if (projectId && /^\d+$/.test(projectId)) throw new GoogleNumericProjectIdError();

  const load = (await callInternal(accessToken, 'loadCodeAssist', {
    cloudaicompanionProject: projectId,
    metadata: {
      ideType: 'IDE_UNSPECIFIED',
      platform: 'PLATFORM_UNSPECIFIED',
      pluginType: 'GEMINI',
      ...(projectId ? { duetProject: projectId } : {}),
    },
  })) as LoadCodeAssistResponse;

  if (load.currentTier) {
    const resolved = load.cloudaicompanionProject ?? projectId;
    if (!resolved) {
      throw new Error('account is already onboarded but returned no project id; set GOOGLE_CLOUD_PROJECT');
    }
    return resolved;
  }

  const validationRequired = load.ineligibleTiers?.find((t) => t.reasonCode === 'VALIDATION_REQUIRED');
  if (validationRequired?.validationUrl)
    throw new GoogleValidationRequiredError(validationRequired.validationUrl);

  const tier = load.allowedTiers?.find((t) => t.isDefault) ?? load.allowedTiers?.[0];
  const tierId = tier?.id ?? 'free-tier';
  const isFree = tierId === 'free-tier';
  if (!isFree && !projectId) throw new Error('GOOGLE_CLOUD_PROJECT is required for this Google account tier');

  // Setting cloudaicompanionProject on a free-tier onboard request 412s — must be omitted, not null/"".
  const onboardBody = isFree
    ? {
        tierId,
        metadata: { ideType: 'IDE_UNSPECIFIED', platform: 'PLATFORM_UNSPECIFIED', pluginType: 'GEMINI' },
      }
    : {
        tierId,
        cloudaicompanionProject: projectId,
        metadata: {
          ideType: 'IDE_UNSPECIFIED',
          platform: 'PLATFORM_UNSPECIFIED',
          pluginType: 'GEMINI',
          duetProject: projectId,
        },
      };

  let op = (await callInternal(accessToken, 'onboardUser', onboardBody)) as OnboardOperation;
  const deadline = Date.now() + 60_000;
  while (!op.done) {
    if (Date.now() > deadline) throw new Error('Code Assist onboarding timed out');
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const res = await fetch(`https://cloudcode-pa.googleapis.com/v1internal/${op.name}`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`onboarding poll failed: ${res.status}`);
    op = (await res.json()) as OnboardOperation;
  }
  const resultProject = op.response?.cloudaicompanionProject?.id;
  if (!resultProject) throw new Error('onboarding completed without a project id');
  return resultProject;
}

const DEFAULT_TEST_MODEL = 'gemini-2.5-flash';

export async function codeAssistTest(accessToken: string, projectId?: string): Promise<ProviderTestResult> {
  const start = Date.now();
  try {
    const project = await ensureCodeAssistProject(accessToken, projectId);
    const res = await fetch(`${GOOGLE_OAUTH.codeAssistBaseUrl}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        model: DEFAULT_TEST_MODEL,
        project,
        user_prompt_id: crypto.randomUUID(),
        request: { contents: [{ role: 'user', parts: [{ text: 'Reply with the single word: ok' }] }] },
      }),
    });
    const latencyMs = Date.now() - start;
    if (!res.ok) return { ok: false, latencyMs, message: `${res.status} ${await res.text()}` };
    return { ok: true, latencyMs };
  } catch (err) {
    if (err instanceof GoogleValidationRequiredError) {
      return { ok: false, message: `${err.message} — ${err.validationUrl}` };
    }
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/** The Code Assist API has no documented model-listing endpoint (issue #12) —
 *  curated static list of the models gemini-cli itself offers, same as the
 *  OpenAI Codex backend adapter's approach. See DECISIONS.md "Phase 3". */
export function codeAssistListModels(): ModelInfo[] {
  return [
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
  ];
}

// --- LanguageModelV4 adapter (Phase 4 — POST /api/chat's streamText) -------
// Text-only, streamText-focused implementation (see text-prompt.ts's doc
// comment for why tool-calling isn't wired in here). Google's OAuth flow
// isn't live-testable in this environment (no account, per DECISIONS.md
// Phase 3) so this is verified via unit tests with a mocked `fetch` only —
// not a real Code Assist account.
interface CodeAssistContentPart {
  text?: string;
}
interface CodeAssistCandidate {
  content?: { parts?: CodeAssistContentPart[] };
  finishReason?: string;
}
interface CodeAssistGenerateEnvelope {
  response?: { candidates?: CodeAssistCandidate[] };
}

function extractCandidateText(envelope: CodeAssistGenerateEnvelope): string {
  const parts = envelope.response?.candidates?.[0]?.content?.parts ?? [];
  return parts.map((part) => part.text ?? '').join('');
}

export interface CodeAssistLanguageModelOptions {
  accessToken: string;
  projectId: string | undefined;
  modelId: string;
}

export class CodeAssistLanguageModel implements LanguageModelV4 {
  readonly specificationVersion = 'v4' as const;
  readonly provider = 'google-code-assist';
  readonly modelId: string;
  readonly supportedUrls = {};

  private readonly accessToken: string;
  private readonly projectId: string | undefined;

  constructor(options: CodeAssistLanguageModelOptions) {
    this.accessToken = options.accessToken;
    this.projectId = options.projectId;
    this.modelId = options.modelId;
  }

  private buildRequestBody(options: LanguageModelV4CallOptions, project: string): unknown {
    const { system, turns } = flattenPrompt(options.prompt);
    return {
      model: this.modelId,
      project,
      user_prompt_id: crypto.randomUUID(),
      request: {
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        contents: turns.map((turn) => ({
          role: turn.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: turn.text }],
        })),
        ...(options.maxOutputTokens || options.temperature !== undefined
          ? {
              generationConfig: {
                ...(options.maxOutputTokens ? { maxOutputTokens: options.maxOutputTokens } : {}),
                ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
              },
            }
          : {}),
      },
    };
  }

  async doGenerate(options: LanguageModelV4CallOptions) {
    const project = await ensureCodeAssistProject(this.accessToken, this.projectId);
    const res = await fetch(`${GOOGLE_OAUTH.codeAssistBaseUrl}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.accessToken}` },
      body: JSON.stringify(this.buildRequestBody(options, project)),
      signal: options.abortSignal ?? null,
    });
    if (!res.ok) throw new Error(`Code Assist generateContent failed: ${res.status} ${await res.text()}`);
    const envelope = (await res.json()) as CodeAssistGenerateEnvelope;
    const text = extractCandidateText(envelope);
    const content: LanguageModelV4Content[] = text ? [{ type: 'text', text }] : [];
    return {
      content,
      finishReason: { unified: 'stop' as const, raw: envelope.response?.candidates?.[0]?.finishReason },
      usage: nullUsage(),
      warnings: [],
    };
  }

  async doStream(options: LanguageModelV4CallOptions) {
    const project = await ensureCodeAssistProject(this.accessToken, this.projectId);
    const res = await fetch(`${GOOGLE_OAUTH.codeAssistBaseUrl}:streamGenerateContent?alt=sse`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.accessToken}` },
      body: JSON.stringify(this.buildRequestBody(options, project)),
      signal: options.abortSignal ?? null,
    });
    if (!res.ok || !res.body) {
      throw new Error(`Code Assist streamGenerateContent failed: ${res.status} ${await res.text()}`);
    }
    const body = res.body;

    const stream = new ReadableStream<LanguageModelV4StreamPart>({
      async start(controller) {
        controller.enqueue({ type: 'stream-start', warnings: [] });
        controller.enqueue({ type: 'text-start', id: '0' });
        let sawText = false;
        try {
          for await (const event of parseSseJsonStream(body)) {
            const text = extractCandidateText(event as CodeAssistGenerateEnvelope);
            if (text) {
              sawText = true;
              controller.enqueue({ type: 'text-delta', id: '0', delta: text });
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
