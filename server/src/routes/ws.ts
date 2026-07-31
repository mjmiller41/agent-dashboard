// GET/PUT/DELETE /api/ws/* — CRUD over workspace files (PLAN.md §5).
import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  Workspace,
  WorkspaceNotFoundError,
  WorkspacePathError,
  WorkspaceValidationError,
} from '../workspace.ts';

export function createWsRoutes(workspace: Workspace): Hono {
  const routes = new Hono();

  routes.get('/tree', async (c) => {
    const tree = await workspace.listTree();
    return c.json({ tree });
  });

  routes.get('/file', async (c) => {
    const relPath = c.req.query('path');
    if (!relPath) return c.json({ error: 'path query param is required' }, 400);
    try {
      const result = await workspace.readFile(relPath);
      return c.json({ path: relPath, kind: result.kind, data: result.data });
    } catch (err) {
      return handleWorkspaceError(c, err);
    }
  });

  routes.put('/file', async (c) => {
    const relPath = c.req.query('path');
    if (!relPath) return c.json({ error: 'path query param is required' }, 400);

    let payload: unknown;
    if (relPath.endsWith('.json')) {
      try {
        payload = await c.req.json();
      } catch {
        return c.json({ error: `request body must be valid JSON for ${relPath}` }, 400);
      }
    } else {
      payload = await c.req.text();
    }

    try {
      const rev = await workspace.writeFile(relPath, payload);
      return c.json({ path: relPath, rev });
    } catch (err) {
      return handleWorkspaceError(c, err);
    }
  });

  routes.delete('/file', async (c) => {
    const relPath = c.req.query('path');
    if (!relPath) return c.json({ error: 'path query param is required' }, 400);
    try {
      await workspace.deleteFile(relPath);
      return c.json({ path: relPath, deleted: true });
    } catch (err) {
      return handleWorkspaceError(c, err);
    }
  });

  return routes;
}

function handleWorkspaceError(c: Context, err: unknown): Response {
  if (err instanceof WorkspacePathError) {
    return c.json({ error: err.message }, 403);
  }
  if (err instanceof WorkspaceValidationError) {
    return c.json({ error: err.message, issues: err.issues }, 400);
  }
  if (err instanceof WorkspaceNotFoundError) {
    return c.json({ error: err.message }, 404);
  }
  console.error(err);
  return c.json({ error: 'internal error' }, 500);
}
