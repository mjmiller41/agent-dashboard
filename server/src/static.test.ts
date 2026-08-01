// PLAN.md §9/§11 Phase 6: production static serving of web/dist. Uses a
// temp directory (not the real WEB_DIST_DIR) so this test doesn't depend on
// a real `npm run build -w web` having happened first — same isolation
// convention as routes/media.test.ts's temp workspace.
import { Hono } from 'hono';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mountStaticSite } from './static.ts';

let distDir: string;

beforeEach(async () => {
  distDir = await mkdtemp(path.join(tmpdir(), 'agent-dashboard-static-'));
  await writeFile(path.join(distDir, 'index.html'), '<!doctype html><title>shell</title>');
  await mkdir(path.join(distDir, 'assets'), { recursive: true });
  await writeFile(path.join(distDir, 'assets', 'app.js'), 'console.log("app")');
});

afterEach(async () => {
  await rm(distDir, { recursive: true, force: true });
});

describe('mountStaticSite', () => {
  it('returns false and mounts nothing when the dist directory does not exist', () => {
    const app = new Hono();
    app.get('/api/health', (c) => c.json({ status: 'ok' }));
    const mounted = mountStaticSite(app, path.join(distDir, 'does-not-exist'));
    expect(mounted).toBe(false);
  });

  it('returns true and serves index.html at / when the dist directory exists', async () => {
    const app = new Hono();
    app.get('/api/health', (c) => c.json({ status: 'ok' }));
    const mounted = mountStaticSite(app, distDir);
    expect(mounted).toBe(true);

    const res = await app.request('/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('shell');
  });

  it('serves a real asset file with the correct content-type', async () => {
    const app = new Hono();
    mountStaticSite(app, distDir);

    const res = await app.request('/assets/app.js');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('javascript');
    expect(await res.text()).toContain('console.log');
  });

  it('never shadows /api/* routes, even for a path that looks like a file', async () => {
    const app = new Hono();
    app.get('/api/health', (c) => c.json({ status: 'ok' }));
    mountStaticSite(app, distDir);

    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: 'ok' });
  });

  it('404s for an /api/ path that has no matching route, instead of falling through to static serving', async () => {
    const app = new Hono();
    mountStaticSite(app, distDir);

    const res = await app.request('/api/does-not-exist');
    expect(res.status).toBe(404);
  });
});
