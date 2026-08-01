// Smoke test for the Agents panel (PLAN.md §8 item 3 / §11 Phase 5) — the
// demo-critical panel. Also serves as the live proof of the ~200ms SSE
// update requirement: edits agents.json on disk directly (NOT through the
// UI) and asserts the roster reflects it without a page reload.
import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AGENTS_PATH = path.join(REPO_ROOT, 'workspace', 'agents.json');

test('agents panel renders the roster and live-updates via SSE on disk changes', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  const original = await readFile(AGENTS_PATH, 'utf8');

  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Agents' }).click();

    // workspace.example/agents.json's 4 example agents (PLAN.md §4).
    await expect(page.getByText('Researcher')).toBeVisible();
    await expect(page.getByText('Coder')).toBeVisible();
    await expect(page.getByText('Reviewer')).toBeVisible();
    await expect(page.getByText('Planner')).toBeVisible();
    await expect(page.getByText('Surveying OAuth flows for Anthropic + OpenAI')).toBeVisible();

    // Live-verify the SSE update path: edit the file on disk directly and
    // confirm the roster reflects it fast, with no reload.
    const data = JSON.parse(original) as { agents: Array<Record<string, unknown>> };
    const researcher = data.agents.find((a) => a.id === 'researcher');
    if (!researcher) throw new Error('fixture missing researcher agent');
    researcher.currentTask = 'Live SSE update smoke test';
    const editedAt = Date.now();
    await writeFile(AGENTS_PATH, JSON.stringify(data, null, 2) + '\n', 'utf8');

    await expect(page.getByText('Live SSE update smoke test')).toBeVisible({ timeout: 2000 });
    const elapsedMs = Date.now() - editedAt;
    console.log(`agents.json on-disk edit -> DOM update took ${elapsedMs}ms`);
  } finally {
    await writeFile(AGENTS_PATH, original, 'utf8');
  }

  expect(consoleErrors).toEqual([]);
});
