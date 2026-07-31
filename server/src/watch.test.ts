import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceWatcher, type WorkspaceEvent } from './watch.ts';

let root: string;
let watcher: WorkspaceWatcher;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'agent-dashboard-watch-'));
  watcher = new WorkspaceWatcher(root, { debounceMs: 20 });
});

afterEach(async () => {
  await watcher.close();
  await rm(root, { recursive: true, force: true });
});

function waitForEvent(w: WorkspaceWatcher, timeoutMs = 3000): Promise<WorkspaceEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for watch event')), timeoutMs);
    const unsubscribe = w.subscribe((event) => {
      clearTimeout(timer);
      unsubscribe();
      resolve(event);
    });
  });
}

describe('WorkspaceWatcher', () => {
  it('emits a ws-change event with a rev when a file is created on disk', async () => {
    watcher.start();
    await watcher.ready();
    const pending = waitForEvent(watcher);
    await writeFile(path.join(root, 'agents.json'), '{"agents":[]}');
    const event = await pending;
    expect(event.type).toBe('ws-change');
    if (event.type === 'ws-change') {
      expect(event.path).toBe('agents.json');
      expect(typeof event.rev).toBe('string');
      expect(event.rev.length).toBeGreaterThan(0);
    }
  });

  it('emits a ws-change event when an existing file is modified', async () => {
    await writeFile(path.join(root, 'agents.json'), '{"agents":[]}');
    watcher.start();
    await watcher.ready();
    const pending = waitForEvent(watcher);
    await writeFile(path.join(root, 'agents.json'), '{"agents":[{"id":"a1"}]}');
    const event = await pending;
    expect(event.type).toBe('ws-change');
    if (event.type === 'ws-change') expect(event.path).toBe('agents.json');
  });

  it('debounces rapid successive writes into a single event', async () => {
    watcher.start();
    await watcher.ready();
    const events: WorkspaceEvent[] = [];
    const unsubscribe = watcher.subscribe((event) => events.push(event));

    await writeFile(path.join(root, 'burst.json'), '{"n":1}');
    await writeFile(path.join(root, 'burst.json'), '{"n":2}');
    await writeFile(path.join(root, 'burst.json'), '{"n":3}');

    await new Promise((resolve) => setTimeout(resolve, 500));
    unsubscribe();

    const burstEvents = events.filter((e) => e.type === 'ws-change' && e.path === 'burst.json');
    expect(burstEvents.length).toBe(1);
  });
});
