#!/usr/bin/env node
/**
 * Production entrypoint for `npm start`.
 *
 * Exists purely to fail *legibly*. Running `npm start` against an unbuilt (or
 * half-built) tree previously died with a raw MODULE_NOT_FOUND stack trace
 * pointing at server/dist/index.js, which says nothing about the actual
 * problem or the fix. It also checked nothing about web/dist, so a missing
 * front-end build failed later and even more confusingly: the server would
 * boot happily and then serve 404s for every page.
 */
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const required = [
  { path: resolve(repoRoot, 'server/dist/index.js'), label: 'server build (server/dist)' },
  { path: resolve(repoRoot, 'web/dist/index.html'), label: 'web build (web/dist)' },
];

const missing = required.filter((entry) => !existsSync(entry.path));
if (missing.length > 0) {
  console.error('\nCannot start: the production build is incomplete.\n');
  for (const entry of missing) console.error(`  missing  ${entry.label}`);
  console.error('\nRun `npm run build` first, then `npm start`.\n');
  process.exit(1);
}

const child = spawn(process.execPath, [resolve(repoRoot, 'server/dist/index.js')], {
  stdio: 'inherit',
});
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
