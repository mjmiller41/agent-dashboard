// chokidar watcher over the workspace root, broadcasting debounced change
// events (PLAN.md §5 GET /api/events). Each event carries a `rev` (see
// workspace.ts computeRev) so a client can tell its own just-written change
// apart from an externally caused one.
import chokidar, { type FSWatcher } from 'chokidar';
import path from 'node:path';
import { computeRev } from './workspace.ts';

const DEBOUNCE_MS = 100;

export interface WsChangeEvent {
  type: 'ws-change';
  path: string;
  rev: string;
}

/**
 * `provider-change` events are typed now (Phase 3 will emit them from the
 * providers routes when a connection's status changes) but nothing emits
 * one yet — see PLAN.md §11 Phase 1 scope note.
 */
export interface ProviderChangeEvent {
  type: 'provider-change';
  providerId: string;
}

export type WorkspaceEvent = WsChangeEvent | ProviderChangeEvent;

export type WorkspaceEventListener = (event: WorkspaceEvent) => void;

function toPosixRelative(root: string, absPath: string): string {
  return path.relative(root, absPath).split(path.sep).join('/');
}

export class WorkspaceWatcher {
  private readonly root: string;
  private watcher: FSWatcher | null = null;
  private readyPromise: Promise<void> | null = null;
  private readonly listeners = new Set<WorkspaceEventListener>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly debounceMs: number;

  constructor(root: string, options: { debounceMs?: number } = {}) {
    this.root = path.resolve(root);
    this.debounceMs = options.debounceMs ?? DEBOUNCE_MS;
  }

  start(): void {
    if (this.watcher) return;
    const watcher = chokidar.watch(this.root, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 20 },
    });
    this.watcher = watcher;
    this.readyPromise = new Promise((resolve) => watcher.once('ready', () => resolve()));
    watcher.on('add', (p) => this.scheduleEmit(p));
    watcher.on('change', (p) => this.scheduleEmit(p));
    watcher.on('unlink', (p) => this.scheduleEmit(p));
  }

  /** Resolves once the initial chokidar scan has completed (watches are live). */
  async ready(): Promise<void> {
    if (!this.readyPromise) throw new Error('WorkspaceWatcher.start() must be called before ready()');
    await this.readyPromise;
  }

  async close(): Promise<void> {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    const watcher = this.watcher;
    this.watcher = null;
    await watcher?.close();
  }

  /** Subscribe to broadcast events; returns an unsubscribe function. */
  subscribe(listener: WorkspaceEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  broadcast(event: WorkspaceEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private scheduleEmit(absPath: string): void {
    const relPath = toPosixRelative(this.root, absPath);
    const existing = this.timers.get(relPath);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.timers.delete(relPath);
      void this.emitChange(relPath);
    }, this.debounceMs);
    this.timers.set(relPath, timer);
  }

  private async emitChange(relPath: string): Promise<void> {
    const rev = await computeRev(this.root, relPath);
    this.broadcast({ type: 'ws-change', path: relPath, rev });
  }
}
