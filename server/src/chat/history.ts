// Chat history persistence (PLAN.md §6 "Assistant panel": "Chat history:
// keep in memory + persist last 20 conversations to ~/.agent-dashboard/chats/
// (NOT the workspace)"). Mirrors credentials.ts/settings.ts's
// resolveAppDataDir() convention — this data is app state, not a workspace
// document, so it never goes through workspace.ts and is never sent back to
// a model as context. One JSON file per conversation; on every save, prune
// down to the 20 most-recently-updated conversations.
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveAppDataDir } from '../providers/credentials.ts';

export const MAX_HISTORY = 20;

export interface ChatHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatHistoryEntry {
  id: string;
  createdAt: string;
  updatedAt: string;
  providerId: string;
  model: string;
  messages: ChatHistoryMessage[];
}

function isValidId(id: string): boolean {
  // Conversation ids are client-generated (crypto.randomUUID()); guard
  // against anything that isn't a safe filename component before it's used
  // to build a path under the chats directory.
  return /^[a-zA-Z0-9_-]+$/.test(id);
}

export class ChatHistoryStore {
  private readonly dir: string;

  constructor(appDataDir: string = resolveAppDataDir()) {
    this.dir = path.join(appDataDir, 'chats');
  }

  private fileFor(id: string): string {
    return path.join(this.dir, `${id}.json`);
  }

  /** Upsert a conversation's full transcript, then prune to the 20 most-recently-updated. */
  async save(entry: ChatHistoryEntry): Promise<void> {
    if (!isValidId(entry.id)) throw new Error(`invalid conversation id: ${entry.id}`);
    await mkdir(this.dir, { recursive: true });
    const targetPath = this.fileFor(entry.id);
    const tmpPath = path.join(this.dir, `.${entry.id}.${process.pid}.${process.hrtime.bigint()}.tmp`);
    await writeFile(tmpPath, JSON.stringify(entry, null, 2) + '\n', 'utf8');
    await rename(tmpPath, targetPath);
    await this.prune();
  }

  async get(id: string): Promise<ChatHistoryEntry | null> {
    if (!isValidId(id)) return null;
    const filePath = this.fileFor(id);
    if (!existsSync(filePath)) return null;
    try {
      return JSON.parse(await readFile(filePath, 'utf8')) as ChatHistoryEntry;
    } catch {
      return null;
    }
  }

  /** All conversations, most-recently-updated first. */
  async list(): Promise<ChatHistoryEntry[]> {
    if (!existsSync(this.dir)) return [];
    const files = (await readdir(this.dir)).filter((f) => f.endsWith('.json'));
    const entries: ChatHistoryEntry[] = [];
    for (const file of files) {
      try {
        entries.push(JSON.parse(await readFile(path.join(this.dir, file), 'utf8')) as ChatHistoryEntry);
      } catch {
        // skip unreadable/corrupt entries rather than failing the whole list
      }
    }
    entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return entries;
  }

  private async prune(): Promise<void> {
    if (!existsSync(this.dir)) return;
    const files = (await readdir(this.dir)).filter((f) => f.endsWith('.json'));
    if (files.length <= MAX_HISTORY) return;
    const withMtime = await Promise.all(
      files.map(async (file) => {
        const full = path.join(this.dir, file);
        const stats = await stat(full);
        return { full, mtimeMs: stats.mtimeMs };
      }),
    );
    withMtime.sort((a, b) => a.mtimeMs - b.mtimeMs); // oldest first
    const excess = withMtime.length - MAX_HISTORY;
    for (const { full } of withMtime.slice(0, excess)) {
      await rm(full, { force: true });
    }
  }
}
