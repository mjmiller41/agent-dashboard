// Production static serving (PLAN.md §9/§11 Phase 6: "server statically
// serves web/dist so the whole app is `npm run build && npm start` ->
// http://localhost:4680"). Only mounted when web/dist actually exists, so
// dev mode (Vite's own dev server + /api proxy, per web/vite.config.ts) is
// completely unaffected — nothing here runs unless a production build has
// happened first.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveStatic } from '@hono/node-server/serve-static';
import type { Hono } from 'hono';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
// server/src/static.ts (or server/dist/static.js after build) -> server -> repo root
const REPO_ROOT = path.resolve(MODULE_DIR, '..', '..');
export const WEB_DIST_DIR = path.join(REPO_ROOT, 'web', 'dist');

/**
 * Mounts a catch-all static file server for `web/dist` at `/`, guarded so it
 * never shadows `/api/*` (an early middleware calls `next()` immediately for
 * any `/api/` path, before serveStatic ever runs), and does nothing at all
 * if `distDir` doesn't exist (i.e. no production build has been run).
 *
 * `distDir` defaults to the real `web/dist` (`WEB_DIST_DIR`); tests pass a
 * temp directory instead so they don't depend on a real build existing.
 */
export function mountStaticSite(app: Hono, distDir: string = WEB_DIST_DIR): boolean {
  if (!existsSync(distDir)) return false;

  app.use('*', async (c, next) => {
    if (c.req.path.startsWith('/api/')) return next();
    return serveStatic({ root: distDir })(c, next);
  });

  return true;
}
