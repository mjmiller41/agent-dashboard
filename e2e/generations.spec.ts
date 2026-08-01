// Smoke test for the Generations panel (PLAN.md §8 item 4 / §11 Phase 5).
// Read-only interactions (filters + lightbox) — this panel never writes to
// generations.json, so no on-disk fixture restore is needed.
import { expect, test } from '@playwright/test';

test('generations panel renders the gallery, filters by kind, and opens the lightbox', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  await page.goto('/');
  await page.getByRole('button', { name: 'Generations' }).click();

  // workspace.example/generations.json ships 8 items: 5 images, 3 videos (PLAN.md §4).
  const cards = page.locator('.generation-card');
  await expect(cards.first()).toBeVisible();
  await expect(cards).toHaveCount(8);

  // Core interaction 1: filter by kind.
  await page.getByRole('button', { name: 'Videos', exact: true }).click();
  await expect(cards).toHaveCount(3);
  await page.getByRole('button', { name: 'Images', exact: true }).click();
  await expect(cards).toHaveCount(5);
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await expect(cards).toHaveCount(8);

  // Core interaction 2: tag filter (gen-01/gen-04 both tagged differently; "demo" tags
  // gen-03 and gen-06 per workspace.example/generations.json).
  await page.getByRole('button', { name: 'demo', exact: true }).click();
  await expect(cards).toHaveCount(2);
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(cards).toHaveCount(8);

  // Core interaction 3: lightbox open/close via the native <dialog>.
  const firstCard = cards.first();
  await firstCard.click();
  const dialog = page.locator('dialog.lightbox');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('geometric logo, dark background, purple accent')).toBeVisible();
  await page.getByRole('button', { name: '× Close' }).click();
  await expect(dialog).toBeHidden();

  expect(consoleErrors).toEqual([]);
});
