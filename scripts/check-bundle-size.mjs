#!/usr/bin/env node
// Enforces PLAN.md §2's "production JS ≤ 350 KB gzipped total" budget.
// Sums the gzipped size of every built JS chunk under web/dist (the app
// shell + every lazy panel chunk), excluding the service-worker artifacts
// vite-plugin-pwa generates (sw.js / workbox-*.js / registerSW.js) — those
// load in the SW thread, not as part of a page's initial JS need, and
// aren't part of the "production JS" PLAN.md §2 is budgeting. Run after
// `npm run build -w web`; kept as a permanent repo tool (not a one-off), so
// future phases/panels can re-check the budget without re-deriving this
// logic. See DECISIONS.md "Phase 6" for the numbers recorded at ship time.
import { gzipSync } from 'node:zlib';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST_DIR = path.join(REPO_ROOT, 'web', 'dist');
const BUDGET_BYTES = 350 * 1024;

const SW_ARTIFACT_NAMES = new Set(['registerSW.js']);
function isServiceWorkerArtifact(relPath) {
  const base = path.basename(relPath);
  return SW_ARTIFACT_NAMES.has(base) || base === 'sw.js' || /^workbox-[0-9a-f]+\.js$/.test(base);
}

function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, out);
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(abs);
  }
}

let files;
try {
  statSync(DIST_DIR);
} catch {
  console.error(`web/dist not found — run \`npm run build -w web\` first (looked in ${DIST_DIR})`);
  process.exit(1);
}
files = [];
walk(DIST_DIR, files);

let appTotal = 0;
let swTotal = 0;
const rows = [];
for (const abs of files) {
  const rel = path.relative(DIST_DIR, abs);
  const gz = gzipSync(readFileSync(abs)).length;
  if (isServiceWorkerArtifact(rel)) {
    swTotal += gz;
  } else {
    appTotal += gz;
  }
  rows.push({ rel, gz });
}

rows.sort((a, b) => b.gz - a.gz);
console.log('Gzipped JS chunk sizes (web/dist):');
for (const { rel, gz } of rows) {
  console.log(`  ${(gz / 1024).toFixed(2).padStart(8)} KB  ${rel}`);
}

console.log('');
console.log(`App JS total (excl. service-worker artifacts): ${(appTotal / 1024).toFixed(2)} KB`);
console.log(`Service-worker artifacts (sw.js + workbox runtime): ${(swTotal / 1024).toFixed(2)} KB`);
console.log(`Budget: ${(BUDGET_BYTES / 1024).toFixed(0)} KB`);

if (appTotal > BUDGET_BYTES) {
  console.error(
    `FAIL: app JS total ${(appTotal / 1024).toFixed(2)} KB exceeds the ${(BUDGET_BYTES / 1024).toFixed(0)} KB budget.`,
  );
  process.exit(1);
}

console.log(
  `PASS: app JS total is ${(BUDGET_BYTES - appTotal) / 1024 > 0 ? ((BUDGET_BYTES - appTotal) / 1024).toFixed(2) : '0'} KB under budget.`,
);
