import { Hono } from 'hono';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Workspace } from '../workspace.ts';
import { createMediaRoutes } from './media.ts';

let root: string;
let app: Hono;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'agent-dashboard-media-routes-'));
  await mkdir(path.join(root, 'icons'), { recursive: true });
  await writeFile(path.join(root, 'icons', 'icon-01.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  await mkdir(path.join(root, 'media'), { recursive: true });
  await writeFile(path.join(root, 'media', 'gen-01.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  const workspace = new Workspace(root);
  app = new Hono();
  app.route('/api/media', createMediaRoutes(workspace));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('GET /api/media', () => {
  it('streams a valid file with the correct content-type', async () => {
    const res = await app.request('/api/media?path=' + encodeURIComponent('icons/icon-01.svg'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/svg+xml');
    const body = await res.text();
    expect(body).toContain('<svg');
  });

  it('resolves content-type by extension for a binary file', async () => {
    const res = await app.request('/api/media?path=' + encodeURIComponent('media/gen-01.png'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    const body = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(body.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('400s when path is missing', async () => {
    const res = await app.request('/api/media');
    expect(res.status).toBe(400);
  });

  it('403s on a path-traversal attempt', async () => {
    const res = await app.request('/api/media?path=' + encodeURIComponent('../../etc/passwd'));
    expect(res.status).toBe(403);
  });

  it('404s for a missing file', async () => {
    const res = await app.request('/api/media?path=' + encodeURIComponent('icons/nope.svg'));
    expect(res.status).toBe(404);
  });

  it('404s for a directory path', async () => {
    const res = await app.request('/api/media?path=icons');
    expect(res.status).toBe(404);
  });
});
