import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChatHistoryStore, MAX_HISTORY } from './history.ts';

let appDataDir: string;
let store: ChatHistoryStore;

beforeEach(async () => {
  appDataDir = await mkdtemp(path.join(tmpdir(), 'agent-dashboard-chats-'));
  store = new ChatHistoryStore(appDataDir);
});

afterEach(async () => {
  await rm(appDataDir, { recursive: true, force: true });
});

function entry(id: string, updatedAt: string) {
  return {
    id,
    createdAt: updatedAt,
    updatedAt,
    providerId: 'ollama',
    model: 'qwen3:4b',
    messages: [{ role: 'user' as const, content: `hello from ${id}` }],
  };
}

describe('ChatHistoryStore', () => {
  it('persists under <appDataDir>/chats, not the workspace', async () => {
    await store.save(entry('c1', '2026-01-01T00:00:00.000Z'));
    const files = await readdir(path.join(appDataDir, 'chats'));
    expect(files).toContain('c1.json');
  });

  it('round-trips a saved conversation via get()', async () => {
    await store.save(entry('c1', '2026-01-01T00:00:00.000Z'));
    const loaded = await store.get('c1');
    expect(loaded?.messages).toEqual([{ role: 'user', content: 'hello from c1' }]);
  });

  it('list() returns most-recently-updated first', async () => {
    await store.save(entry('older', '2026-01-01T00:00:00.000Z'));
    await store.save(entry('newer', '2026-01-02T00:00:00.000Z'));
    const list = await store.list();
    expect(list.map((e) => e.id)).toEqual(['newer', 'older']);
  });

  it('caps at MAX_HISTORY conversations, pruning the oldest by mtime', async () => {
    for (let i = 0; i < MAX_HISTORY + 5; i++) {
      await store.save(entry(`c${i}`, new Date(2026, 0, 1, 0, 0, i).toISOString()));
    }
    const files = await readdir(path.join(appDataDir, 'chats'));
    expect(files).toHaveLength(MAX_HISTORY);
    // the earliest-saved conversations should be the ones pruned
    expect(files).not.toContain('c0.json');
    expect(files).toContain(`c${MAX_HISTORY + 4}.json`);
  });

  it('rejects a conversation id that is not a safe filename component', async () => {
    await expect(store.save(entry('../escape', '2026-01-01T00:00:00.000Z'))).rejects.toThrow(
      /invalid conversation id/,
    );
  });

  it('get() returns null for an unknown id', async () => {
    expect(await store.get('does-not-exist')).toBeNull();
  });
});
