// Regression guard for the build pipeline itself (#17).
//
// `server/tsconfig.json` sets `composite: true`, which implies `incremental`.
// That means a stale `tsconfig.tsbuildinfo` can convince `tsc` that everything
// is already emitted even when `dist/` has been deleted — it then writes
// nothing and exits 0, so `npm run build` "succeeds" and `npm start` dies with
// MODULE_NOT_FOUND. `tsc --build` does not help (it reports "up to date" with
// dist absent); only `--force` re-emits.
//
// These tests pin the two script definitions that fix it. They're deliberately
// assertions about package.json rather than a full compile: running a real
// build here would add ~seconds to every `npm test` and would itself be
// vulnerable to the same caching quirk it's meant to detect.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(SERVER_DIR, '..');

function scriptsOf(pkgDir: string): Record<string, string> {
  const raw = readFileSync(path.join(pkgDir, 'package.json'), 'utf8');
  return (JSON.parse(raw) as { scripts?: Record<string, string> }).scripts ?? {};
}

describe('build scripts', () => {
  it('forces a full emit so a stale tsbuildinfo cannot suppress output', () => {
    const build = scriptsOf(SERVER_DIR).build;
    expect(build).toBeDefined();
    // Plain `tsc` and bare `tsc --build` both no-op against a stale buildinfo.
    expect(build).toContain('--force');
  });

  it('starts via the guard script, not a bare path into dist', () => {
    const start = scriptsOf(REPO_ROOT).start;
    expect(start).toBeDefined();
    // A bare `node server/dist/index.js` turns "you forgot to build" into an
    // opaque module-resolution stack trace.
    expect(start).toContain('scripts/start.mjs');
    expect(start).not.toMatch(/node\s+server\/dist/);
  });
});
