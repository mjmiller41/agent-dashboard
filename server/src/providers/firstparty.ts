// All client ids / secrets / scopes / endpoints for the OAuth-capable
// providers, in one file so drift is a one-file fix (PLAN.md §6a). Values
// ported from the OAuth research issues (#9 OpenRouter, #10 Anthropic, #11
// OpenAI, #12 Google, #13 GitHub Copilot) — see DECISIONS.md "Phase 3" for
// the summary of what changed vs. PLAN.md's original table. These
// constants/endpoints are known to drift; if a flow starts failing, re-check
// the linked reference implementations before assuming a bug here.
import type { CredentialSecret, CredentialStore, StoredCredential } from './credentials.ts';
import type { DevicePollOutcome } from './oauth.ts';

// --- OpenRouter --------------------------------------------------------
// Source: openrouter.ai/docs/use-cases/oauth-pkce (issue #9). No client id
// or scopes — the PKCE loopback flow is unauthenticated beyond the
// challenge/verifier pair itself.
export const OPENROUTER_OAUTH = {
  authorizeUrl: 'https://openrouter.ai/auth',
  keyExchangeUrl: 'https://openrouter.ai/api/v1/auth/keys',
  baseUrl: 'https://openrouter.ai/api/v1',
} as const;

export async function openrouterExchange(code: string, verifier: string): Promise<CredentialSecret> {
  const res = await fetch(OPENROUTER_OAUTH.keyExchangeUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
  });
  if (!res.ok) {
    throw new Error(`OpenRouter key exchange failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { key: string };
  // OpenRouter's exchange returns a plain, long-lived, user-scoped API key —
  // there is no separate access/refresh token pair and nothing to refresh.
  return { apiKey: body.key };
}

// --- Anthropic (Claude Pro/Max sign-in) ---------------------------------
// Source: issue #10. Redirect + token endpoints moved to platform.claude.com
// since PLAN.md was written; scopes expanded from 3 to 6.
export const ANTHROPIC_OAUTH = {
  authorizeUrl: 'https://claude.ai/oauth/authorize',
  tokenUrl: 'https://platform.claude.com/v1/oauth/token',
  redirectUri: 'https://platform.claude.com/oauth/code/callback',
  clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
  scopes: [
    'org:create_api_key',
    'user:profile',
    'user:inference',
    'user:sessions:claude_code',
    'user:mcp_servers',
    'user:file_upload',
  ],
  anthropicBeta: 'oauth-2025-04-20',
  anthropicVersion: '2023-06-01',
} as const;

interface AnthropicTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export async function anthropicExchange(
  code: string,
  state: string,
  verifier: string,
): Promise<CredentialSecret> {
  const res = await fetch(ANTHROPIC_OAUTH.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      code,
      state,
      grant_type: 'authorization_code',
      client_id: ANTHROPIC_OAUTH.clientId,
      redirect_uri: ANTHROPIC_OAUTH.redirectUri,
      code_verifier: verifier,
    }),
  });
  if (!res.ok) throw new Error(`Anthropic token exchange failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as AnthropicTokenResponse;
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: Date.now() + body.expires_in * 1000,
  };
}

/** Anthropic rotates the refresh token on every call — the caller must
 *  always persist the new one (see oauth.ts's coalescedRefresh for the race
 *  this avoids). */
