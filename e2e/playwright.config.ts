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
  // Keep generated artifacts under e2e/ (gitignored there), not the repo
  // root, regardless of the cwd `playwright test` is invoked from.
  outputDir: path.join(REPO_ROOT, 'e2e', 'test-results'),
  fullyParallel: true,
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
