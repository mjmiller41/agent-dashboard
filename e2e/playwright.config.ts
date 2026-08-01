// Playwright config (PLAN.md §2 "E2E: Playwright (chromium only)", §11
// Phase 5). Chromium only, local dev-server webServer (boots server + vite
// the same way scripts/dev.mjs does), retries off for local runs.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5173;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: '.',
  // pwa.spec.ts needs a real production build (vite-plugin-pwa's
  // manifest/service worker don't exist in Vite dev mode) and runs only via
  // its own e2e/playwright.prod.config.ts (`npm run e2e:prod`) — excluded
  // here so this dev-mode config's `npm run e2e` doesn't also pick it up
  // and fail against a server with no manifest link at all.
  testIgnore: /pwa\.spec\.ts$/,
  // Keep generated artifacts under e2e/ (gitignored there), not the repo
  // root, regardless of the cwd `playwright test` is invoked from.
  outputDir: path.join(REPO_ROOT, 'e2e', 'test-results'),
  // Specs share one on-disk `workspace/` dir served by a single dev-server
  // instance (not per-worker isolated), and more than one spec directly
  // reads/writes the same workspace files (e.g. icons.spec.ts and
  // agents.spec.ts both mutate agents.json). Running fully parallel across
  // workers races those writes. Serialize to one worker instead of
  // building per-test workspace isolation, since this suite is a handful of
  // smoke tests, not a large parallel suite where that cost would matter.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // scripts/dev.mjs boots both the Hono server (127.0.0.1:4680) and the
    // Vite dev server (proxying /api → 4680) together — same command a
    // human would run for local dev.
    command: 'npm run dev',
    cwd: REPO_ROOT,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
