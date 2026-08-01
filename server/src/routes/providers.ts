// /api/providers/* — registry + connection status, API-key connect, the
// four-variant OAuth engine, live test, disconnect, model listing
// (PLAN.md §5/§6/§6a). Never returns secrets — GET /api/providers and
// GET /api/providers/:id/models expose `maskedKey` at most.
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { CredentialSecret, CredentialStore, StoredCredential } from '../providers/credentials.ts';
import { maskSecret } from '../providers/credentials.ts';
import {
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
import { ensureFreshCredential } from '../providers/credential-refresh.ts';
import { findProvider, PROVIDERS, type ProviderDescriptor } from '../providers/registry.ts';
import type { SettingsStore } from '../providers/settings.ts';
import type { WorkspaceWatcher } from '../watch.ts';

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
        // The flow id travels INSIDE the redirect URI (OpenRouter never echoes
        // `state` back, so there's nowhere else to put it).
        //
        // It is critical that this exact string is both (a) sent as
        // `redirect_uri` in the authorize request and (b) stored on the flow
        // for the later token exchange. OAuth 2.0 (RFC 6749 §4.1.3) requires
        // the token request's redirect_uri to be *identical* to the authorize
        // request's, and Google enforces that strictly.
        //
        // Previously each provider's buildAuthorizeUrl appended `?flow=`
        // itself while the bare URI was registered on the flow, so the two
        // differed and Google rejected every exchange with invalid_grant.
        // Building it once here is what keeps them in sync -- providers now
        // use this value verbatim.
        const redirectUri = `${origin}/api/providers/oauth/callback?flow=${encodeURIComponent(flowId)}`;
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
    const params = parseCallbackParams(c.req.url);
    const flowId = params.get('flow') ?? undefined;
    const code = params.get('code') ?? undefined;
    const state = params.get('state');
    const error = params.get('error') ?? undefined;
    if (error) return c.html(callbackPage('Sign-in cancelled', `The provider reported: ${error}`), 400);
    if (!flowId || !code) {
      return c.html(
        callbackPage(
          'Sign-in failed',
          'The provider redirected back without a code. Close this tab and try connecting again.',
        ),
        400,
      );
    }

    try {
      const { providerId, secret } = await completePkceFlow(loopbackFlows, flowId, code, state);
      await store.set(providerId, 'oauth', secret);
      broadcastChange(providerId);
      return c.html(
        callbackPage('Signed in — you can close this tab.', 'The dashboard has already updated.', true),
      );
    } catch (err) {
      if (err instanceof Error) return c.html(callbackPage('Sign-in failed', err.message), 400);
      throw err;
    }
  });

  return routes;
}

/**
 * Parses the callback query string, tolerating a second literal `?`.
 *
 * Our redirect URI already carries `?flow=<id>` (it has to: OpenRouter never
 * echoes `state` back, and the URI must stay byte-identical between the
 * authorize and token requests). A provider that appends its result with a
 * naive `url + '?code=...'` therefore produces
 *
 *   /api/providers/oauth/callback?flow=abc?code=xyz
 *
 * where a strict parse yields flow="abc?code=xyz" and no code at all -- the
 * sign-in then fails with a misleading "redirected back without a code".
 * Everything after the first `?` is really a query string, so we normalise
 * any subsequent `?` into `&` before parsing. Providers that append
 * correctly (with `&`) are unaffected.
 */
export function parseCallbackParams(rawUrl: string): URLSearchParams {
  const queryStart = rawUrl.indexOf('?');
  if (queryStart === -1) return new URLSearchParams();
  const query = rawUrl.slice(queryStart + 1).replace(/\?/g, '&');
  return new URLSearchParams(query);
}

/** Minimal self-contained page for the OAuth popup to land on. Deliberately
 *  inline (no app bundle, no SW): this tab is often the user's only signal
 *  that something went wrong, so it must render even with the dashboard
 *  offline, and it must never look like a blank/failed page. */
function callbackPage(title: string, detail: string, success = false): string {
  const escape = (s: string) =>
    s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] ?? ch);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escape(title)}</title>
<style>
  body { font: 15px/1.6 system-ui, sans-serif; background: #14151a; color: #e8e8ee;
         display: grid; place-items: center; height: 100vh; margin: 0; }
  main { max-width: 32rem; padding: 2rem; text-align: center; }
  h1 { font-size: 1.25rem; margin: 0 0 .5rem; color: ${success ? '#5cff9d' : '#ff7a7a'}; }
  p { margin: 0; color: #a0a0b0; }
</style></head>
<body><main><h1>${escape(title)}</h1><p>${escape(detail)}</p></main></body></html>`;
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
