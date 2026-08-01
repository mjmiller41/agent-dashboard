// Unit tests for the generic OAuth engine (PLAN.md §6a): challenge
// generation, state-mismatch rejection, poll backoff, and refresh
// coalescing/rotation — mocked HTTP throughout, per the build brief's
// testing requirement. Live-flow verification is recorded in
// DECISIONS.md "Phase 3" instead (most of these need a real account).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CredentialSecret } from './credentials.ts';
import {
  __clearRefreshInFlightForTests,
  coalescedRefresh,
  completePkceFlow,
  createPkceChallenge,
  generateState,
  OAuthFlowNotFoundError,
  OAuthPortInUseError,
  OAuthStateMismatchError,
  OAuthTimeoutError,
  PendingFlowRegistry,
  pollDeviceCode,
  startFixedPortListener,
} from './oauth.ts';

describe('createPkceChallenge', () => {
  it('derives an S256 challenge from the verifier deterministically', async () => {
    const { verifier, challenge } = createPkceChallenge();
    expect(verifier.length).toBeGreaterThan(32);
    expect(challenge).not.toBe(verifier);

    const { createHash } = await import('node:crypto');
    const expected = createHash('sha256')
      .update(verifier)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(challenge).toBe(expected);
  });

  it('generates a different verifier/challenge pair every call', () => {
    const a = createPkceChallenge();
    const b = createPkceChallenge();
    expect(a.verifier).not.toBe(b.verifier);
    expect(a.challenge).not.toBe(b.challenge);
  });

  it('is URL-safe (no +, /, or = padding)', () => {
    for (let i = 0; i < 20; i++) {
      const { verifier, challenge } = createPkceChallenge();
      expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });
});

describe('generateState', () => {
  it('generates unique, URL-safe values', () => {
    const a = generateState();
    const b = generateState();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('completePkceFlow (pkce-loopback / pkce-code-paste mechanics)', () => {
  it('exchanges the code once state matches and removes the pending flow', async () => {
    const registry = new PendingFlowRegistry();
    const exchangeCode = vi.fn(async () => ({ accessToken: 'at', refreshToken: 'rt' }) as CredentialSecret);
    registry.register('flow-1', {
      providerId: 'openrouter',
      verifier: 'verifier-1',
      state: 'state-1',
      redirectUri: 'http://127.0.0.1:4680/api/providers/oauth/callback',
      exchangeCode,
    });

    const result = await completePkceFlow(registry, 'flow-1', 'code-abc', 'state-1');

    expect(result.providerId).toBe('openrouter');
    expect(result.secret.accessToken).toBe('at');
    expect(exchangeCode).toHaveBeenCalledWith({
      code: 'code-abc',
      state: 'state-1',
      verifier: 'verifier-1',
      redirectUri: 'http://127.0.0.1:4680/api/providers/oauth/callback',
    });
    // one-shot: the same flow id can't be completed twice
    expect(registry.has('flow-1')).toBe(false);
  });

  it('rejects a state mismatch and never calls exchangeCode (mocked HTTP untouched)', async () => {
    const registry = new PendingFlowRegistry();
    const exchangeCode = vi.fn(async () => ({ accessToken: 'should-not-happen' }) as CredentialSecret);
    registry.register('flow-2', {
      providerId: 'google',
      verifier: 'verifier-2',
      state: 'expected-state',
      redirectUri: 'http://127.0.0.1:4680/api/providers/oauth/callback',
      exchangeCode,
    });

    await expect(completePkceFlow(registry, 'flow-2', 'code-abc', 'wrong-state')).rejects.toBeInstanceOf(
      OAuthStateMismatchError,
    );
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  it('allows a null returnedState through (providers that never echo state, e.g. OpenRouter)', async () => {
    const registry = new PendingFlowRegistry();
    const exchangeCode = vi.fn(async () => ({ apiKey: 'sk-or-v1-x' }) as CredentialSecret);
    registry.register('flow-3', {
      providerId: 'openrouter',
      verifier: 'verifier-3',
      state: 'state-3',
      redirectUri: '',
      exchangeCode,
    });

    const result = await completePkceFlow(registry, 'flow-3', 'code-xyz', null);
    expect(result.secret.apiKey).toBe('sk-or-v1-x');
  });

  it('throws OAuthFlowNotFoundError for an unknown/expired flow id', async () => {
    const registry = new PendingFlowRegistry();
    await expect(completePkceFlow(registry, 'nonexistent', 'code', 'state')).rejects.toBeInstanceOf(
      OAuthFlowNotFoundError,
    );
  });
});

describe('startFixedPortListener (pkce-fixed-port)', () => {
  const TEST_PORT = 18455; // avoid the real OpenAI-registered 1455 in tests

  it('resolves the callback with code/state once the redirect lands', async () => {
    const listener = await startFixedPortListener(TEST_PORT, '/auth/callback');
    try {
      const res = await fetch(`http://127.0.0.1:${TEST_PORT}/auth/callback?code=abc123&state=xyz789`);
      expect(res.status).toBe(200);
      const result = await listener.waitForCallback;
      expect(result).toEqual({ code: 'abc123', state: 'xyz789' });
    } finally {
      listener.close();
    }
  });

  it('rejects with OAuthPortInUseError when the port is already bound', async () => {
    const first = await startFixedPortListener(TEST_PORT, '/auth/callback');
    try {
      await expect(startFixedPortListener(TEST_PORT, '/auth/callback')).rejects.toBeInstanceOf(
        OAuthPortInUseError,
      );
    } finally {
      first.close();
    }
  });

  it('rejects the callback promise when the redirect carries an error param', async () => {
    const listener = await startFixedPortListener(TEST_PORT, '/auth/callback');
    try {
      await fetch(`http://127.0.0.1:${TEST_PORT}/auth/callback?error=access_denied`);
      await expect(listener.waitForCallback).rejects.toThrow(/OAuth error/);
    } finally {
      listener.close();
    }
  });
});

describe('pollDeviceCode (device-code backoff)', () => {
  it('polls at the given interval and resolves on success', async () => {
    const sleep = vi.fn(async () => undefined);
    let calls = 0;
    const poll = vi.fn(async () => {
      calls += 1;
      if (calls < 3) return { status: 'pending' as const };
      return { status: 'success' as const, result: { accessToken: 'gho_abc' } };
    });

    const result = await pollDeviceCode({ poll, intervalSeconds: 5, expiresInSeconds: 900, sleep });

    expect(result).toEqual({ accessToken: 'gho_abc' });
    expect(poll).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledWith(5000);
  });

  it('applies RFC 8628 backoff on slow_down (uses server interval, or +5s if absent)', async () => {
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => undefined);
    let calls = 0;
    const poll = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return { status: 'slow_down' as const, interval: undefined };
      if (calls === 2) return { status: 'slow_down' as const, interval: 20 };
      return { status: 'success' as const, result: { accessToken: 'gho_abc' } };
    });

    await pollDeviceCode({ poll, intervalSeconds: 5, expiresInSeconds: 900, sleep });

    // call 1: sleep(5000) then slow_down with no interval -> +5s => 10s
    // call 2: sleep(10000) then slow_down with interval=20 -> 20s
    // call 3: sleep(20000) then success
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([5000, 10000, 20000]);
  });

  it('throws on a terminal error outcome', async () => {
    const sleep = vi.fn(async () => undefined);
    const poll = vi.fn(async () => ({ status: 'error' as const, message: 'access_denied' }));
    await expect(pollDeviceCode({ poll, intervalSeconds: 1, expiresInSeconds: 900, sleep })).rejects.toThrow(
      'access_denied',
    );
  });

  it('times out once past expiresInSeconds', async () => {
    let now = 0;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const sleep = vi.fn(async (ms: number) => {
      now += ms;
    });
    const poll = vi.fn(async () => ({ status: 'pending' as const }));

    await expect(
      pollDeviceCode({ poll, intervalSeconds: 5, expiresInSeconds: 9, sleep }),
    ).rejects.toBeInstanceOf(OAuthTimeoutError);
    nowSpy.mockRestore();
  });
});

describe('coalescedRefresh', () => {
  beforeEach(() => __clearRefreshInFlightForTests());
  afterEach(() => __clearRefreshInFlightForTests());

  it('coalesces two concurrent refreshes for the same provider into one call', async () => {
    let callCount = 0;
    const doRefresh = vi.fn(async () => {
      callCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { accessToken: `token-${callCount}`, refreshToken: `refresh-${callCount}` } as CredentialSecret;
    });

    const [a, b] = await Promise.all([
      coalescedRefresh('anthropic', doRefresh),
      coalescedRefresh('anthropic', doRefresh),
    ]);

    expect(doRefresh).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(a.accessToken).toBe('token-1');
  });

  it('does not coalesce refreshes for different providers', async () => {
    const doRefreshA = vi.fn(async () => ({ accessToken: 'a' }) as CredentialSecret);
    const doRefreshB = vi.fn(async () => ({ accessToken: 'b' }) as CredentialSecret);

    await Promise.all([coalescedRefresh('anthropic', doRefreshA), coalescedRefresh('openai', doRefreshB)]);

    expect(doRefreshA).toHaveBeenCalledTimes(1);
    expect(doRefreshB).toHaveBeenCalledTimes(1);
  });

  it('allows a fresh refresh after the in-flight one settles (new rotated token each time)', async () => {
    let callCount = 0;
    const doRefresh = vi.fn(async () => {
      callCount += 1;
      return { accessToken: `token-${callCount}` } as CredentialSecret;
    });

    const first = await coalescedRefresh('anthropic', doRefresh);
    const second = await coalescedRefresh('anthropic', doRefresh);

    expect(doRefresh).toHaveBeenCalledTimes(2);
    expect(first.accessToken).toBe('token-1');
    expect(second.accessToken).toBe('token-2');
  });
});
