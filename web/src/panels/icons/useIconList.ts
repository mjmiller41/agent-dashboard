// Lists workspace/icons/*.svg via GET /api/ws/tree, filtered client-side
// (PLAN.md §8 item 2's implementer note: Workspace.listTree() already
// exposes this generically — no new listing endpoint needed). This is a
// directory listing, not a single schema-backed document, so it
// deliberately doesn't go through useWorkspaceFile (same reasoning as
// panels/providers/useProviders.ts bypassing it for non-file server state —
// see DECISIONS.md).
import { useCallback, useEffect, useState } from 'react';

export interface IconEntry {
  /** Workspace-relative path, e.g. "icons/icon-01.svg". */
  path: string;
  /** Filename only, e.g. "icon-01.svg" — this is the agents.json `iconId` value. */
  id: string;
}

export interface UseIconListResult {
  icons: IconEntry[] | undefined;
  error: string | undefined;
  loading: boolean;
  refetch: () => void;
}

export function useIconList(): UseIconListResult {
  const [icons, setIcons] = useState<IconEntry[] | undefined>(undefined);
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
          .filter((entry) => entry.path.startsWith('icons/') && entry.path.endsWith('.svg'))
          .map((entry) => ({ path: entry.path, id: entry.path.slice('icons/'.length) }))
          .sort((a, b) => a.id.localeCompare(b.id));
        setIcons(found);
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

  return { icons, error, loading, refetch };
}
