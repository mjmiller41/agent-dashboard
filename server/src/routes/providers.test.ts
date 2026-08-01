// Integration tests for /api/providers/* routed through a real Hono app,
// same style as ws.test.ts/events.test.ts. Uses a temp CredentialStore/
// SettingsStore dir and a mock watcher (only `broadcast` is asserted on).
// Provider-specific HTTP calls (registry.ts's test()/listModels()) are not
// mocked here — those code paths are covered live in DECISIONS.md's "Phase
// 3" verification notes; these tests exercise the route/store plumbing
// itself using providers whose test() doesn't require a real network call
// to assert on (ollama's reachability check naturally fails fast against a
// bogus baseUrl, which is exactly the "fake key round-trips, test reports
// failure" acceptance path from the build brief).
import { Hono } from 'hono';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CredentialStore } from '../providers/credentials.ts';
import { loopbackFlows } from '../providers/oauth.ts';
import { SettingsStore } from '../providers/settings.ts';
import type { WorkspaceEvent } from '../watch.ts';
import { createProvidersRoutes, parseCallbackParams } from './providers.ts';

let dir: string;
let app: Hono;
let broadcast: ReturnType<typeof vi.fn<(event: WorkspaceEvent) => void>>;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'agent-dashboard-providers-routes-'));
  const store = new CredentialStore(dir);
  const settings = new SettingsStore(dir);
  broadcast = vi.fn();
  app = new Hono();
  app.route('/api/providers', createProvidersRoutes(store, settings, { broadcast }));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('GET /api/providers', () => {
  it('lists all 7 registry entries, all disconnected, with no secrets', async () => {
    const res = await app.request('/api/providers');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { providers: Array<{ id: string; connected: boolean }> };
    expect(body.providers).toHaveLength(7);
    expect(body.providers.map((p) => p.id).sort()).toEqual(
      ['anthropic', 'custom', 'github-copilot', 'google', 'ollama', 'openai', 'openrouter'].sort(),
    );
    for (const p of body.providers) {
      expect(p.connected).toBe(false);
      expect(p).not.toHaveProperty('maskedKey');
      expect(p).not.toHaveProperty('accessToken');
    }
  });
});

describe('POST /api/providers/:id/apikey', () => {
  it('round-trips a fake key through the credential store and reports the test failure', async () => {
    const res = await app.request('/api/providers/ollama/apikey', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: '', baseUrl: 'http://127.0.0.1:19' }), // nothing listening there
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { connected: boolean; test: { ok: boolean } };
    expect(body.connected).toBe(true);
    expect(body.test.ok).toBe(false);
    expect(broadcast).toHaveBeenCalledWith({ type: 'provider-change', providerId: 'ollama' });

    const listRes = await app.request('/api/providers');
    const listBody = (await listRes.json()) as {
      providers: Array<{ id: string; connected: boolean; maskedKey?: string }>;
    };
    const ollama = listBody.providers.find((p) => p.id === 'ollama')!;
    expect(ollama.connected).toBe(true);
  });

  it('400s for an unknown provider id', async () => {
    const res = await app.request('/api/providers/nope/apikey', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'x' }),
    });
    expect(res.status).toBe(404);
  });

  it('400s when key is missing and the provider requires one', async () => {
    const res = await app.request('/api/providers/anthropic/apikey', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('masks the stored key in subsequent GET /api/providers responses', async () => {
    await app.request('/api/providers/custom/apikey', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'sk-verysecretvalue1234', baseUrl: 'http://127.0.0.1:19' }),
    });
    const res = await app.request('/api/providers');
    const body = (await res.json()) as { providers: Array<{ id: string; maskedKey?: string }> };
    const custom = body.providers.find((p) => p.id === 'custom')!;
    expect(custom.maskedKey).toBeDefined();
    expect(custom.maskedKey).not.toContain('verysecretvalue');
  });
});

describe('DELETE /api/providers/:id', () => {
  it('disconnects and removes the stored credential', async () => {
    await app.request('/api/providers/ollama/apikey', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: '' }),
    });
    const res = await app.request('/api/providers/ollama', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(broadcast).toHaveBeenCalledWith({ type: 'provider-change', providerId: 'ollama' });

    const listRes = await app.request('/api/providers');
    const listBody = (await listRes.json()) as { providers: Array<{ id: string; connected: boolean }> };
    expect(listBody.providers.find((p) => p.id === 'ollama')?.connected).toBe(false);
  });
});

describe('POST /api/providers/:id/test and GET /:id/models', () => {
  it('400s when not connected', async () => {
    const testRes = await app.request('/api/providers/anthropic/test', { method: 'POST' });
    expect(testRes.status).toBe(400);
    const modelsRes = await app.request('/api/providers/anthropic/models');
    expect(modelsRes.status).toBe(400);
  });

  it('404s for an unknown provider', async () => {
    expect((await app.request('/api/providers/nope/test', { method: 'POST' })).status).toBe(404);
    expect((await app.request('/api/providers/nope/models')).status).toBe(404);
  });
});

