// Smoke test for the Links panel (PLAN.md §8 item 1 / §11 Phase 5).
import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LINKS_PATH = path.join(REPO_ROOT, 'workspace', 'links.json');

test('links panel renders example groups and supports inline add/delete', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  const originalLinks = await readFile(LINKS_PATH, 'utf8');

  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Links' }).click();

    // workspace.example/links.json's 3 example groups (PLAN.md §4).
    await expect(page.getByRole('heading', { name: 'Docs & references' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Hono' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Provider consoles' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Team' })).toBeVisible();

    // Core interaction: add a link inline, confirm it renders, then delete it.
    const docsGroup = page.locator('.link-group', { hasText: 'Docs & references' });
    await docsGroup.getByRole('button', { name: '+ Add link' }).click();
    await docsGroup.getByPlaceholder('Title').fill('Playwright');
    await docsGroup.getByPlaceholder('https://…').fill('https://playwright.dev');
    await docsGroup.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(docsGroup.getByRole('link', { name: 'Playwright' })).toBeVisible();

    const newCard = docsGroup.locator('.link-card', { hasText: 'Playwright' });
    await newCard.getByRole('button', { name: 'Delete' }).click();
    await expect(docsGroup.getByRole('link', { name: 'Playwright' })).toHaveCount(0);
  } finally {
    await writeFile(LINKS_PATH, originalLinks, 'utf8');
  }

  expect(consoleErrors).toEqual([]);
});
