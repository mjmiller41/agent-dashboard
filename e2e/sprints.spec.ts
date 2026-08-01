// Smoke test for the Sprints panel (PLAN.md §8 item 6 / §11 Phase 5's
// explicit acceptance criterion: "Sprints drag-drop... demonstrated in
// tests"). Performs a *real* drag via Playwright's mouse APIs (mouse down
// on a card, move in steps, mouse up over a card in a different column) —
// not a programmatic status-field edit standing in for a drag — and asserts
// the resulting status/order change lands correctly in sprints.json on disk.
import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPRINTS_PATH = path.join(REPO_ROOT, 'workspace', 'sprints.json');

interface SprintTaskFixture {
  id: string;
  status: string;
  order: number;
  assigneeId?: string;
}

interface SprintsFixture {
  current: { name: string; startsOn: string; endsOn: string };
  tasks: SprintTaskFixture[];
}

async function readSprints(): Promise<SprintsFixture> {
  return JSON.parse(await readFile(SPRINTS_PATH, 'utf8')) as SprintsFixture;
}

async function dragCard(page: import('@playwright/test').Page, fromTaskId: string, toTaskId: string) {
  const source = page.locator(`[data-task-id="${fromTaskId}"]`);
  const target = page.locator(`[data-task-id="${toTaskId}"]`);
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox) throw new Error('missing bounding box for drag source/target');

  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  // A few intermediate moves so dnd-kit's PointerSensor activation-distance constraint fires and
  // registers a real drag (not a click).
  await page.mouse.move(sourceBox.x + sourceBox.width / 2 + 30, sourceBox.y + sourceBox.height / 2 + 30, {
    steps: 5,
  });
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 15 });
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 2 });
  await page.mouse.up();
}

test('sprints panel renders the kanban board, drags a card across columns, and assigns via the popover', async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  const original = await readFile(SPRINTS_PATH, 'utf8');

  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Sprints' }).click();

    // workspace.example/sprints.json's 14-task sprint (PLAN.md §4): 4 done, 2 doing, 3 todo, 5 backlog.
    await expect(page.getByRole('heading', { name: 'Sprint 1 — File-first foundation' })).toBeVisible();
    await expect(page.getByText('4/14 done (29%)')).toBeVisible();
    await expect(page.locator('[data-column="backlog"] [data-task-id]')).toHaveCount(5);
    await expect(page.locator('[data-column="todo"] [data-task-id]')).toHaveCount(3);
    await expect(page.locator('[data-column="doing"] [data-task-id]')).toHaveCount(2);
    await expect(page.locator('[data-column="done"] [data-task-id]')).toHaveCount(4);

    // Core interaction 1 (the §11 acceptance criterion): drag t05 ("workspace.ts safe read/write",
    // todo, order 0) onto t03 ("Write shared zod schemas", doing, order 0) — a real mouse
    // down/move/up sequence, dropped in the "doing" column, inserted before t03.
    await dragCard(page, 't05', 't03');

    await expect
      .poll(async () => {
        const fixture = await readSprints();
        return fixture.tasks.find((t) => t.id === 't05')?.status;
      })
      .toBe('doing');

    // Verify the whole reindex is consistent, not just t05's status flip (only the
    // status/order/assigneeId fields — title/notes are untouched passengers, asserted
    // separately isn't necessary since the mutator never rewrites them).
    function pick(fixture: SprintsFixture, id: string) {
      const task = fixture.tasks.find((t) => t.id === id);
      return task && { status: task.status, order: task.order, assigneeId: task.assigneeId };
    }
    await expect
      .poll(async () => {
        const fixture = await readSprints();
        return {
          t05: pick(fixture, 't05'),
          t03: pick(fixture, 't03'),
          t04: pick(fixture, 't04'),
          t06: pick(fixture, 't06'),
          t09: pick(fixture, 't09'),
        };
      })
      .toEqual({
        t05: { status: 'doing', order: 0, assigneeId: 'coder' },
        t03: { status: 'doing', order: 1, assigneeId: 'coder' },
        t04: { status: 'doing', order: 2, assigneeId: 'coder' },
        t06: { status: 'todo', order: 0, assigneeId: 'coder' },
        t09: { status: 'todo', order: 1, assigneeId: 'reviewer' },
      });

    // The DOM should also reflect the move: doing now has 3 cards, todo has 2.
    await expect(page.locator('[data-column="doing"] [data-task-id]')).toHaveCount(3);
    await expect(page.locator('[data-column="todo"] [data-task-id]')).toHaveCount(2);

    // Core interaction 2: assignee popover — t12 ("Pick theme presets palette", backlog) starts
    // unassigned; assign it to Coder.
    const t12Card = page.locator('[data-task-id="t12"]');
    await t12Card.getByRole('button', { name: 'Unassigned' }).click();
    const popover = t12Card.locator('.assignee-popover');
    await expect(popover.getByText('Assign to')).toBeVisible();
    await popover.getByRole('button', { name: 'Coder', exact: true }).click();
    await expect(t12Card.getByRole('button', { name: 'Coder', exact: true })).toBeVisible();

    await expect
      .poll(async () => {
        const fixture = await readSprints();
        return fixture.tasks.find((t) => t.id === 't12')?.assigneeId;
      })
      .toBe('coder');
  } finally {
    await writeFile(SPRINTS_PATH, original, 'utf8');
  }

  expect(consoleErrors).toEqual([]);
});