export async function anthropicRefresh(secret: CredentialSecret): Promise<CredentialSecret> {
  if (!secret.refreshToken) throw new Error('no refresh token stored for anthropic');
  const res = await fetch(ANTHROPIC_OAUTH.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: secret.refreshToken,
      client_id: ANTHROPIC_OAUTH.clientId,
    }),
  });
  if (!res.ok) throw new Error(`Anthropic refresh failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as AnthropicTokenResponse;
  return {
    ...secret,
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: Date.now() + body.expires_in * 1000,
  };
}

// --- OpenAI (ChatGPT sign-in) --------------------------------------------
// Source: issue #11 (ported from openai/codex codex-rs/login/src). Fixed
// port 1455 (opencode's simpler, proven approach — no 1457 fallback).
export const OPENAI_OAUTH = {
  authorizeUrl: 'https://auth.openai.com/oauth/authorize',
  tokenUrl: 'https://auth.openai.com/oauth/token',
  clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
  port: 1455,
  redirectPath: '/auth/callback',
  redirectUri: 'http://localhost:1455/auth/callback',
  scopes: ['openid', 'profile', 'email', 'offline_access'],
  originator: 'agent-dashboard',
  codexBackendUrl: 'https://chatgpt.com/backend-api/codex',
} as const;

interface OpenAiExchangeResponse {
  id_token: string;
  access_token: string;
  refresh_token: string;
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length < 2) return {};
  try {
    const json = Buffer.from(parts[1]!.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Reads `payload["https://api.openai.com/auth"]["chatgpt_account_id"]`, with the
 *  flattened-top-level and `organizations[0].id` fallbacks opencode's port also checks. */
export function extractChatgptAccountId(idToken: string): string | undefined {
  const payload = decodeJwtPayload(idToken);
  const authClaim = payload['https://api.openai.com/auth'] as { chatgpt_account_id?: string } | undefined;
  if (authClaim?.chatgpt_account_id) return authClaim.chatgpt_account_id;
  if (typeof payload.chatgpt_account_id === 'string') return payload.chatgpt_account_id;
  const orgs = payload.organizations as Array<{ id?: string }> | undefined;
  if (orgs?.[0]?.id) return orgs[0].id;
  return undefined;
}

export function jwtExpiryMs(token: string): number | undefined {
  const exp = decodeJwtPayload(token).exp;
  return typeof exp === 'number' ? exp * 1000 : undefined;
}

async function openaiTokenExchangeApiKey(idToken: string): Promise<string> {
  const res = await fetch(OPENAI_OAUTH.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      client_id: OPENAI_OAUTH.clientId,
      requested_token: 'openai-api-key',
      subject_token: idToken,
      subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
    }).toString(),
  });
  if (!res.ok) throw new Error(`token-exchange-for-api-key unavailable: ${res.status}`);
  const body = (await res.json()) as { access_token: string };
  return body.access_token;
}

export async function openaiExchange(
  code: string,
  verifier: string,
  redirectUri: string,
): Promise<CredentialSecret> {
  const res = await fetch(OPENAI_OAUTH.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: OPENAI_OAUTH.clientId,
      code_verifier: verifier,
    }).toString(),
  });
  if (!res.ok) throw new Error(`OpenAI token exchange failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as OpenAiExchangeResponse;
  const accountId = extractChatgptAccountId(body.id_token);

  // Mode (a), token-exchange for a plain API key, is best-effort and often
  // unavailable (issue #11) — try it, but mode (b) (the Codex backend
  // adapter, using accessToken + accountId directly) is the reliable path.
  let apiKey: string | undefined;
  try {
    apiKey = await openaiTokenExchangeApiKey(body.id_token);
  } catch {
    apiKey = undefined;
  }

  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: jwtExpiryMs(body.access_token),
    apiKey,
    extra: { idToken: body.id_token, accountId },
  };
}

export async function openaiRefresh(secret: CredentialSecret): Promise<CredentialSecret> {
  if (!secret.refreshToken) throw new Error('no refresh token stored for openai');
  const res = await fetch(OPENAI_OAUTH.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: OPENAI_OAUTH.clientId,
      grant_type: 'refresh_token',
      refresh_token: secret.refreshToken,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI refresh failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as Partial<OpenAiExchangeResponse>;
  const next: CredentialSecret = { ...secret };
  if (body.access_token) {
    next.accessToken = body.access_token;
    next.expiresAt = jwtExpiryMs(body.access_token);
  }
  if (body.refresh_token) next.refreshToken = body.refresh_token;
  if (body.id_token) {
    const accountId = extractChatgptAccountId(body.id_token);
    next.extra = { ...(secret.extra ?? {}), idToken: body.id_token, ...(accountId ? { accountId } : {}) };
  }
  return next;
}

// --- Google (Gemini CLI sign-in) -----------------------------------------
// Source: issue #12. Client id/secret intentionally public (installed-app
// pattern, confirmed unchanged). Our loopback flow adds PKCE on top of
// gemini-cli's confidential-client `authWithWeb` design (ported from
// jenslys/opencode-gemini-auth, not gemini-cli's browser flow — see
// DECISIONS.md).
export const GOOGLE_OAUTH = {
  authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  clientId: '681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com',
  clientSecret: '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',
  scopes: [
    'https://www.googleapis.com/auth/cloud-platform',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
  ],
  codeAssistBaseUrl: 'https://cloudcode-pa.googleapis.com/v1internal',
} as const;

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

export async function googleExchange(
  code: string,
  verifier: string,
  redirectUri: string,
): Promise<CredentialSecret> {
  const res = await fetch(GOOGLE_OAUTH.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: GOOGLE_OAUTH.clientId,
      client_secret: GOOGLE_OAUTH.clientSecret,
      code_verifier: verifier,
    }).toString(),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as GoogleTokenResponse;
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: Date.now() + body.expires_in * 1000,
  };
}

export async function googleRefresh(secret: CredentialSecret): Promise<CredentialSecret> {
  if (!secret.refreshToken) throw new Error('no refresh token stored for google');
  const res = await fetch(GOOGLE_OAUTH.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: secret.refreshToken,
      client_id: GOOGLE_OAUTH.clientId,
      client_secret: GOOGLE_OAUTH.clientSecret,
    }).toString(),
  });
  if (!res.ok) {
    const body = await res.text();
    if (body.includes('invalid_grant'))
      throw new Error('Google refresh token was revoked — reconnect required');
    throw new Error(`Google refresh failed: ${res.status} ${body}`);
  }
  const body = (await res.json()) as GoogleTokenResponse;
  return {
    ...secret,
    accessToken: body.access_token,
    // Google may not rotate the refresh token — keep the existing one if none was returned.
    refreshToken: body.refresh_token ?? secret.refreshToken,
    expiresAt: Date.now() + body.expires_in * 1000,
  };
}

