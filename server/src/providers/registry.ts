// Provider descriptors (PLAN.md §6). The web wizard renders from this list;
// routes/providers.ts drives OAuth flows and credential storage against it;
// routes/chat.ts (Phase 4) drives `aiSdkFactory` for POST /api/chat's
// streamText call.
//
// `aiSdkFactory` reuses the exact client-construction pattern each
// provider's `test()` already uses (createAnthropic/createOpenAI/
// createGoogleGenerativeAI/createOpenAICompatible), per the Phase 4 build
// brief's explicit instruction not to reinvent that. It takes a `model` id
// (not part of PLAN.md's abstract type sketch, which only shows `(cred) =>
// ...`) because a concrete LanguageModel instance needs both the credential
// AND the model id the user picked in the Assistant panel — logged in
// DECISIONS.md "Phase 4".
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText, type LanguageModel } from 'ai';
import {
  codeAssistListModels,
  codeAssistTest,
  CodeAssistLanguageModel,
} from './adapters/google-code-assist.ts';
import { codexListModels, codexResponsesTest, CodexBackendLanguageModel } from './adapters/openai-codex.ts';
import type { CredentialStore, StoredCredential } from './credentials.ts';
import {
  ANTHROPIC_OAUTH,
  anthropicExchange,
  anthropicRefresh,
  COPILOT_DEVICE,
  copilotChatHeaders,
  copilotPollOnce,
  copilotStartDeviceCode,
  getFreshCopilotToken,
  GOOGLE_OAUTH,
  googleExchange,
  googleRefresh,
  OPENAI_OAUTH,
  openaiExchange,
  openaiRefresh,
  OPENROUTER_OAUTH,
  openrouterExchange,
} from './firstparty.ts';
import type { CredentialSecret } from './credentials.ts';
import type { DevicePollOutcome } from './oauth.ts';
import type { AuthMethodKind, ModelInfo, ProviderTestResult } from './types.ts';

export interface ApiKeySpec {
  placeholder: string;
  helpUrl: string;
  baseUrlConfigurable?: boolean;
  /** True for providers where a key isn't strictly required (Ollama: URL-only "connection"). */
  optional?: boolean;
}

export type OAuthFlowKind = 'pkce-loopback' | 'pkce-fixed-port' | 'pkce-code-paste' | 'device-code';

interface PkceOAuthFlow {
  kind: 'pkce-loopback' | 'pkce-fixed-port' | 'pkce-code-paste';
  authorizeUrl: string;
  scopes?: readonly string[];
  buildAuthorizeUrl: (ctx: {
    challenge: string;
    state: string;
    redirectUri: string;
    flowId: string;
  }) => string;
  exchangeCode: (ctx: {
    code: string;
    state: string;
    verifier: string;
    redirectUri: string;
  }) => Promise<CredentialSecret>;
  refresh?: (secret: CredentialSecret) => Promise<CredentialSecret>;
  /** pkce-fixed-port only. */
  port?: number;
  redirectPath?: string;
  /** pkce-loopback default redirect target (this app's own callback route). */
  redirectUri?: string;
}

interface DeviceOAuthFlow {
  kind: 'device-code';
  defaultClientId: string;
  clientIdConfigurable: true;
  start: (clientId: string) => Promise<{
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    interval: number;
    expiresIn: number;
  }>;
  poll: (clientId: string, deviceCode: string) => Promise<DevicePollOutcome>;
}

export type OAuthFlow = PkceOAuthFlow | DeviceOAuthFlow;