describe('OAuth start/callback plumbing', () => {
  it('pkce-loopback (openrouter): start returns an authUrl with a flow id embedded', async () => {
    const res = await app.request('/api/providers/openrouter/oauth/start', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { kind: string; authUrl: string };
    expect(body.kind).toBe('pkce-loopback');
    expect(body.authUrl).toContain('code_challenge=');
    expect(body.authUrl).toMatch(/flow%3D/);
  });

  it('pkce-code-paste (anthropic): start returns an authUrl with client id + scopes', async () => {
    const res = await app.request('/api/providers/anthropic/oauth/start', { method: 'POST' });
    const body = (await res.json()) as { kind: string; authUrl: string };
    expect(body.kind).toBe('pkce-code-paste');
    expect(body.authUrl).toContain('client_id=9d1c250a');
    expect(body.authUrl).toContain('user%3Ainference');
  });

  it('device-code (github-copilot) start returns the user code from a mocked GitHub response', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          device_code: 'devcode-123',
          user_code: 'ABCD-1234',
          verification_uri: 'https://github.com/login/device',
          expires_in: 900,
          interval: 5,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    try {
      const res = await app.request('/api/providers/github-copilot/oauth/start', { method: 'POST' });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { kind: string; userCode: string; verificationUri: string };
      expect(body.kind).toBe('device-code');
      expect(body.userCode).toBe('ABCD-1234');
      expect(body.verificationUri).toBe('https://github.com/login/device');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('GET /oauth/callback 400s with a clear message for an unknown flow id', async () => {
    const res = await app.request('/api/providers/oauth/callback?flow=nonexistent&code=abc');
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toMatch(/Sign-in failed/);
  });

  it('GET /oauth/callback rejects a state mismatch for a real pending flow', async () => {
    const startRes = await app.request('/api/providers/google/oauth/start', { method: 'POST' });
    const { authUrl } = (await startRes.json()) as { authUrl: string };
    const flowId = new URL(authUrl).searchParams.get('redirect_uri');
    const flow = flowId ? new URL(decodeURIComponent(flowId)).searchParams.get('flow') : null;
    expect(flow).not.toBeNull();

    const res = await app.request(
      `/api/providers/oauth/callback?flow=${flow}&code=abc&state=definitely-wrong`,
    );
    expect(res.status).toBe(400);
  });
});

describe('GET/POST /api/providers/settings', () => {
  it('starts unaccepted and persists acceptance', async () => {
    const before = await app.request('/api/providers/settings');
    expect((await before.json()) as { firstPartyConsentAccepted: boolean }).toEqual({
      firstPartyConsentAccepted: false,
    });

    const accept = await app.request('/api/providers/settings/consent', { method: 'POST' });
    expect((await accept.json()) as { firstPartyConsentAccepted: boolean }).toEqual({
      firstPartyConsentAccepted: true,
    });

    const after = await app.request('/api/providers/settings');
    expect((await after.json()) as { firstPartyConsentAccepted: boolean }).toEqual({
      firstPartyConsentAccepted: true,
    });
  });
});

// --- OAuth loopback redirect_uri consistency (#16 follow-up) ---------------
//
// RFC 6749 §4.1.3: the token request's redirect_uri MUST be identical to the
// one sent in the authorize request. Google enforces this strictly and fails
// the exchange with invalid_grant otherwise.
//
// This regressed because the flow registered the bare callback URI while each
// provider's buildAuthorizeUrl appended `?flow=<id>` itself, so the two
// silently diverged. These tests pin them together by construction.
describe('pkce-loopback redirect_uri consistency', () => {
  it.each(['google', 'openrouter'])(
    '%s sends the same redirect_uri it stores for the exchange',
    async (providerId) => {
      const res = await app.request(`/api/providers/${providerId}/oauth/start`, { method: 'POST' });
      expect(res.status).toBe(200);
      const { authUrl } = (await res.json()) as { authUrl: string };

      // The URI actually presented to the provider.
      const params = new URL(authUrl).searchParams;
      const sentUri = params.get('redirect_uri') ?? params.get('callback_url');
      expect(sentUri).toBeTruthy();

      // The flow id travels inside that URI; the exchange will replay whatever
      // the flow has stored.
      const flowId = new URL(sentUri!).searchParams.get('flow');
      expect(flowId).toBeTruthy();

      // `take` is destructive, which is fine here and also proves the flow was
      // registered under exactly the id embedded in the redirect URI.
      const stored = loopbackFlows.take(flowId!);
      expect(stored, 'flow should be registered under the id in the redirect URI').toBeTruthy();
      expect(stored!.redirectUri).toBe(sentUri);
    },
  );

  it('does not append the flow id twice', async () => {
    const res = await app.request('/api/providers/google/oauth/start', { method: 'POST' });
    const { authUrl } = (await res.json()) as { authUrl: string };
    const sentUri = new URL(authUrl).searchParams.get('redirect_uri')!;
    expect(sentUri.match(/flow=/g)).toHaveLength(1);
  });
});

describe('parseCallbackParams', () => {
  it('parses a normal callback query', () => {
    const p = parseCallbackParams('/api/providers/oauth/callback?flow=abc&code=xyz&state=s');
    expect(p.get('flow')).toBe('abc');
    expect(p.get('code')).toBe('xyz');
    expect(p.get('state')).toBe('s');
  });

  it('recovers when the provider appends its result with a second "?"', () => {
    // OpenRouter-style naive concatenation onto a callback_url that already
    // has a query. A strict parse yields flow="abc?code=xyz" and no code,
    // surfacing as a misleading "redirected back without a code".
    const p = parseCallbackParams('/api/providers/oauth/callback?flow=abc?code=xyz');
    expect(p.get('flow')).toBe('abc');
    expect(p.get('code')).toBe('xyz');
  });

  it('returns nothing for a query-less URL', () => {
    expect([...parseCallbackParams('/api/providers/oauth/callback')]).toEqual([]);
  });
});