// --- GitHub Copilot (device flow) -----------------------------------------
// Source: issue #13.
export const COPILOT_DEVICE = {
  deviceCodeUrl: 'https://github.com/login/device/code',
  tokenUrl: 'https://github.com/login/oauth/access_token',
  // "GitHub Copilot CLI by GitHub" branded consent screen; the wizard also
  // lets a user supply their own OAuth App client id (the sanctioned route).
  fallbackClientId: 'Iv1.b507a08c87ecfe98',
  tokenExchangeUrl: 'https://api.github.com/copilot_internal/v2/token',
  defaultApiBaseUrl: 'https://api.githubcopilot.com',
  scope: 'read:user',
} as const;

interface CopilotDeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export async function copilotStartDeviceCode(clientId: string): Promise<CopilotDeviceCodeResponse> {
  const res = await fetch(COPILOT_DEVICE.deviceCodeUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ client_id: clientId, scope: COPILOT_DEVICE.scope }),
  });
  if (!res.ok) throw new Error(`GitHub device code request failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as CopilotDeviceCodeResponse;
}

interface CopilotPollBody {
  access_token?: string;
  error?: string;
  error_description?: string;
  interval?: number;
}

export async function copilotPollOnce(clientId: string, deviceCode: string): Promise<DevicePollOutcome> {
  const res = await fetch(COPILOT_DEVICE.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }),
  });
  const body = (await res.json()) as CopilotPollBody;
  if (body.access_token) {
    return { status: 'success', result: { accessToken: body.access_token, extra: { clientId } } };
  }
  if (body.error === 'authorization_pending') return { status: 'pending' };
  if (body.error === 'slow_down') return { status: 'slow_down', interval: body.interval };
  return { status: 'error', message: body.error_description ?? body.error ?? 'device flow failed' };
}

export interface CopilotTokenExchange {
  token: string;
  expiresAt: number;
  refreshIn: number;
  apiBaseUrl: string;
}

/** GET, not POST — `Authorization: token <gho_...>`, and needs Copilot-Integration-Id
 *  on this call too, per issue #13's correction to PLAN.md. */
export async function copilotExchangeToken(ghoToken: string): Promise<CopilotTokenExchange> {
  const res = await fetch(COPILOT_DEVICE.tokenExchangeUrl, {
    method: 'GET',
    headers: { authorization: `token ${ghoToken}`, 'copilot-integration-id': 'vscode-chat' },
  });
  if (!res.ok) throw new Error(`Copilot token exchange failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as {
    token: string;
    expires_at: number;
    refresh_in: number;
    endpoints: { api: string };
  };
  return {
    token: body.token,
    expiresAt: body.expires_at * 1000,
    refreshIn: body.refresh_in,
    apiBaseUrl: body.endpoints.api,
  };
}

export function copilotChatHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    'copilot-integration-id': 'vscode-chat',
    'editor-version': 'vscode/1.99.0',
    'editor-plugin-version': 'agent-dashboard/0.0.0',
    'x-github-api-version': '2025-10-01',
    'openai-intent': 'conversation-panel',
    'x-initiator': 'user',
  };
}

/** Copilot's short-lived (~25min) token, cached in the credential's `extra` field
 *  and re-exchanged from the stored `gho_` token when missing/near expiry. */
export async function getFreshCopilotToken(
  providerId: string,
  store: CredentialStore,
  cred: StoredCredential,
): Promise<CopilotTokenExchange> {
  const extra = cred.extra as
    { copilotToken?: string; copilotExpiresAt?: number; copilotApiBaseUrl?: string } | undefined;
  if (extra?.copilotToken && extra.copilotExpiresAt && extra.copilotExpiresAt - Date.now() > 60_000) {
    return {
      token: extra.copilotToken,
      expiresAt: extra.copilotExpiresAt,
      refreshIn: 0,
      apiBaseUrl: extra.copilotApiBaseUrl ?? COPILOT_DEVICE.defaultApiBaseUrl,
    };
  }
  if (!cred.accessToken) throw new Error('no GitHub token stored for copilot');
  const exchanged = await copilotExchangeToken(cred.accessToken);
  await store.update(providerId, (secret) => ({
    ...secret,
    extra: {
      ...(secret.extra ?? {}),
      copilotToken: exchanged.token,
      copilotExpiresAt: exchanged.expiresAt,
      copilotApiBaseUrl: exchanged.apiBaseUrl,
    },
  }));
  return exchanged;
}
