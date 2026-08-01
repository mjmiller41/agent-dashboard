// Fetch + live-refresh for GET /api/providers (PLAN.md §6). Connection
// state is server-side, not a workspace file, so this deliberately does NOT
// go through useWorkspaceFile/store.ts (PLAN.md §12 guardrail 2's "or
// (secrets/chat history only) ~/.agent-dashboard/" carve-out) — it calls the
// route directly and stays live via the `provider-change` SSE events wired
// into sse.ts.
import { useCallback, useEffect, useState } from 'react';
import { onProviderChange } from '../../sse';
import type { ProviderSummary } from './types';

export interface UseProvidersResult {
  providers: ProviderSummary[] | undefined;
  error: string | undefined;
  loading: boolean;
  refetch: () => void;
}

export function useProviders(): UseProvidersResult {
  const [providers, setProviders] = useState<ProviderSummary[] | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        const res = await fetch('/api/providers');
        if (!res.ok) throw new Error(`failed to load providers: ${res.status}`);
        const body = (await res.json()) as { providers: ProviderSummary[] };
        if (cancelled) return;
        setProviders(body.providers);
        setError(undefined);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [generation]);

  useEffect(() => onProviderChange(() => setGeneration((g) => g + 1)), []);

  const refetch = useCallback(() => setGeneration((g) => g + 1), []);

  return { providers, error, loading, refetch };
}
