import { useEffect, useState } from 'react';

type HealthState =
  { status: 'loading' } | { status: 'ok'; body: unknown } | { status: 'error'; message: string };

// Phase 0 placeholder page: proves the Vite dev proxy reaches the Hono
// server's /api/health route. The real shell (router/store/theme/tabs)
// lands in Phase 2 (see PLAN.md §7 / §11 Phase 2).
export function App() {
  const [health, setHealth] = useState<HealthState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();

    fetch('/api/health', { signal: controller.signal })
      .then((res) => res.json())
      .then((body: unknown) => setHealth({ status: 'ok', body }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setHealth({ status: 'error', message: err instanceof Error ? err.message : String(err) });
      });

    return () => controller.abort();
  }, []);

  return (
    <main>
      <h1>Agent Dashboard</h1>
      <p>Hello — Phase 0 scaffolding is up.</p>
      <p>
        /api/health via dev proxy: {health.status === 'loading' && 'loading…'}
        {health.status === 'ok' && JSON.stringify(health.body)}
        {health.status === 'error' && `error: ${health.message}`}
      </p>
    </main>
  );
}
