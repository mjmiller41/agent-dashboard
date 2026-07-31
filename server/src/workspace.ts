// Safe read/write/list inside the workspace root directory (PLAN.md §3/§5).
//
// Every requested relative path is resolved against the root and rejected if
// it would escape it (path traversal, absolute paths, or a symlink pointing
// outside the root). Writes are atomic (temp file + rename). JSON documents
// are validated against the matching zod schema (by filename convention,
// shared/src/schemas/registry.ts) before being written.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  cp,
  mkdir,
  readFile as fsReadFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile as fsWriteFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { schemaForPath } from '@agent-dashboard/shared';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
// server/src/workspace.ts -> server -> repo root
const REPO_ROOT = path.resolve(MODULE_DIR, '..', '..');

export const DEFAULT_WORKSPACE_DIR = path.join(REPO_ROOT, 'workspace');
export const DEFAULT_EXAMPLE_DIR = path.join(REPO_ROOT, 'workspace.example');

/**
 * Resolve the workspace root: `WORKSPACE_DIR` env var if set (absolute as-is,
 * relative resolved against `process.cwd()`), else the repo-root `./workspace`
 * default. Read lazily (not at module load) so callers/tests can vary env.
 */
export function resolveWorkspaceRoot(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.WORKSPACE_DIR;
  if (!configured) return DEFAULT_WORKSPACE_DIR;
  return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
}

/** Rejected path: traversal, absolute path, or symlink escape (403-style). */
export class WorkspacePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspacePathError';
  }
}

/** JSON payload failed zod validation for its filename-convention schema (400-style). */
export class WorkspaceValidationError extends Error {
  readonly issues: unknown;
  constructor(message: string, issues: unknown) {
    super(message);
    this.name = 'WorkspaceValidationError';
    this.issues = issues;
  }
}

/** Requested file does not exist (404-style). */
export class WorkspaceNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceNotFoundError';
  }
}

export interface TreeEntry {
  /** Workspace-relative, posix-separated path. */
  path: string;
  mtimeMs: number;
  size: number;
}

export type ReadFileResult = { kind: 'json'; data: unknown } | { kind: 'text'; data: string };

/**
 * Resolve the current on-disk state of a workspace-relative path into a
 * short, opaque "rev" string (hash of path + mtime + size, or a
 * uniqueness marker if the file no longer exists). Used to tag SSE
 * change events (PLAN.md §5 "echo suppression") and PUT responses so a
 * client can tell whether an incoming SSE event reflects its own write.
 */
export async function computeRev(root: string, relPath: string): Promise<string> {
  const absPath = path.resolve(root, relPath);
  try {
    const stats = await stat(absPath);
    return hashRev(`${relPath}:${stats.mtimeMs}:${stats.size}`);
  } catch {
    return hashRev(`${relPath}:deleted:${process.hrtime.bigint().toString()}`);
  }
}

function hashRev(input: string): string {
  return createHash('sha1').update(input).digest('hex').slice(0, 12);
}

function toPosix(relPath: string): string {
  return relPath.split(path.sep).join('/');
}

export class Workspace {
  readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  /** If the workspace root doesn't exist yet, seed it from workspace.example/. */
  async ensureInitialized(exampleDir: string = DEFAULT_EXAMPLE_DIR): Promise<void> {
    if (existsSync(this.root)) return;
    await mkdir(path.dirname(this.root), { recursive: true });
    await cp(exampleDir, this.root, { recursive: true });
  }

  /**
   * Resolve + guard a workspace-relative path. Throws WorkspacePathError for
   * absolute paths, `..` traversal escaping the root, or a symlink (on an
   * existing ancestor) that resolves outside the root.
   */
  async resolveGuarded(relPath: string): Promise<string> {
    if (typeof relPath !== 'string' || relPath.length === 0) {
      throw new WorkspacePathError('path is required');
    }
    if (path.isAbsolute(relPath)) {
      throw new WorkspacePathError(`absolute paths are not allowed: ${relPath}`);
    }

    const normalizedRoot = this.root;
    const withSep = normalizedRoot.endsWith(path.sep) ? normalizedRoot : normalizedRoot + path.sep;
    const resolved = path.resolve(normalizedRoot, relPath);
    if (resolved !== normalizedRoot && !resolved.startsWith(withSep)) {
      throw new WorkspacePathError(`path escapes workspace root: ${relPath}`);
    }

    await this.assertNoSymlinkEscape(resolved);
    return resolved;
  }

