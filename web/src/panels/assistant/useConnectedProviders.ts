// Fetch the list of *connected* providers for the picker (PLAN.md §6
// "Assistant panel": "Provider/model picker sourced from the already-
// connected providers"). Deliberately does not import panels/providers'
// useProviders.ts — PLAN.md §12 guardrail 10 forbids panels importing from
// each other; this is a small enough fetch to duplicate rather than share.
import { useCallback, useEffect, useState } from 'react';
import { onProviderChange } from '../../sse';
import type { ConnectedProviderSummary } from './types';

export interface UseConnectedProvidersResult {
  providers: ConnectedProviderSummary[] | undefined;
  loading: boolean;
  error: string | undefined;
  refetch: () => void;
}

export function useConnectedProviders(): UseConnectedProvidersResult {
  const [providers, setProviders] = useState<ConnectedProviderSummary[] | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        const res = await fetch('/api/providers');
        if (!res.ok) throw new Error(`failed to load providers: ${res.status}`);
        const body = (await res.json()) as {
          providers: Array<{ id: string; name: string; connected: boolean }>;
        };
        if (cancelled) return;
        setProviders(body.providers.filter((p) => p.connected).map((p) => ({ id: p.id, name: p.name })));
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
