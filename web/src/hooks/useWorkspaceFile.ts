// The one data hook every panel uses to read/write a workspace file
// (PLAN.md §7 / §12 guardrail 3). Wraps the zustand store: fetch + zod-parse
// + subscribe + expose { data, error, save(mutator) }. Parse failures never
// throw into the panel — they come back as `error` (PLAN.md §4).
import { useCallback, useEffect, useMemo } from 'react';
import type { ZodType } from 'zod';
import { useWorkspaceStore } from '../store';

export interface WorkspaceFileIssue {
  path: (string | number | symbol)[];
  message: string;
}

export interface WorkspaceFileError {
  path: string;
  message: string;
  issues?: WorkspaceFileIssue[];
}

export interface UseWorkspaceFileResult<T> {
  data: T | undefined;
  error: WorkspaceFileError | undefined;
  loading: boolean;
  /** Reads the current (validated) value, applies `mutator`, and PUTs the result. See store.ts's
   *  writeFile doc comment for the optimistic-update + echo-suppression choice this makes. */
  save: (mutator: (current: T | undefined) => T) => Promise<void>;
  /** DELETEs this path (Phase 5 part 2 addition — the Docs panel's delete/rename actions need this;
   *  extending the hook rather than a panel reaching for a raw fetch, per PLAN.md §12 guardrail 3). */
  remove: () => Promise<void>;
}

export function useWorkspaceFile<T>(path: string, schema: ZodType<T>): UseWorkspaceFileResult<T> {
  const subscribe = useWorkspaceStore((state) => state.subscribe);
  const writeFile = useWorkspaceStore((state) => state.writeFile);
  const deleteFile = useWorkspaceStore((state) => state.deleteFile);
  const entry = useWorkspaceStore((state) => state.files.get(path));

  useEffect(() => subscribe(path), [path, subscribe]);

  const parsed = useMemo((): { data: T | undefined; error: WorkspaceFileError | undefined } => {
    if (!entry) return { data: undefined, error: undefined };
    if (entry.error) return { data: undefined, error: { path, message: entry.error } };
    if (entry.data === undefined) return { data: undefined, error: undefined };

    const result = schema.safeParse(entry.data);
    if (!result.success) {
      return {
        data: undefined,
        error: {
          path,
          message: `${path} failed schema validation`,
          issues: result.error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
        },
      };
    }
    return { data: result.data, error: undefined };
  }, [entry, path, schema]);

  const save = useCallback(
    async (mutator: (current: T | undefined) => T) => {
      const next = mutator(parsed.data);
      await writeFile(path, next);
    },
    [path, parsed.data, writeFile],
  );

  const remove = useCallback(async () => {
    await deleteFile(path);
  }, [path, deleteFile]);

  return { data: parsed.data, error: parsed.error, loading: entry?.loading ?? true, save, remove };
}
