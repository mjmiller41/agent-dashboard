// Singleton Workspace + WorkspaceWatcher used by the running server
// (app.ts routes, index.ts startup). Route-level and unit tests should
// construct their own Workspace/WorkspaceWatcher against a temp directory
// instead of importing this module, to stay isolated from the real
// ./workspace/ directory.
import { Workspace, resolveWorkspaceRoot } from './workspace.ts';
import { WorkspaceWatcher } from './watch.ts';

export const workspace = new Workspace(resolveWorkspaceRoot());
export const watcher = new WorkspaceWatcher(workspace.root);

let initialized = false;

/**
 * Seed ./workspace from workspace.example/ on first run, then start
 * watching. Returns whether this call actually seeded the workspace (i.e.
 * this was a first run) so index.ts can log the PLAN.md §10 welcome message
 * only then, not on every subsequent boot.
 */
export async function initWorkspace(): Promise<boolean> {
  if (initialized) return false;
  const seeded = await workspace.ensureInitialized();
  watcher.start();
  initialized = true;
  return seeded;
}