  /**
   * Walk up from `absPath` to the nearest existing ancestor and verify its
   * real (symlink-resolved) location is still inside the workspace root.
   * Catches the common case of a symlink placed under the workspace
   * pointing outside it; not a full canonicalization of every path segment.
   */
  private async assertNoSymlinkEscape(absPath: string): Promise<void> {
    const normalizedRoot = await realpath(this.root).catch(() => this.root);
    const withSep = normalizedRoot.endsWith(path.sep) ? normalizedRoot : normalizedRoot + path.sep;

    let current = absPath;
    for (;;) {
      try {
        const real = await realpath(current);
        if (real !== normalizedRoot && !real.startsWith(withSep)) {
          throw new WorkspacePathError(`path escapes workspace root via symlink: ${absPath}`);
        }
        return;
      } catch (err) {
        if (err instanceof WorkspacePathError) throw err;
        const parent = path.dirname(current);
        if (parent === current) return; // reached filesystem root; nothing exists, nothing to check
        current = parent;
      }
    }
  }

  /** Recursive listing of every file under the workspace root. */
  async listTree(): Promise<TreeEntry[]> {
    const entries: TreeEntry[] = [];
    await this.walk(this.root, entries);
    entries.sort((a, b) => a.path.localeCompare(b.path));
    return entries;
  }

  private async walk(dir: string, out: TreeEntry[]): Promise<void> {
    const dirents = await readdir(dir, { withFileTypes: true });
    for (const dirent of dirents) {
      const absPath = path.join(dir, dirent.name);
      if (dirent.isDirectory()) {
        await this.walk(absPath, out);
      } else if (dirent.isFile()) {
        const stats = await stat(absPath);
        out.push({
          path: toPosix(path.relative(this.root, absPath)),
          mtimeMs: stats.mtimeMs,
          size: stats.size,
        });
      }
    }
  }

  /** Read a workspace file: JSON-parsed for `.json`, raw string otherwise. */
  async readFile(relPath: string): Promise<ReadFileResult> {
    const absPath = await this.resolveGuarded(relPath);
    let raw: string;
    try {
      raw = await fsReadFile(absPath, 'utf8');
    } catch (err) {
      if (isErrnoException(err) && err.code === 'ENOENT') {
        throw new WorkspaceNotFoundError(`no such workspace file: ${relPath}`);
      }
      throw err;
    }

    if (relPath.endsWith('.json')) {
      try {
        return { kind: 'json', data: JSON.parse(raw) as unknown };
      } catch (err) {
        throw new WorkspaceValidationError(
          `${relPath} is not valid JSON`,
          err instanceof Error ? err.message : err,
        );
      }
    }
    return { kind: 'text', data: raw };
  }

  /**
   * Write a workspace file. JSON documents are validated against the
   * filename-convention schema (shared/src/schemas/registry.ts) before
   * being written; the write itself is atomic (temp file + rename).
   * Returns the new rev for the written path.
   */
  async writeFile(relPath: string, payload: unknown): Promise<string> {
    const absPath = await this.resolveGuarded(relPath);

    let content: string;
    if (relPath.endsWith('.json')) {
      const schema = schemaForPath(relPath);
      if (schema) {
        const result = schema.safeParse(payload);
        if (!result.success) {
          throw new WorkspaceValidationError(`${relPath} failed schema validation`, result.error.issues);
        }
        content = JSON.stringify(result.data, null, 2) + '\n';
      } else {
        content = JSON.stringify(payload, null, 2) + '\n';
      }
    } else {
      if (typeof payload !== 'string') {
        throw new WorkspaceValidationError(
          `${relPath} expects raw text content, got ${typeof payload}`,
          null,
        );
      }
      content = payload;
    }

    await mkdir(path.dirname(absPath), { recursive: true });
    const tmpPath = path.join(
      path.dirname(absPath),
      `.${path.basename(absPath)}.${process.pid}.${process.hrtime.bigint()}.tmp`,
    );
    await fsWriteFile(tmpPath, content, 'utf8');
    await rename(tmpPath, absPath);

    return computeRev(this.root, relPath);
  }

  async deleteFile(relPath: string): Promise<void> {
    const absPath = await this.resolveGuarded(relPath);
    try {
      await rm(absPath);
    } catch (err) {
      if (isErrnoException(err) && err.code === 'ENOENT') {
        throw new WorkspaceNotFoundError(`no such workspace file: ${relPath}`);
      }
      throw err;
    }
  }
}

function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
