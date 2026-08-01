// zustand store: the one place workspace file data lives in memory
// (PLAN.md §7 / §12 guardrail 2 — files on disk are still the database,
// this is just a fetch cache + subscription ledger over them).
import { create } from 'zustand';

export interface FileEntry {
  /** Last successfully fetched/written raw value (JSON-parsed for .json paths, string otherwise). */
  data: unknown;
  /** Rev of `data`, when known (from a PUT response or an SSE ws-change event). Used for echo suppression. */
  rev: string | null;
  /** Transport/parse-at-the-store-level error (network failure, non-2xx, invalid JSON). Schema validation
   *  errors are a hook-level concern (useWorkspaceFile), not stored here. */
  error: string | null;
  loading: boolean;
}

interface WorkspaceStoreState {
  files: Map<string, FileEntry>;
  /** Refcounted per-path subscription: fetches on first subscriber, refetches are gated by refcount > 0. */
  refCounts: Map<string, number>;
  /** Register interest in a path; fetches it if not already loaded. Returns an unsubscribe function. */
  subscribe: (path: string) => () => void;
  /** Force a refetch of a path from the server. */
  refetch: (path: string) => Promise<void>;
  /** PUT a new value for a path. Updates the local cache optimistically from the server's response
   *  (see DECISIONS.md "Phase 2 — Shell" for why: it lets the corresponding SSE ws-change event be
   *  echo-suppressed by comparing revs, avoiding a redundant GET round-trip for our own write). */
  writeFile: (path: string, payload: unknown) => Promise<{ rev: string }>;
  /** DELETE a path (Phase 5 part 2 addition, for the Docs panel's delete/rename actions — see
   *  DECISIONS.md "Phase 5 — Panels (part 2)"). Clears the local cache entry for the path on success. */
  deleteFile: (path: string) => Promise<void>;
  /** Called by sse.ts when a `ws-change` event arrives; refetches the path unless it's an echo of our
   *  own last write (same rev) or nobody is subscribed to it. */
  handleWsChange: (path: string, rev: string) => void;
}

function encodePath(path: string): string {
  return `/api/ws/file?path=${encodeURIComponent(path)}`;
}

async function parseErrorBody(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error ?? `request failed: ${res.status}`;
  } catch {
    return `request failed: ${res.status}`;
  }
}

function setEntry(
  state: WorkspaceStoreState,
  path: string,
  patch: Partial<FileEntry>,
): Pick<WorkspaceStoreState, 'files'> {
  const files = new Map(state.files);
  const base: FileEntry = files.get(path) ?? { data: undefined, rev: null, error: null, loading: false };
  files.set(path, { ...base, ...patch });
  return { files };
}

export const useWorkspaceStore = create<WorkspaceStoreState>((set, get) => ({
  files: new Map(),
  refCounts: new Map(),

  subscribe(path) {
    const { refCounts } = get();
    const count = refCounts.get(path) ?? 0;
    const nextCounts = new Map(refCounts);
    nextCounts.set(path, count + 1);
    set({ refCounts: nextCounts });

    if (count === 0) {
      void get().refetch(path);
    }

    return () => {
      const current = get().refCounts.get(path) ?? 1;
      const updated = new Map(get().refCounts);
      if (current <= 1) {
        updated.delete(path);
      } else {
        updated.set(path, current - 1);
      }
      set({ refCounts: updated });
    };
  },

  async refetch(path) {
    set((state) => setEntry(state, path, { loading: true, error: null }));
    try {
      const res = await fetch(encodePath(path));
      if (!res.ok) throw new Error(await parseErrorBody(res));
      const body = (await res.json()) as { data: unknown };
      set((state) => setEntry(state, path, { data: body.data, error: null, loading: false }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set((state) => setEntry(state, path, { error: message, loading: false }));
    }
  },

  async writeFile(path, payload) {
    const isJson = path.endsWith('.json');
    const res = await fetch(encodePath(path), {
      method: 'PUT',
      headers: { 'content-type': isJson ? 'application/json' : 'text/plain' },
      body: isJson ? JSON.stringify(payload) : String(payload),
    });
    if (!res.ok) throw new Error(await parseErrorBody(res));
    const body = (await res.json()) as { rev: string };
    set((state) => setEntry(state, path, { data: payload, rev: body.rev, error: null, loading: false }));
    return body;
  },

  async deleteFile(path) {
    const res = await fetch(encodePath(path), { method: 'DELETE' });
    if (!res.ok) throw new Error(await parseErrorBody(res));
    set((state) => {
      const files = new Map(state.files);
      files.delete(path);
      return { files };
    });
  },

  handleWsChange(path, rev) {
    const { refCounts, files } = get();
    if ((refCounts.get(path) ?? 0) <= 0) return; // nobody subscribed, nothing to refetch
    if (files.get(path)?.rev === rev) return; // echo of our own last write, already applied
    void get()
      .refetch(path)
      .then(() => {
        set((state) => setEntry(state, path, { rev }));
      });
  },
}));
