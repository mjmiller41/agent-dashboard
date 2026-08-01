// Smoke test for the Icons panel (PLAN.md §8 item 2 / §11 Phase 5).
import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AGENTS_PATH = path.join(REPO_ROOT, 'workspace', 'agents.json');

test('icons panel renders the example gallery and assigns an icon to an agent', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  const originalAgents = await readFile(AGENTS_PATH, 'utf8');

  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Icons' }).click();

    // workspace.example/icons/ ships 28 SVGs (Phase 1's generated set).
    const tiles = page.locator('.icon-tile');
    await expect(tiles.first()).toBeVisible();
    await expect(tiles).toHaveCount(28);

    // Core interaction: click icon-03.svg, assign it to "Coder" (whose
    // default iconId is icon-02.svg per workspace.example/agents.json, so
    // this is a real, verifiable change).
    await tiles.nth(2).click();
    await expect(page.getByText('Assign to agent')).toBeVisible();
    await page.getByRole('button', { name: 'Coder', exact: true }).click();
    await expect(page.getByText('Assign to agent')).toHaveCount(0);

    await expect
      .poll(async () => {
        const updated = JSON.parse(await readFile(AGENTS_PATH, 'utf8')) as {
          agents: Array<{ id: string; iconId: string }>;
        };
        return updated.agents.find((a) => a.id === 'coder')?.iconId;
      })
      .toBe('icon-03.svg');
  } finally {
    await writeFile(AGENTS_PATH, originalAgents, 'utf8');
  }

  expect(consoleErrors).toEqual([]);
});
