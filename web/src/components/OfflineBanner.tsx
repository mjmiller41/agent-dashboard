// Persistent "server unreachable" banner (PLAN.md §9: "Offline/server-down
// banner... show persistent 'Disconnected — data may be stale' bar;
// auto-retry with backoff; clear on reconnect"). Reconnect/backoff already
// live in sse.ts (Phase 2) — this component just renders the current state
// via useSseConnection, following the same reusable-primitive convention as
// EmptyState/ErrorCard (components/, one file per concern, no panel-specific
// logic).
import { useSseConnection } from '../hooks/useSseConnection';

export function OfflineBanner() {
  const connected = useSseConnection();
  if (connected) return null;

  return (
    <div className="offline-banner" role="status">
      Disconnected — data may be stale. Retrying…
    </div>
  );
}
