// Smoke test for the Flows panel (PLAN.md §8 item 9 / §11 Phase 5's
// explicit "Flows playback... demonstrated in tests" acceptance criterion —
// this run scoped that down to "show the most recent run's step statuses",
// not a full play/pause/scrub transport bar; see DECISIONS.md). Read-only
// panel (no execution, no write path), so no on-disk fixture restore needed.
import { expect, test } from '@playwright/test';

test('flows panel lays out a DAG per flow, switches via the picker, and distinguishes step status in the DOM', async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  await page.goto('/');
  await page.getByRole('button', { name: 'Flows', exact: true }).click();

  // workspace.example/flows/ ships 2 flows (PLAN.md §4); deploy-pipeline loads first (picker is
  // sorted alphabetically, and it's selected by default).
  await expect(page.locator('.flows-panel__picker button')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'deploy-pipeline' })).toHaveClass(/filter-pill--active/);

  await expect(page.locator('.flow-node')).toHaveCount(5);
  await expect(page.locator('.flow-node__label', { hasText: 'Checkout' })).toBeVisible();
  await expect(page.locator('.flow-node__label', { hasText: 'Deploy' })).toBeVisible();

  // Core interaction 1: done/failed status is distinguishable in the DOM via both a data
  // attribute and a modifier class, not just visually.
  const checkoutNode = page.locator('.flow-node', { hasText: 'Checkout' });
  await expect(checkoutNode).toHaveAttribute('data-status', 'done');
  await expect(checkoutNode).toHaveClass(/flow-node--done/);
  const deployNode = page.locator('.flow-node', { hasText: 'Deploy' });
  await expect(deployNode).toHaveAttribute('data-status', 'failed');
  await expect(deployNode).toHaveClass(/flow-node--failed/);

  // Core interaction 2: switching the picker changes the rendered nodes to the second flow's
  // real steps (different labels, different statuses — including a "running" step in progress).
  await page.getByRole('button', { name: 'research-to-report' }).click();
  await expect(page.getByRole('button', { name: 'research-to-report' })).toHaveClass(/filter-pill--active/);

  await expect(page.locator('.flow-node')).toHaveCount(5);
  await expect(page.locator('.flow-node__label', { hasText: 'Scope topic' })).toBeVisible();
  await expect(page.locator('.flow-node__label', { hasText: 'Adversarial verify' })).toBeVisible();
  await expect(page.locator('.flow-node__label', { hasText: 'Checkout' })).toHaveCount(0);

  const verifyNode = page.locator('.flow-node', { hasText: 'Adversarial verify' });
  await expect(verifyNode).toHaveAttribute('data-status', 'running');
  await expect(verifyNode).toHaveClass(/flow-node--running/);
  const writeNode = page.locator('.flow-node', { hasText: 'Write report' });
  await expect(writeNode).toHaveAttribute('data-status', 'pending');
  await expect(writeNode).toHaveClass(/flow-node--pending/);

  // The most-recent-run note is shown (research-to-report's single in-progress run).
  await expect(page.getByText(/Showing statuses from the most recent run/)).toBeVisible();

  expect(consoleErrors).toEqual([]);
});
