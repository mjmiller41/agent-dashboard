// Lists workspace/flows/*.json via GET /api/ws/tree, filtered client-side —
// same reasoning and pattern as panels/icons/useIconList.ts and
// panels/docs/useDocTree.ts (a directory listing isn't a single
// schema-backed document, so it deliberately bypasses useWorkspaceFile; see
// DECISIONS.md).
import { useCallback, useEffect, useState } from 'react';

export interface FlowFileEntry {
  /** Workspace-relative path, e.g. "flows/deploy-pipeline.json". */
  path: string;
  /** Filename without extension, e.g. "deploy-pipeline" — used as the flow's slug. */
  slug: string;
}

export interface UseFlowListResult {
  flows: FlowFileEntry[] | undefined;
  error: string | undefined;
  loading: boolean;
  refetch: () => void;
}

const FLOWS_PREFIX = 'flows/';

export function useFlowList(): UseFlowListResult {
  const [flows, setFlows] = useState<FlowFileEntry[] | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        const res = await fetch('/api/ws/tree');
        if (!res.ok) throw new Error(`failed to list workspace tree: ${res.status}`);
        const body = (await res.json()) as { tree: Array<{ path: string }> };
        if (cancelled) return;
        const found = body.tree
          .filter((entry) => entry.path.startsWith(FLOWS_PREFIX) && entry.path.endsWith('.json'))
          .map((entry) => ({
            path: entry.path,
            slug: entry.path.slice(FLOWS_PREFIX.length, -'.json'.length),
          }))
          .sort((a, b) => a.slug.localeCompare(b.slug));
        setFlows(found);
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

  const refetch = useCallback(() => setGeneration((g) => g + 1), []);

  return { flows, error, loading, refetch };
}