export interface ProviderDescriptor {
  id: string;
  name: string;
  logoId: string;
  auth: AuthMethodKind[];
  apiKey?: ApiKeySpec;
  oauth?: OAuthFlow;
  /** True = reuses a vendor CLI's first-party OAuth client (consent gate, PLAN.md §6a). */
  firstParty?: boolean;
  recommended?: boolean;
  test: (cred: StoredCredential, store: CredentialStore) => Promise<ProviderTestResult>;
  listModels: (cred: StoredCredential, store: CredentialStore) => Promise<ModelInfo[]>;
  /** Builds a real AI SDK `LanguageModel` for `model` from this connection
   *  (PLAN.md §6 / §11 Phase 4). Used by routes/chat.ts's streamText call. */
  aiSdkFactory: (cred: StoredCredential, model: string, store: CredentialStore) => Promise<LanguageModel>;
}

const TEST_PROMPT = 'Reply with the single word: ok';

// Cheapest/fastest current Anthropic model, used only for the connection
// test. Deliberately the *undated alias* rather than a dated snapshot
// (`claude-haiku-4-5-20251001`): snapshots get retired and 404 — which is
// exactly how the original `claude-3-5-haiku-20241022` here broke in real
// use (issue #14). The alias tracks the current Haiku automatically.
const ANTHROPIC_TEST_MODEL = 'claude-haiku-4-5';

// --- OpenRouter -------------------------------------------------------
async function openrouterTest(cred: StoredCredential): Promise<ProviderTestResult> {
  if (!cred.apiKey) return { ok: false, message: 'no API key stored' };
  const start = Date.now();
  const provider = createOpenAICompatible({
    name: 'openrouter',
    baseURL: OPENROUTER_OAUTH.baseUrl,
    apiKey: cred.apiKey,
  });
  const result = await generateText({
    model: provider.chatModel('openai/gpt-4o-mini'),
    prompt: TEST_PROMPT,
    maxOutputTokens: 10,
    maxRetries: 0,
  });
  return { ok: true, latencyMs: Date.now() - start, message: result.text };
}

async function openrouterListModels(cred: StoredCredential): Promise<ModelInfo[]> {
  const res = await fetch(`${OPENROUTER_OAUTH.baseUrl}/models`, {
    headers: cred.apiKey ? { authorization: `Bearer ${cred.apiKey}` } : {},
  });
  if (!res.ok) throw new Error(`failed to list OpenRouter models: ${res.status}`);
  const body = (await res.json()) as { data: Array<{ id: string; name?: string; context_length?: number }> };
  return body.data.map((m) => ({ id: m.id, name: m.name, contextLength: m.context_length }));
}

