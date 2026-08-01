// Generic OAuth engine — four flow variants selected by a descriptor's
// oauth `kind` (PLAN.md §6a "OAuth helper architecture"). Provider-specific
// constants and request/response shapes live in firstparty.ts and
// adapters/*; this file only knows the shared mechanics: PKCE
// verifier/challenge generation, pending-flow bookkeeping, a one-shot
// fixed-port listener, device-code polling with RFC 8628 backoff, and
// refresh-token coalescing.
import { createHash, randomBytes } from 'node:crypto';
import http from 'node:http';
import type { CredentialSecret } from './credentials.ts';

const FLOW_TIMEOUT_MS = 5 * 60 * 1000;

export class OAuthStateMismatchError extends Error {
  constructor() {
    super('OAuth state mismatch — the callback did not match the flow that started it');
    this.name = 'OAuthStateMismatchError';
  }
}

export class OAuthTimeoutError extends Error {
  constructor() {
    super('OAuth flow timed out waiting for the callback');
    this.name = 'OAuthTimeoutError';
  }
}

export class OAuthPortInUseError extends Error {
  readonly port: number;
  constructor(port: number) {
    super(`port ${port} is already in use — close whatever is using it and try again`);
    this.name = 'OAuthPortInUseError';
    this.port = port;
  }
}

export class OAuthFlowNotFoundError extends Error {
  constructor(id: string) {
    super(`no pending OAuth flow for "${id}" (it may have expired — try connecting again)`);
    this.name = 'OAuthFlowNotFoundError';
  }
}

