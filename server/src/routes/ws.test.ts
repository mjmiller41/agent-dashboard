import { Hono } from 'hono';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Workspace } from '../workspace.ts';
import { createWsRoutes } from './ws.ts';

let root: string;
let app: Hono;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'agent-dashboard-ws-routes-'));
  await writeFile(
    path.join(root, 'agents.json'),
    JSON.stringify({
      agents: [
        {
          id: 'a1',
          name: 'A',
          role: 'r',
          iconId: 'icon-01.svg',
          status: 'idle',
          lastUpdated: '2026-01-01T00:00:00Z',
        },
      ],
    }),
  );
  const workspace = new Workspace(root);
  app = new Hono();
  app.route('/api/ws', createWsRoutes(workspace));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('GET /api/ws/tree', () => {
  it('lists workspace files', async () => {
    const res = await app.request('/api/ws/tree');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tree: unknown };
    expect(body.tree).toEqual([
      { path: 'agents.json', mtimeMs: expect.any(Number), size: expect.any(Number) },
    ]);
  });
});

describe('GET /api/ws/file', () => {
  it('returns parsed JSON for a .json file', async () => {
    const res = await app.request('/api/ws/file?path=agents.json');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { kind: string; data: { agents: unknown[] } };
    expect(body.kind).toBe('json');
    expect(body.data.agents).toHaveLength(1);
  });

  it('400s when path is missing', async () => {
    const res = await app.request('/api/ws/file');
    expect(res.status).toBe(400);
  });

  it('403s on a path-traversal attempt', async () => {
    const res = await app.request('/api/ws/file?path=' + encodeURIComponent('../../etc/passwd'));
    expect(res.status).toBe(403);
  });

  it('404s for a missing file', async () => {
    const res = await app.request('/api/ws/file?path=nope.json');
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/ws/file', () => {
  it('writes a valid payload and it is readable afterwards', async () => {
    const payload = {
      agents: [
        {
          id: 'a2',
          name: 'B',
          role: 'r',
          iconId: 'icon-02.svg',
          status: 'active',
          lastUpdated: '2026-01-02T00:00:00Z',
        },
      ],
    };
    const putRes = await app.request('/api/ws/file?path=agents.json', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(putRes.status).toBe(200);
    const putBody = (await putRes.json()) as { rev: unknown };
    expect(typeof putBody.rev).toBe('string');

    const getRes = await app.request('/api/ws/file?path=agents.json');
    const getBody = (await getRes.json()) as { data: unknown };
    expect(getBody.data).toEqual(payload);
  });

  it('400s and reports issues for an invalid payload', async () => {
    const res = await app.request('/api/ws/file?path=agents.json', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agents: [{ id: 'bad' }] }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { issues: unknown };
    expect(Array.isArray(body.issues)).toBe(true);
  });

  it('403s on a path-traversal attempt', async () => {
    const res = await app.request('/api/ws/file?path=' + encodeURIComponent('../escape.json'), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/ws/file', () => {
  it('deletes an existing file', async () => {
    const res = await app.request('/api/ws/file?path=agents.json', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const followUp = await app.request('/api/ws/file?path=agents.json');
    expect(followUp.status).toBe(404);
  });

  it('404s for a missing file', async () => {
    const res = await app.request('/api/ws/file?path=nope.json', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });
});
