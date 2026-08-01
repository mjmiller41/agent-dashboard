// GET /api/media?path=… — streams files under workspace/ only (images,
// video), per PLAN.md §5. Generic by design: used by the Icons panel
// (workspace/icons/*.svg) now and the Generations panel (workspace/media/*)
// in a later Phase 5 stage — nothing here is icon-specific.
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { Hono } from 'hono';
import { Workspace, WorkspacePathError } from '../workspace.ts';

// Deliberately hand-rolled instead of a mime-type package (PLAN.md §12
// guardrail 6): the set of extensions this route needs to serve (workspace
// icons + generation thumbnails/video) is small and fixed.
const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
};

export function createMediaRoutes(workspace: Workspace): Hono {
  const routes = new Hono();

  routes.get('/', async (c) => {
    const relPath = c.req.query('path');
    if (!relPath) return c.json({ error: 'path query param is required' }, 400);

    let absPath: string;
    try {
      absPath = await workspace.resolveGuarded(relPath);
    } catch (err) {
      if (err instanceof WorkspacePathError) {
        return c.json({ error: err.message }, 403);
      }
      throw err;
    }

    let stats;
    try {
      stats = await stat(absPath);
    } catch {
      return c.json({ error: `no such workspace file: ${relPath}` }, 404);
    }
    if (!stats.isFile()) {
      return c.json({ error: `no such workspace file: ${relPath}` }, 404);
    }

    const ext = path.extname(absPath).toLowerCase();
    const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
    const body = Readable.toWeb(createReadStream(absPath)) as ReadableStream;

    return new Response(body, {
      status: 200,
      headers: {
        'content-type': contentType,
        'content-length': String(stats.size),
        'cache-control': 'no-cache',
      },
    });
  });

  return routes;
}
