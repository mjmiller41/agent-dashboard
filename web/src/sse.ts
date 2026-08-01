// SSE client for GET /api/events (PLAN.md §5/§7). Dispatches `ws-change`
// events into the store (triggering a refetch of subscribed paths),
// dispatches `provider-change` events to any subscribed listeners (Phase 3's
// providers wizard — connection state isn't a workspace file, so it isn't
// routed through store.ts), and reconnects with exponential backoff on
// connection loss.
import { useWorkspaceStore } from './store';

const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;

export type SseConnectionListener = (connected: boolean) => void;
export type ProviderChangeListener = (providerId: string) => void;

interface WsChangePayload {
  type: 'ws-change';
  path: string;
  rev: string;
}

interface ProviderChangePayload {
  type: 'provider-change';
  providerId: string;
}

function isWsChangePayload(value: unknown): value is WsChangePayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'ws-change' &&
    typeof (value as { path?: unknown }).path === 'string' &&
    typeof (value as { rev?: unknown }).rev === 'string'
  );
}

function isProviderChangePayload(value: unknown): value is ProviderChangePayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'provider-change' &&
    typeof (value as { providerId?: unknown }).providerId === 'string'
  );
}

const providerChangeListeners = new Set<ProviderChangeListener>();

/** Subscribe to `provider-change` SSE events (Providers panel live updates). Returns an unsubscribe function. */
export function onProviderChange(listener: ProviderChangeListener): () => void {
  providerChangeListeners.add(listener);
  return () => providerChangeListeners.delete(listener);
}

/**
 * Opens the SSE connection and wires it into the workspace store. Returns a
 * teardown function that closes the connection and cancels any pending
 * reconnect timer.
 */
export function startSse(onConnectionChange?: SseConnectionListener): () => void {
  let source: EventSource | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let backoffMs = INITIAL_BACKOFF_MS;
  let stopped = false;

  function connect(): void {
    source = new EventSource('/api/events');

    source.addEventListener('open', () => {
      backoffMs = INITIAL_BACKOFF_MS;
      onConnectionChange?.(true);
    });

    source.addEventListener('ws-change', (event) => {
      try {
        const payload: unknown = JSON.parse((event as MessageEvent).data as string);
        if (isWsChangePayload(payload)) {
          useWorkspaceStore.getState().handleWsChange(payload.path, payload.rev);
        }
      } catch {
        // malformed event payload — ignore, next event will still be handled
      }
    });

    source.addEventListener('provider-change', (event) => {
      try {
        const payload: unknown = JSON.parse((event as MessageEvent).data as string);
        if (isProviderChangePayload(payload)) {
          for (const listener of providerChangeListeners) listener(payload.providerId);
        }
      } catch {
        // malformed event payload — ignore, next event will still be handled
      }
    });

    source.addEventListener('error', () => {
      onConnectionChange?.(false);
      source?.close();
      source = null;
      if (stopped) return;
      reconnectTimer = setTimeout(() => {
        backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
        connect();
      }, backoffMs);
    });
  }

  connect();

  return () => {
    stopped = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    source?.close();
    source = null;
  };
}
