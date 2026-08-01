// ~/.agent-dashboard/settings.json — small, non-secret app settings that
// don't belong in the workspace (PLAN.md §6a: persist first-party OAuth
// consent-modal acceptance "in ~/.agent-dashboard/settings.json"). Same
// directory convention as credentials.json, but plaintext (nothing secret
// here) and atomically written like every other file this app owns.
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_APP_DATA_DIR } from './credentials.ts';

export interface AppSettings {
  /** ISO timestamp of when the user accepted the first-party-OAuth consent modal, if ever. */
  firstPartyConsentAcceptedAt?: string;
}

const DEFAULTS: AppSettings = {};

export class SettingsStore {
  private readonly path: string;
  private writeChain: Promise<unknown> = Promise.resolve();

  constructor(dir: string = DEFAULT_APP_DATA_DIR) {
    this.path = path.join(dir, 'settings.json');
  }

  async read(): Promise<AppSettings> {
    if (!existsSync(this.path)) return { ...DEFAULTS };
    try {
      const raw = await readFile(this.path, 'utf8');
      return { ...DEFAULTS, ...(JSON.parse(raw) as AppSettings) };
    } catch {
      return { ...DEFAULTS };
    }
  }

  async update(patch: Partial<AppSettings>): Promise<AppSettings> {
    return this.enqueue(async () => {
      const current = await this.read();
      const next = { ...current, ...patch };
      const dir = path.dirname(this.path);
      await mkdir(dir, { recursive: true });
      const tmpPath = path.join(dir, `.settings.${process.pid}.${process.hrtime.bigint()}.tmp`);
      await writeFile(tmpPath, JSON.stringify(next, null, 2) + '\n', 'utf8');
      await rename(tmpPath, this.path);
      return next;
    });
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.writeChain.then(fn, fn);
    this.writeChain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
