// /api/providers/* — registry + connection status, API-key connect, the
// four-variant OAuth engine, live test, disconnect, model listing
// (PLAN.md §5/§6/§6a). Never returns secrets — GET /api/providers and
// GET /api/providers/:id/models expose `maskedKey` at most.
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { CredentialSecret, CredentialStore, StoredCredential } from '../providers/credentials.ts';
import { maskSecret } from '../providers/credentials.ts';
import {
  coalescedRefresh,
  codePasteFlows,
  completePkceFlow,
  createPkceChallenge,
  generateFlowId,
  generateState,
  loopbackFlows,
  OAuthFlowNotFoundError,
  OAuthPortInUseError,
  OAuthStateMismatchError,
  OAuthTimeoutError,
  pollDeviceCode,
  startFixedPortListener,
} from '../providers/oauth.ts';
import { findProvider, PROVIDERS, type ProviderDescriptor } from '../providers/registry.ts';
import type { SettingsStore } from '../providers/settings.ts';
import type { WorkspaceWatcher } from '../watch.ts';

const EXPIRY_SKEW_MS = 60_000;

function providerSummary(descriptor: ProviderDescriptor) {
  return {
    id: descriptor.id,
    name: descriptor.name,
    logoId: descriptor.logoId,
    auth: descriptor.auth,
    apiKey: descriptor.apiKey,
    oauth: descriptor.oauth
      ? {
          kind: descriptor.oauth.kind,
          scopes: 'scopes' in descriptor.oauth ? descriptor.oauth.scopes : undefined,
        }
      : undefined,
    firstParty: descriptor.firstParty ?? false,
    recommended: descriptor.recommended ?? false,
  };
}

function maskCredential(cred: StoredCredential | null): {
  connected: boolean;
  method?: string;
  maskedKey?: string;
  connectedAt?: string;
} {
  if (!cred) return { connected: false };
  const secret = cred.apiKey ?? cred.accessToken;
  return {
    connected: true,
    method: cred.method,
    connectedAt: cred.connectedAt,
    ...(secret ? { maskedKey: maskSecret(secret) } : {}),
  };
}

async function ensureFreshCredential(
  descriptor: ProviderDescriptor,
  store: CredentialStore,
  cred: StoredCredential,
): Promise<StoredCredential> {
  if (cred.method !== 'oauth' || !cred.refreshToken || !cred.expiresAt) return cred;
  if (cred.expiresAt - Date.now() > EXPIRY_SKEW_MS) return cred;
  const refresh = descriptor.oauth && 'refresh' in descriptor.oauth ? descriptor.oauth.refresh : undefined;
  if (!refresh) return cred;
  const refreshed = await coalescedRefresh(descriptor.id, () => refresh(cred));
  await store.update(descriptor.id, () => refreshed);
  return { ...refreshed, method: cred.method, connectedAt: cred.connectedAt };
}

function handleError(c: Context, err: unknown): Response {
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof OAuthFlowNotFoundError) return c.json({ error: message }, 404);
  if (err instanceof OAuthStateMismatchError) return c.json({ error: message }, 400);
  if (err instanceof OAuthTimeoutError) return c.json({ error: message }, 408);
  if (err instanceof OAuthPortInUseError) return c.json({ error: message }, 409);
  console.error(err);
  return c.json({ error: message }, 500);
}

