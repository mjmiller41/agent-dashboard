// Lists workspace/docs/**/*.md via GET /api/ws/tree, filtered client-side —
// same reasoning and pattern as Phase 5 part 1's panels/icons/useIconList.ts
// (a directory listing isn't a single schema-backed document, so it
// deliberately bypasses useWorkspaceFile; see DECISIONS.md).
import { useCallback, useEffect, useState } from 'react';

export interface DocEntry {
  /** Workspace-relative path including the docs/ prefix, e.g. "docs/architecture/overview.md". */
  path: string;
  /** Path relative to docs/, e.g. "architecture/overview.md" — used to build the file tree. */
  relPath: string;
}

export interface UseDocTreeResult {
  docs: DocEntry[] | undefined;
  error: string | undefined;
  loading: boolean;
  refetch: () => void;
}

const DOCS_PREFIX = 'docs/';

export function useDocTree(): UseDocTreeResult {
  const [docs, setDocs] = useState<DocEntry[] | undefined>(undefined);
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
          .filter((entry) => entry.path.startsWith(DOCS_PREFIX) && entry.path.endsWith('.md'))
          .map((entry) => ({ path: entry.path, relPath: entry.path.slice(DOCS_PREFIX.length) }))
          .sort((a, b) => a.relPath.localeCompare(b.relPath));
        setDocs(found);
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

  return { docs, error, loading, refetch };
}
