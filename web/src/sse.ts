// SSE client for GET /api/events (PLAN.md §5/§7). Dispatches `ws-change`
// events into the store (triggering a refetch of subscribed paths) and
// reconnects with exponential backoff on connection loss.
import { useWorkspaceStore } from './store';

const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;

export type SseConnectionListener = (connected: boolean) => void;

interface WsChangePayload {
  type: 'ws-change';
  path: string;
  rev: string;
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