// --- Anthropic ----------------------------------------------------------
async function anthropicTest(cred: StoredCredential): Promise<ProviderTestResult> {
  const start = Date.now();
  if (cred.method === 'api-key' && cred.apiKey) {
    const anthropic = createAnthropic({ apiKey: cred.apiKey });
    const result = await generateText({
      model: anthropic(ANTHROPIC_TEST_MODEL),
      prompt: TEST_PROMPT,
      maxOutputTokens: 10,
      maxRetries: 0,
    });
    return { ok: true, latencyMs: Date.now() - start, message: result.text };
  }
  if (cred.method === 'oauth' && cred.accessToken) {
    // OAuth tokens need Authorization: Bearer + anthropic-beta and MUST NOT send
    // x-api-key (@ai-sdk/anthropic is built around the api-key path) — direct fetch.
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cred.accessToken}`,
        'anthropic-version': ANTHROPIC_OAUTH.anthropicVersion,
        'anthropic-beta': ANTHROPIC_OAUTH.anthropicBeta,
      },
      body: JSON.stringify({
        model: ANTHROPIC_TEST_MODEL,
        max_tokens: 10,
        messages: [{ role: 'user', content: TEST_PROMPT }],
      }),
    });
    const latencyMs = Date.now() - start;
    if (!res.ok) return { ok: false, latencyMs, message: `${res.status} ${await res.text()}` };
    return { ok: true, latencyMs };
  }
  return { ok: false, message: 'no credential stored' };
}

async function anthropicListModels(cred: StoredCredential): Promise<ModelInfo[]> {
  const headers: Record<string, string> = { 'anthropic-version': ANTHROPIC_OAUTH.anthropicVersion };
  if (cred.method === 'api-key' && cred.apiKey) {
    headers['x-api-key'] = cred.apiKey;
  } else if (cred.method === 'oauth' && cred.accessToken) {
    headers.authorization = `Bearer ${cred.accessToken}`;
    headers['anthropic-beta'] = ANTHROPIC_OAUTH.anthropicBeta;
  } else {
    return [];
  }
  const res = await fetch('https://api.anthropic.com/v1/models', { headers });
  if (!res.ok) throw new Error(`failed to list Anthropic models: ${res.status}`);
  const body = (await res.json()) as { data: Array<{ id: string; display_name?: string }> };
  return body.data.map((m) => ({ id: m.id, name: m.display_name }));
}

// --- OpenAI ---------------------------------------------------------------
async function openaiProviderTest(cred: StoredCredential): Promise<ProviderTestResult> {
  const start = Date.now();
  if (cred.apiKey) {
    const openai = createOpenAI({ apiKey: cred.apiKey, ...(cred.baseUrl ? { baseURL: cred.baseUrl } : {}) });
    const result = await generateText({
      model: openai('gpt-4o-mini'),
      prompt: TEST_PROMPT,
      maxOutputTokens: 10,
      maxRetries: 0,
    });
    return { ok: true, latencyMs: Date.now() - start, message: result.text };
  }
  if (cred.method === 'oauth' && cred.accessToken) {
    const accountId = (cred.extra as { accountId?: string } | undefined)?.accountId;
    return codexResponsesTest(cred.accessToken, accountId);
  }
  return { ok: false, message: 'no credential stored' };
}

async function openaiListModels(cred: StoredCredential): Promise<ModelInfo[]> {
  if (cred.apiKey) {
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { authorization: `Bearer ${cred.apiKey}` },
    });
    if (!res.ok) throw new Error(`failed to list OpenAI models: ${res.status}`);
    const body = (await res.json()) as { data: Array<{ id: string }> };
    return body.data.map((m) => ({ id: m.id }));
  }
  return codexListModels();
}

// --- Google ---------------------------------------------------------------
async function googleTest(cred: StoredCredential): Promise<ProviderTestResult> {
  const start = Date.now();
  if (cred.method === 'api-key' && cred.apiKey) {
    const google = createGoogleGenerativeAI({ apiKey: cred.apiKey });
    const result = await generateText({
      model: google('gemini-2.0-flash'),
      prompt: TEST_PROMPT,
      maxOutputTokens: 10,
      maxRetries: 0,
    });
    return { ok: true, latencyMs: Date.now() - start, message: result.text };
  }
  if (cred.method === 'oauth' && cred.accessToken) {
    const projectId = (cred.extra as { projectId?: string } | undefined)?.projectId;
    return codeAssistTest(cred.accessToken, projectId);
  }
  return { ok: false, message: 'no credential stored' };
}

async function googleListModels(cred: StoredCredential): Promise<ModelInfo[]> {
  if (cred.method === 'api-key' && cred.apiKey) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${cred.apiKey}`);
    if (!res.ok) throw new Error(`failed to list Google models: ${res.status}`);
    const body = (await res.json()) as { models: Array<{ name: string; displayName?: string }> };
    return body.models.map((m) => ({ id: m.name.replace(/^models\//, ''), name: m.displayName }));
  }
  return codeAssistListModels();
}

// --- GitHub Copilot ---------------------------------------------------------
async function copilotTest(cred: StoredCredential, store: CredentialStore): Promise<ProviderTestResult> {
  const start = Date.now();
  try {
    const { token, apiBaseUrl } = await getFreshCopilotToken('github-copilot', store, cred);
    const res = await fetch(`${apiBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: copilotChatHeaders(token),
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 10,
        messages: [{ role: 'user', content: TEST_PROMPT }],
      }),
    });
    const latencyMs = Date.now() - start;
    if (!res.ok) return { ok: false, latencyMs, message: `${res.status} ${await res.text()}` };
    return { ok: true, latencyMs };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

async function copilotListModels(cred: StoredCredential, store: CredentialStore): Promise<ModelInfo[]> {
  const { token, apiBaseUrl } = await getFreshCopilotToken('github-copilot', store, cred);
  const res = await fetch(`${apiBaseUrl}/models`, { headers: copilotChatHeaders(token) });
  if (!res.ok) throw new Error(`failed to list Copilot models: ${res.status}`);
  const body = (await res.json()) as {
    data: Array<{ id: string; name?: string; model_picker_enabled?: boolean }>;
  };
  return body.data.filter((m) => m.model_picker_enabled !== false).map((m) => ({ id: m.id, name: m.name }));
}

// --- Ollama (local) ---------------------------------------------------------
const OLLAMA_DEFAULT_BASE = 'http://localhost:11434';

async function ollamaTest(cred: StoredCredential): Promise<ProviderTestResult> {
  const baseUrl = cred.baseUrl || OLLAMA_DEFAULT_BASE;
  const start = Date.now();
  try {
    const res = await fetch(`${baseUrl}/api/tags`);
    const latencyMs = Date.now() - start;
    if (!res.ok) return { ok: false, latencyMs, message: `${res.status} ${await res.text()}` };
    const body = (await res.json()) as { models?: Array<{ name: string }> };
    return { ok: true, latencyMs, modelCount: body.models?.length ?? 0 };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

async function ollamaListModels(cred: StoredCredential): Promise<ModelInfo[]> {
  const baseUrl = cred.baseUrl || OLLAMA_DEFAULT_BASE;
  const res = await fetch(`${baseUrl}/api/tags`);
  if (!res.ok) throw new Error(`failed to list Ollama models: ${res.status}`);
  const body = (await res.json()) as { models?: Array<{ name: string }> };
  return (body.models ?? []).map((m) => ({ id: m.name, name: m.name }));
}

// --- Custom OpenAI-compatible -----------------------------------------------
async function customTest(cred: StoredCredential): Promise<ProviderTestResult> {
  if (!cred.baseUrl) return { ok: false, message: 'base URL is required' };
  const start = Date.now();
  const provider = createOpenAICompatible({
    name: 'custom',
    baseURL: cred.baseUrl,
    ...(cred.apiKey ? { apiKey: cred.apiKey } : {}),
  });
  const res = await fetch(`${cred.baseUrl.replace(/\/$/, '')}/models`, {
    headers: cred.apiKey ? { authorization: `Bearer ${cred.apiKey}` } : {},
  }).catch(() => null);
  const models = res && res.ok ? ((await res.json()) as { data?: Array<{ id: string }> }).data : undefined;
  const modelId = models?.[0]?.id ?? 'gpt-4o-mini';
  const result = await generateText({
    model: provider.chatModel(modelId),
    prompt: TEST_PROMPT,
    maxOutputTokens: 10,
    maxRetries: 0,
  });
  return { ok: true, latencyMs: Date.now() - start, message: result.text, modelCount: models?.length };
}

async function customListModels(cred: StoredCredential): Promise<ModelInfo[]> {
  if (!cred.baseUrl) return [];
  const res = await fetch(`${cred.baseUrl.replace(/\/$/, '')}/models`, {
    headers: cred.apiKey ? { authorization: `Bearer ${cred.apiKey}` } : {},
  });
  if (!res.ok) throw new Error(`failed to list models: ${res.status}`);
  const body = (await res.json()) as { data?: Array<{ id: string }> };
  return (body.data ?? []).map((m) => ({ id: m.id }));
}

// --- aiSdkFactory implementations (Phase 4) --------------------------------
// Each one reuses the same client-construction call already used by that
// provider's test() above; only the return value differs (a bound
// LanguageModel for `model` instead of a one-off generateText() call).

async function openrouterAiSdkFactory(cred: StoredCredential, model: string): Promise<LanguageModel> {
  const provider = createOpenAICompatible({
    name: 'openrouter',
    baseURL: OPENROUTER_OAUTH.baseUrl,
    ...(cred.apiKey ? { apiKey: cred.apiKey } : {}),
  });
  return provider.chatModel(model);
}

async function anthropicAiSdkFactory(cred: StoredCredential, model: string): Promise<LanguageModel> {
  if (cred.method === 'api-key' && cred.apiKey) {
    return createAnthropic({ apiKey: cred.apiKey })(model);
  }
  if (cred.method === 'oauth' && cred.accessToken) {
    // OAuth tokens need Authorization: Bearer + anthropic-beta and MUST NOT
    // send x-api-key — `authToken` (not `apiKey`) is @ai-sdk/anthropic's
    // supported way to do that (see anthropicTest's doc comment above).
    return createAnthropic({
      authToken: cred.accessToken,
      headers: { 'anthropic-beta': ANTHROPIC_OAUTH.anthropicBeta },
    })(model);
  }
  throw new Error('anthropic: no usable credential to build a model from');
}

async function openaiAiSdkFactory(cred: StoredCredential, model: string): Promise<LanguageModel> {
  if (cred.apiKey) {
    return createOpenAI({ apiKey: cred.apiKey, ...(cred.baseUrl ? { baseURL: cred.baseUrl } : {}) })(model);
  }
  if (cred.method === 'oauth' && cred.accessToken) {
    const accountId = (cred.extra as { accountId?: string } | undefined)?.accountId;
    return new CodexBackendLanguageModel({ accessToken: cred.accessToken, accountId, modelId: model });
  }
  throw new Error('openai: no usable credential to build a model from');
}

async function googleAiSdkFactory(cred: StoredCredential, model: string): Promise<LanguageModel> {
  if (cred.method === 'api-key' && cred.apiKey) {
    return createGoogleGenerativeAI({ apiKey: cred.apiKey })(model);
  }
  if (cred.method === 'oauth' && cred.accessToken) {
    const projectId = (cred.extra as { projectId?: string } | undefined)?.projectId;
    return new CodeAssistLanguageModel({ accessToken: cred.accessToken, projectId, modelId: model });
  }
  throw new Error('google: no usable credential to build a model from');
}

async function copilotAiSdkFactory(
  cred: StoredCredential,
  model: string,
  store: CredentialStore,
): Promise<LanguageModel> {
  const { token, apiBaseUrl } = await getFreshCopilotToken('github-copilot', store, cred);
  // copilotChatHeaders() includes authorization/content-type, which
  // createOpenAICompatible's own apiKey/content-type handling already sets —
  // drop them from the extra headers so they aren't set twice.
  const allHeaders = copilotChatHeaders(token);
  const extraHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(allHeaders)) {
    if (key !== 'authorization' && key !== 'content-type') extraHeaders[key] = value;
  }
  const provider = createOpenAICompatible({
    name: 'copilot',
    baseURL: apiBaseUrl,
    apiKey: token,
    headers: extraHeaders,
  });
  return provider.chatModel(model);
}

async function ollamaAiSdkFactory(cred: StoredCredential, model: string): Promise<LanguageModel> {
  const baseUrl = (cred.baseUrl || OLLAMA_DEFAULT_BASE).replace(/\/$/, '');
  const provider = createOpenAICompatible({
    name: 'ollama',
    baseURL: `${baseUrl}/v1`,
    apiKey: cred.apiKey || 'ollama',
  });
  return provider.chatModel(model);
}

async function customAiSdkFactory(cred: StoredCredential, model: string): Promise<LanguageModel> {
  if (!cred.baseUrl) throw new Error('custom: base URL is required');
  const provider = createOpenAICompatible({
    name: 'custom',
    baseURL: cred.baseUrl,
    ...(cred.apiKey ? { apiKey: cred.apiKey } : {}),
  });
  return provider.chatModel(model);
}

// ---------------------------------------------------------------------------

export const PROVIDERS: ProviderDescriptor[] = [
  {
    id: 'openrouter',
    name: 'OpenRouter',
    logoId: 'openrouter',
    auth: ['oauth-pkce', 'api-key'],
    recommended: true,
    apiKey: { placeholder: 'sk-or-v1-...', helpUrl: 'https://openrouter.ai/settings/keys' },
    oauth: {
      kind: 'pkce-loopback',
      authorizeUrl: OPENROUTER_OAUTH.authorizeUrl,
      buildAuthorizeUrl: ({ challenge, redirectUri, flowId }) => {
        // OpenRouter's redirect never echoes back a `state` param, so the flow id
        // has to travel in the callback_url itself for /oauth/callback to find
        // the matching pending flow (see DECISIONS.md "Phase 3").
        const params = new URLSearchParams({
          callback_url: `${redirectUri}?flow=${flowId}`,
          code_challenge: challenge,
          code_challenge_method: 'S256',
        });
        return `${OPENROUTER_OAUTH.authorizeUrl}?${params.toString()}`;
      },
      exchangeCode: ({ code, verifier }) => openrouterExchange(code, verifier),
    },
    test: (cred) => openrouterTest(cred),
    listModels: (cred) => openrouterListModels(cred),
    aiSdkFactory: (cred, model) => openrouterAiSdkFactory(cred, model),
  },
  {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    logoId: 'anthropic',
    auth: ['oauth-pkce', 'api-key'],
    firstParty: true,
    apiKey: { placeholder: 'sk-ant-...', helpUrl: 'https://console.anthropic.com/settings/keys' },
    oauth: {
      kind: 'pkce-code-paste',
      authorizeUrl: ANTHROPIC_OAUTH.authorizeUrl,
      scopes: ANTHROPIC_OAUTH.scopes,
      buildAuthorizeUrl: ({ challenge, state }) => {
        const params = new URLSearchParams({
          code: 'true',
          client_id: ANTHROPIC_OAUTH.clientId,
          response_type: 'code',
          redirect_uri: ANTHROPIC_OAUTH.redirectUri,
          scope: ANTHROPIC_OAUTH.scopes.join(' '),
          code_challenge: challenge,
          code_challenge_method: 'S256',
          state,
        });
        return `${ANTHROPIC_OAUTH.authorizeUrl}?${params.toString()}`;
      },
      exchangeCode: ({ code, state, verifier }) => anthropicExchange(code, state, verifier),
      refresh: anthropicRefresh,
    },
    test: (cred) => anthropicTest(cred),
    listModels: (cred) => anthropicListModels(cred),
    aiSdkFactory: (cred, model) => anthropicAiSdkFactory(cred, model),
  },
  {
    id: 'openai',
    name: 'OpenAI (ChatGPT)',
    logoId: 'openai',
    auth: ['oauth-pkce', 'api-key'],
    firstParty: true,
    apiKey: { placeholder: 'sk-...', helpUrl: 'https://platform.openai.com/api-keys' },
    oauth: {
      kind: 'pkce-fixed-port',
      authorizeUrl: OPENAI_OAUTH.authorizeUrl,
      scopes: OPENAI_OAUTH.scopes,
      port: OPENAI_OAUTH.port,
      redirectPath: OPENAI_OAUTH.redirectPath,
      redirectUri: OPENAI_OAUTH.redirectUri,
      buildAuthorizeUrl: ({ challenge, state }) => {
        const params = new URLSearchParams({
          response_type: 'code',
          client_id: OPENAI_OAUTH.clientId,
          redirect_uri: OPENAI_OAUTH.redirectUri,
          scope: OPENAI_OAUTH.scopes.join(' '),
          code_challenge: challenge,
          code_challenge_method: 'S256',
          id_token_add_organizations: 'true',
          codex_cli_simplified_flow: 'true',
          state,
          originator: OPENAI_OAUTH.originator,
        });
        return `${OPENAI_OAUTH.authorizeUrl}?${params.toString()}`;
      },
      exchangeCode: ({ code, verifier }) => openaiExchange(code, verifier, OPENAI_OAUTH.redirectUri),
      refresh: openaiRefresh,
    },
    test: (cred) => openaiProviderTest(cred),
    listModels: (cred) => openaiListModels(cred),
    aiSdkFactory: (cred, model) => openaiAiSdkFactory(cred, model),
  },
  {
    id: 'google',
    name: 'Google (Gemini)',
    logoId: 'google',
    auth: ['oauth-pkce', 'api-key'],
    firstParty: true,
    apiKey: { placeholder: 'AIza...', helpUrl: 'https://aistudio.google.com/apikey' },
    oauth: {
      kind: 'pkce-loopback',
      authorizeUrl: GOOGLE_OAUTH.authorizeUrl,
      scopes: GOOGLE_OAUTH.scopes,
      buildAuthorizeUrl: ({ challenge, state, redirectUri, flowId }) => {
        const params = new URLSearchParams({
          client_id: GOOGLE_OAUTH.clientId,
          redirect_uri: `${redirectUri}?flow=${encodeURIComponent(flowId)}`,
          response_type: 'code',
          scope: GOOGLE_OAUTH.scopes.join(' '),
          access_type: 'offline',
          prompt: 'consent',
          code_challenge: challenge,
          code_challenge_method: 'S256',
          state,
        });
        return `${GOOGLE_OAUTH.authorizeUrl}?${params.toString()}`;
      },
      exchangeCode: ({ code, verifier, redirectUri }) => googleExchange(code, verifier, redirectUri),
      refresh: googleRefresh,
    },
    test: (cred) => googleTest(cred),
    listModels: (cred) => googleListModels(cred),
    aiSdkFactory: (cred, model) => googleAiSdkFactory(cred, model),
  },
  {
    id: 'github-copilot',
    name: 'GitHub Copilot',
    logoId: 'github-copilot',
    auth: ['oauth-device'],
    oauth: {
      kind: 'device-code',
      defaultClientId: COPILOT_DEVICE.fallbackClientId,
      clientIdConfigurable: true,
      start: async (clientId) => {
        const res = await copilotStartDeviceCode(clientId);
        return {
          deviceCode: res.device_code,
          userCode: res.user_code,
          verificationUri: res.verification_uri,
          interval: res.interval,
          expiresIn: res.expires_in,
        };
      },
      poll: (clientId, deviceCode) => copilotPollOnce(clientId, deviceCode),
    },
    test: (cred, store) => copilotTest(cred, store),
    listModels: (cred, store) => copilotListModels(cred, store),
    aiSdkFactory: (cred, model, store) => copilotAiSdkFactory(cred, model, store),
  },
  {
    id: 'ollama',
    name: 'Ollama (local)',
    logoId: 'ollama',
    auth: ['api-key'],
    apiKey: {
      placeholder: '(not required)',
      helpUrl: 'https://ollama.com',
      baseUrlConfigurable: true,
      optional: true,
    },
    test: (cred) => ollamaTest(cred),
    listModels: (cred) => ollamaListModels(cred),
    aiSdkFactory: (cred, model) => ollamaAiSdkFactory(cred, model),
  },
  {
    id: 'custom',
    name: 'Custom OpenAI-compatible',
    logoId: 'custom',
    auth: ['api-key'],
    apiKey: {
      placeholder: 'sk-...',
      helpUrl: 'https://platform.openai.com/docs/api-reference',
      baseUrlConfigurable: true,
    },
    test: (cred) => customTest(cred),
    listModels: (cred) => customListModels(cred),
    aiSdkFactory: (cred, model) => customAiSdkFactory(cred, model),
  },
];

export function findProvider(id: string): ProviderDescriptor | undefined {
  return PROVIDERS.find((p) => p.id === id);
}
