// Smoke test for the Skill Trees panel (PLAN.md §8 item 8 / §11 Phase 5).
// Read-only panel (no write path yet), so no on-disk fixture restore is
// needed — same as generations.spec.ts's precedent. Waits for the d3-force
// simulation to settle (nodes stop moving) before clicking, since Chromium
// won't register a click on an SVG element that's still animating under it.
import { expect, test, type Page } from '@playwright/test';

async function waitForGraphSettled(page: Page): Promise<void> {
  const firstNode = page.locator('.skill-node').first();
  let previous: string | null = null;
  for (let i = 0; i < 20; i++) {
    const current = await firstNode.getAttribute('transform');
    if (current !== null && current === previous) return;
    previous = current;
    await page.waitForTimeout(300);
  }
}

test('skill trees panel renders the force graph and shows real detail on click', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  await page.goto('/');
  await page.getByRole('button', { name: 'Skill Trees' }).click();

  // workspace.example/skills.json's 12 nodes (3 categories + 9 skills, PLAN.md §4/DECISIONS.md).
  await expect(page.locator('.skill-node')).toHaveCount(12);
  await expect(page.locator('.skill-graph__edge')).toHaveCount(10);

  await waitForGraphSettled(page);

  // Core interaction: click a leaf skill node, confirm the drawer shows its *real*
  // description/source text from skills.json (not a placeholder), then close it.
  const tddNode = page.locator('.skill-node[data-skill-id="skill-tdd"]');
  await tddNode.locator('circle').click();

  const drawer = page.locator('.skill-detail-drawer');
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('heading', { name: 'tdd' })).toBeVisible();
  await expect(drawer.getByText('Test-driven development workflow')).toBeVisible();
  await expect(drawer.getByText('cat-coding')).toBeVisible();
  await expect(drawer.getByText('scan')).toBeVisible();

  await drawer.locator('.skill-detail-drawer__header button').click();
  await expect(drawer).toHaveCount(0);

  // A second node with a different description proves it's not just always showing the first
  // node's data.
  const writingNode = page.locator('.skill-node[data-skill-id="skill-watch-n-report"]');
  await writingNode.locator('circle').click();
  await expect(
    page.locator('.skill-detail-drawer').getByText('Watch a video and write an exhaustive report'),
  ).toBeVisible();
  // This one is manually authored, not scanned (PLAN.md §8 item 8: "merge, don't clobber, any
  // hand-added nodes (source: 'manual')").
  await expect(page.locator('.skill-detail-drawer').getByText('manual', { exact: true })).toBeVisible();

  // Closing via the backdrop also works.
  await page.locator('.modal-backdrop').click({ position: { x: 10, y: 10 } });
  await expect(page.locator('.skill-detail-drawer')).toHaveCount(0);

  expect(consoleErrors).toEqual([]);
});