export function base64url(input: Buffer): string {
  return input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface PkceChallenge {
  verifier: string;
  challenge: string;
}

/** S256 PKCE verifier + challenge (RFC 7636). */
export function createPkceChallenge(): PkceChallenge {
  const verifier = base64url(randomBytes(48));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export function generateState(): string {
  return base64url(randomBytes(24));
}

export function generateFlowId(): string {
  return base64url(randomBytes(18));
}

// ---------------------------------------------------------------------------
// pkce-loopback / pkce-code-paste: pending flows keyed by an id the caller
// controls (a `flow` query param on the redirect URI for loopback; the
// providerId itself for code-paste, since only one such flow is in flight
// per provider at a time).
// ---------------------------------------------------------------------------

export interface PendingPkceFlow {
  providerId: string;
  verifier: string;
  state: string;
  redirectUri: string;
  exchangeCode: (ctx: {
    code: string;
    state: string;
    verifier: string;
    redirectUri: string;
  }) => Promise<CredentialSecret>;
}

export class PendingFlowRegistry {
  private readonly pending = new Map<
    string,
    { flow: PendingPkceFlow; timer: ReturnType<typeof setTimeout> }
  >();

  register(id: string, flow: PendingPkceFlow, timeoutMs: number = FLOW_TIMEOUT_MS): void {
    const existing = this.pending.get(id);
    if (existing) clearTimeout(existing.timer);
    const timer = setTimeout(() => this.pending.delete(id), timeoutMs);
    this.pending.set(id, { flow, timer });
  }

  /** Retrieve and remove a pending flow (one-shot — a flowId/providerId is used at most once). */
  take(id: string): PendingPkceFlow | undefined {
    const entry = this.pending.get(id);
    if (!entry) return undefined;
    clearTimeout(entry.timer);
    this.pending.delete(id);
    return entry.flow;
  }

  has(id: string): boolean {
    return this.pending.has(id);
  }

  clear(): void {
    for (const { timer } of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
  }
}

/** Shared by every `pkce-loopback` provider's callback (this app's own
 *  /api/providers/oauth/callback route) — keyed by a per-flow id embedded in
 *  the redirect URI's query string, since not every provider (OpenRouter)
 *  echoes our `state` param back on the redirect. */
export const loopbackFlows = new PendingFlowRegistry();

/** `pkce-code-paste` (Anthropic) — keyed by providerId; no listener, the
 *  wizard POSTs the pasted `code#state` string. */
export const codePasteFlows = new PendingFlowRegistry();

/**
 * Complete a pending PKCE flow: look it up, validate `state` if the caller
 * supplied one to check (loopback callbacks that echo it; code-paste always
 * does since the pasted value *is* `code#state`), then run the
 * provider-specific code exchange.
 */
export async function completePkceFlow(
  registry: PendingFlowRegistry,
  id: string,
  code: string,
  returnedState: string | null,
): Promise<{ providerId: string; secret: CredentialSecret }> {
  const flow = registry.take(id);
  if (!flow) throw new OAuthFlowNotFoundError(id);
  if (returnedState !== null && returnedState !== flow.state) {
    throw new OAuthStateMismatchError();
  }
  const secret = await flow.exchangeCode({
    code,
    state: flow.state,
    verifier: flow.verifier,
    redirectUri: flow.redirectUri,
  });
  return { providerId: flow.providerId, secret };
}

// ---------------------------------------------------------------------------
// pkce-fixed-port: a dedicated one-shot node:http listener bound to a
// registered port (OpenAI: 1455) for the duration of one flow.
// ---------------------------------------------------------------------------

const SUCCESS_HTML =
  '<!doctype html><html><body style="font:14px sans-serif;padding:2rem"><p>Signed in — you can close this tab.</p></body></html>';

export interface FixedPortListener {
  waitForCallback: Promise<{ code: string; state: string }>;
  close: () => void;
}

/**
 * Bind a one-shot HTTP listener on `port` for `redirectPath`. Resolves once
 * the listener is bound (so a caller can surface `OAuthPortInUseError`
 * immediately rather than after the 5-minute flow timeout); the returned
 * `waitForCallback` promise resolves/rejects once the OAuth redirect lands.
 */
export function startFixedPortListener(port: number, redirectPath: string): Promise<FixedPortListener> {
  return new Promise((resolveBind, rejectBind) => {
    let settled = false;
    let resolveCallback!: (v: { code: string; state: string }) => void;
    let rejectCallback!: (e: Error) => void;
    const waitForCallback = new Promise<{ code: string; state: string }>((resolve, reject) => {
      resolveCallback = resolve;
      rejectCallback = reject;
    });
    // Prevent a Node "unhandled rejection" warning between the moment the HTTP
    // callback rejects this promise and the moment the caller's own await/catch
    // picks it up (there can be a tick or two of gap) — this no-op subscriber
    // doesn't consume the rejection for the real caller, Promise rejections fan
    // out to every subscriber.
    waitForCallback.catch(() => undefined);

    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
      if (url.pathname !== redirectPath) {
        res.writeHead(404).end();
        return;
      }
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(SUCCESS_HTML);
      settled = true;
      cleanup();
      if (error) {
        rejectCallback(new Error(`OAuth error: ${error}`));
      } else if (!code || !state) {
        rejectCallback(new Error('OAuth callback missing code/state'));
      } else {
        resolveCallback({ code, state });
      }
    });

    const timeoutTimer = setTimeout(() => {
      if (!settled) {
        cleanup();
        rejectCallback(new OAuthTimeoutError());
      }
    }, FLOW_TIMEOUT_MS);

    function cleanup(): void {
      clearTimeout(timeoutTimer);
      server.close();
    }

    server.once('error', (err: NodeJS.ErrnoException) => {
      cleanup();
      rejectBind(err.code === 'EADDRINUSE' ? new OAuthPortInUseError(port) : err);
    });

    server.listen(port, '127.0.0.1', () => {
      resolveBind({ waitForCallback, close: cleanup });
    });
  });
}

// ---------------------------------------------------------------------------
// device-code: start + poll, RFC 8628 §3.5 backoff (+5s on `slow_down` if the
// server doesn't supply a new interval).
// ---------------------------------------------------------------------------

export interface DevicePollSlowDown {
  status: 'slow_down';
  interval?: number | undefined;
}

export type DevicePollOutcome =
  | { status: 'pending' }
  | DevicePollSlowDown
  | { status: 'success'; result: CredentialSecret }
  | { status: 'error'; message: string };

export interface DeviceCodePollOptions {
  poll: () => Promise<DevicePollOutcome>;
  intervalSeconds: number;
  expiresInSeconds: number;
  /** Injectable for tests; defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Poll a device-code flow to completion (or timeout/error). */
export async function pollDeviceCode(opts: DeviceCodePollOptions): Promise<CredentialSecret> {
  const sleep = opts.sleep ?? defaultSleep;
  let interval = opts.intervalSeconds;
  const deadline = Date.now() + opts.expiresInSeconds * 1000;

  for (;;) {
    await sleep(interval * 1000);
    if (Date.now() > deadline) throw new OAuthTimeoutError();

    const outcome = await opts.poll();
    if (outcome.status === 'success') return outcome.result;
    if (outcome.status === 'slow_down') {
      interval = outcome.interval ?? interval + 5;
      continue;
    }
    if (outcome.status === 'pending') continue;
    throw new Error(outcome.message);
  }
}

// ---------------------------------------------------------------------------
// Refresh-token coalescing: Anthropic (and, defensively, the others) rotate
// the refresh token on every use — two concurrent refreshes with the same
// stale token can wipe out a freshly-stored one, so collapse concurrent
// refresh attempts for the same provider into a single in-flight promise.
// ---------------------------------------------------------------------------

const refreshInFlight = new Map<string, Promise<CredentialSecret>>();

export async function coalescedRefresh(
  providerId: string,
  doRefresh: () => Promise<CredentialSecret>,
): Promise<CredentialSecret> {
  const existing = refreshInFlight.get(providerId);
  if (existing) return existing;
  const promise = doRefresh().finally(() => refreshInFlight.delete(providerId));
  refreshInFlight.set(providerId, promise);
  return promise;
}

/** Exposed for tests only — clears in-flight refresh state between cases. */
export function __clearRefreshInFlightForTests(): void {
  refreshInFlight.clear();
}
