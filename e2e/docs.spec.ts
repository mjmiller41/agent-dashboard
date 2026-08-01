// Smoke test for the Docs panel (PLAN.md §8 item 5 / §11 Phase 5): file
// tree, markdown rendering, edit mode, and create/rename/delete. Mutates
// workspace/docs/getting-started.md (restored in a finally block, same
// convention as agents.spec.ts/icons.spec.ts) and a throwaway e2e-temp/
// file that's deleted by the test itself, never left behind.
import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GETTING_STARTED_PATH = path.join(REPO_ROOT, 'workspace', 'docs', 'getting-started.md');

test('docs panel renders the tree, views/edits markdown, and creates/renames/deletes files', async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));
  page.on('dialog', (dialog) => void dialog.accept());

  const originalGettingStarted = await readFile(GETTING_STARTED_PATH, 'utf8');

  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Docs' }).click();

    // workspace.example/docs' 6 nested docs (PLAN.md §4) — folders + root files.
    await expect(page.getByRole('button', { name: /architecture/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /onboarding/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /runbooks/ })).toBeVisible();
    await expect(page.locator('[data-doc-path="docs/README.md"]')).toBeVisible();
    await expect(page.locator('[data-doc-path="docs/getting-started.md"]')).toBeVisible();

    // Core interaction 1: view a nested file, rendered as markdown.
    await page.locator('[data-doc-path="docs/architecture/overview.md"]').click();
    await expect(page.getByRole('heading', { name: 'Architecture overview' })).toBeVisible();
    await expect(page.getByText(/file-first — all state lives under/)).toBeVisible();

    // Core interaction 2: edit + save a file, verify the render updates, then restore on disk.
    await page.locator('[data-doc-path="docs/getting-started.md"]').click();
    await expect(page.getByRole('heading', { name: 'Getting started' })).toBeVisible();
    await page.getByRole('button', { name: 'Edit' }).click();
    const textarea = page.locator('.doc-viewer__textarea');
    await expect(textarea).toBeVisible();
    await textarea.fill('# Getting started\n\ne2e edit marker.\n');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('e2e edit marker.')).toBeVisible();
    await expect.poll(async () => readFile(GETTING_STARTED_PATH, 'utf8')).toContain('e2e edit marker.');

    // Core interaction 3: create a new file. Creation writes the file to disk immediately (before
    // selecting it), so it opens straight into rendered view mode with its placeholder heading.
    await page.getByRole('button', { name: '+ New' }).click();
    await page.getByPlaceholder('path/to/file.md').fill('e2e-temp/created.md');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'created', exact: true })).toBeVisible();
    await expect(page.locator('[data-doc-path="docs/e2e-temp/created.md"]')).toBeVisible();

    await page.getByRole('button', { name: 'Edit' }).click();
    const createTextarea = page.locator('.doc-viewer__textarea');
    await createTextarea.fill('# Created by e2e\n');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('heading', { name: 'Created by e2e' })).toBeVisible();

    // Core interaction 4: rename it.
    await page.getByRole('button', { name: 'Rename' }).click();
    await page.locator('.doc-viewer__rename-form input').fill('e2e-temp/renamed.md');
    await page.getByRole('button', { name: 'Confirm rename' }).click();
    await expect(page.getByRole('heading', { name: 'Created by e2e' })).toBeVisible();
    await expect(page.locator('[data-doc-path="docs/e2e-temp/renamed.md"]')).toBeVisible();
    await expect(page.locator('[data-doc-path="docs/e2e-temp/created.md"]')).toHaveCount(0);

    // Core interaction 5: delete it (window.confirm auto-accepted above).
    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(page.locator('[data-doc-path="docs/e2e-temp/renamed.md"]')).toHaveCount(0);
  } finally {
    await writeFile(GETTING_STARTED_PATH, originalGettingStarted, 'utf8');
  }

  expect(consoleErrors).toEqual([]);
});