export function createProvidersRoutes(
  store: CredentialStore,
  settings: SettingsStore,
  watcher: Pick<WorkspaceWatcher, 'broadcast'>,
): Hono {
  const routes = new Hono();

  function broadcastChange(providerId: string): void {
    watcher.broadcast({ type: 'provider-change', providerId });
  }

  routes.get('/', async (c) => {
    const providers = await Promise.all(
      PROVIDERS.map(async (descriptor) => ({
        ...providerSummary(descriptor),
        ...maskCredential(await store.get(descriptor.id)),
      })),
    );
    return c.json({ providers });
  });

  // First-party OAuth consent modal acceptance (PLAN.md §6a bullet 1). Not
  // in PLAN.md's literal route list, but the modal's acceptance has to be
  // persisted server-side (~/.agent-dashboard/settings.json) since the
  // browser has no access to that path — smallest addition that satisfies
  // the requirement (see DECISIONS.md "Phase 3").
  routes.get('/settings', async (c) => {
    const current = await settings.read();
    return c.json({ firstPartyConsentAccepted: Boolean(current.firstPartyConsentAcceptedAt) });
  });

  routes.post('/settings/consent', async (c) => {
    const updated = await settings.update({ firstPartyConsentAcceptedAt: new Date().toISOString() });
    return c.json({ firstPartyConsentAccepted: Boolean(updated.firstPartyConsentAcceptedAt) });
  });

  routes.post('/:id/apikey', async (c) => {
    const id = c.req.param('id');
    const descriptor = findProvider(id);
    if (!descriptor) return c.json({ error: `unknown provider: ${id}` }, 404);
    if (!descriptor.auth.includes('api-key'))
      return c.json({ error: `${id} does not support API-key auth` }, 400);

    let body: { key?: string; baseUrl?: string };
    try {
      body = (await c.req.json()) as { key?: string; baseUrl?: string };
    } catch {
      return c.json({ error: 'request body must be JSON' }, 400);
    }

    const key = body.key?.trim() ?? '';
    if (!key && !descriptor.apiKey?.optional) return c.json({ error: 'key is required' }, 400);

    const secret: CredentialSecret = {
      ...(key ? { apiKey: key } : {}),
      ...(body.baseUrl ? { baseUrl: body.baseUrl } : {}),
    };
    await store.set(id, 'api-key', secret);

    const cred = await store.get(id);
    const test = cred
      ? await runTest(descriptor, store, cred)
      : { ok: false, message: 'failed to persist credential' };
    broadcastChange(id);
    return c.json({ id, connected: true, method: 'api-key', test });
  });

  routes.delete('/:id', async (c) => {
    const id = c.req.param('id');
    if (!findProvider(id)) return c.json({ error: `unknown provider: ${id}` }, 404);
    await store.delete(id);
    broadcastChange(id);
    return c.json({ id, connected: false });
  });

  routes.post('/:id/test', async (c) => {
    const id = c.req.param('id');
    const descriptor = findProvider(id);
    if (!descriptor) return c.json({ error: `unknown provider: ${id}` }, 404);
    const cred = await store.get(id);
    if (!cred) return c.json({ error: 'not connected' }, 400);
    try {
      const fresh = await ensureFreshCredential(descriptor, store, cred);
      const result = await runTest(descriptor, store, fresh);
      return c.json(result);
    } catch (err) {
      return handleError(c, err);
    }
  });

  routes.get('/:id/models', async (c) => {
    const id = c.req.param('id');
    const descriptor = findProvider(id);
    if (!descriptor) return c.json({ error: `unknown provider: ${id}` }, 404);
    const cred = await store.get(id);
    if (!cred) return c.json({ error: 'not connected' }, 400);
    try {
      const fresh = await ensureFreshCredential(descriptor, store, cred);
      const models = await descriptor.listModels(fresh, store);
      return c.json({ models });
    } catch (err) {
      return handleError(c, err);
    }
  });

  // --- OAuth: pkce-loopback / pkce-fixed-port / pkce-code-paste / device-code ---

  routes.post('/:id/oauth/start', async (c) => {
    const id = c.req.param('id');
    const descriptor = findProvider(id);
    if (!descriptor?.oauth) return c.json({ error: `${id} has no OAuth flow` }, 400);
    const oauth = descriptor.oauth;

    let body: { clientId?: string; projectId?: string } = {};
    if (c.req.header('content-type')?.includes('application/json')) {
      try {
        body = (await c.req.json()) as { clientId?: string; projectId?: string };
      } catch {
        // malformed JSON body — proceed with defaults
      }
    }

    try {
      if (oauth.kind === 'device-code') {
        const clientId = body.clientId?.trim() || oauth.defaultClientId;
        const started = await oauth.start(clientId);
        void runDeviceCodeFlow(id, descriptor, oauth, clientId, started, store, broadcastChange);
        return c.json({
          kind: 'device-code',
          userCode: started.userCode,
          verificationUri: started.verificationUri,
          expiresIn: started.expiresIn,
        });
      }

      const { verifier, challenge } = createPkceChallenge();
      const state = generateState();

      if (oauth.kind === 'pkce-code-paste') {
        codePasteFlows.register(id, {
          providerId: id,
          verifier,
          state,
          redirectUri: '',
          exchangeCode: oauth.exchangeCode,
        });
        const authUrl = oauth.buildAuthorizeUrl({ challenge, state, redirectUri: '', flowId: id });
        return c.json({ kind: 'pkce-code-paste', authUrl });
      }

      if (oauth.kind === 'pkce-loopback') {
        const flowId = generateFlowId();
        const origin = new URL(c.req.url).origin;
        const redirectUri = `${origin}/api/providers/oauth/callback`;
        loopbackFlows.register(flowId, {
          providerId: id,
          verifier,
          state,
          redirectUri,
          exchangeCode: oauth.exchangeCode,
        });
        const authUrl = oauth.buildAuthorizeUrl({ challenge, state, redirectUri, flowId });
        return c.json({ kind: 'pkce-loopback', authUrl });
      }

      // pkce-fixed-port
      const port = oauth.port!;
      const redirectPath = oauth.redirectPath!;
      const redirectUri = oauth.redirectUri!;
      const listener = await startFixedPortListener(port, redirectPath);
      const authUrl = oauth.buildAuthorizeUrl({ challenge, state, redirectUri, flowId: id });
      void listener.waitForCallback
        .then(async (result) => {
          if (result.state !== state) throw new OAuthStateMismatchError();
          const secret = await oauth.exchangeCode({
            code: result.code,
            state: result.state,
            verifier,
            redirectUri,
          });
          await store.set(id, 'oauth', secret);
          broadcastChange(id);
        })
        .catch((err: unknown) => {
          console.error(`OpenAI OAuth flow failed:`, err instanceof Error ? err.message : err);
        });
      return c.json({ kind: 'pkce-fixed-port', authUrl });
    } catch (err) {
      return handleError(c, err);
    }
  });

  // Code-paste completion (Anthropic): body is either {code, state} already
  // split, or {pasted: "code#state"} straight from the clipboard.
  routes.post('/:id/oauth/paste', async (c) => {
    const id = c.req.param('id');
    let body: { code?: string; state?: string; pasted?: string };
    try {
      body = (await c.req.json()) as { code?: string; state?: string; pasted?: string };
    } catch {
      return c.json({ error: 'request body must be JSON' }, 400);
    }

    let code = body.code;
    let state = body.state ?? null;
    if (!code && body.pasted) {
      const [pastedCode, pastedState] = body.pasted.split('#');
      code = pastedCode;
      state = pastedState ?? null;
    }
    if (!code) return c.json({ error: 'code is required (paste the full "code#state" string)' }, 400);

    try {
      const { secret } = await completePkceFlow(codePasteFlows, id, code, state);
      await store.set(id, 'oauth', secret);
      broadcastChange(id);
      return c.json({ id, connected: true, method: 'oauth' });
    } catch (err) {
      return handleError(c, err);
    }
  });

  // Shared loopback callback for pkce-loopback providers (OpenRouter, Google).
  routes.get('/oauth/callback', async (c) => {
    const flowId = c.req.query('flow');
    const code = c.req.query('code');
    const state = c.req.query('state') ?? null;
    const error = c.req.query('error');
    if (error) return c.html(`<p>OAuth error: ${error}. You can close this tab.</p>`, 400);
    if (!flowId || !code) return c.json({ error: 'missing flow/code in callback' }, 400);

    try {
      const { providerId, secret } = await completePkceFlow(loopbackFlows, flowId, code, state);
      await store.set(providerId, 'oauth', secret);
      broadcastChange(providerId);
      return c.html('<p>Signed in — you can close this tab.</p>');
    } catch (err) {
      if (err instanceof Error) return c.html(`<p>Sign-in failed: ${err.message}</p>`, 400);
      throw err;
    }
  });

  return routes;
}

async function runTest(descriptor: ProviderDescriptor, store: CredentialStore, cred: StoredCredential) {
  try {
    return await descriptor.test(cred, store);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

async function runDeviceCodeFlow(
  providerId: string,
  descriptor: ProviderDescriptor,
  oauth: Extract<ProviderDescriptor['oauth'], { kind: 'device-code' }>,
  clientId: string,
  started: { deviceCode: string; interval: number; expiresIn: number },
  store: CredentialStore,
  broadcastChange: (id: string) => void,
): Promise<void> {
  try {
    const secret = await pollDeviceCode({
      poll: () => oauth.poll(clientId, started.deviceCode),
      intervalSeconds: started.interval,
      expiresInSeconds: started.expiresIn,
    });
    await store.set(providerId, 'oauth', secret);
    broadcastChange(providerId);
  } catch (err) {
    console.error(`${descriptor.name} device-code flow failed:`, err instanceof Error ? err.message : err);
  }
}
