// Integration test: actually touch a file on disk and assert an SSE event
// fires over /api/events, sourced from a real chokidar watcher (watch.ts).
import { Hono } from 'hono';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceWatcher } from '../watch.ts';
import { createEventsRoutes } from './events.ts';

const TIMEOUT = Symbol('read-timeout');

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMEOUT> {
  return Promise.race([
    promise,
    new Promise<typeof TIMEOUT>((resolve) => setTimeout(() => resolve(TIMEOUT), ms)),
  ]);
}

let root: string;
let watcher: WorkspaceWatcher;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'agent-dashboard-events-'));
  watcher = new WorkspaceWatcher(root, { debounceMs: 20 });
  watcher.start();
  await watcher.ready();
});

afterEach(async () => {
  await watcher.close();
  await rm(root, { recursive: true, force: true });
});

describe('GET /api/events', () => {
  it('streams a ws-change SSE event when a workspace file changes on disk', async () => {
    const app = new Hono();
    app.route('/api/events', createEventsRoutes(watcher));

    const res = await app.request('/api/events');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(res.body).not.toBeNull();

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    setTimeout(() => {
      void writeFile(path.join(root, 'agents.json'), '{"agents":[]}');
    }, 50);

    let buffer = '';
    const deadline = Date.now() + 5000;
    while (!buffer.includes('event: ws-change') && Date.now() < deadline) {
      const result = await withTimeout(reader.read(), 500);
      if (result === TIMEOUT) continue;
      if (result.done) break;
      if (result.value) buffer += decoder.decode(result.value);
    }
    await reader.cancel().catch(() => undefined);

    expect(buffer).toContain('event: ws-change');
    expect(buffer).toContain('"path":"agents.json"');
    expect(buffer).toMatch(/"rev":"[0-9a-f]+"/);
  }, 10_000);
});
