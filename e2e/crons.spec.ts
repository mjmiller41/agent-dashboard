// Smoke test for the Crons panel (PLAN.md §8 item 7 / §11 Phase 5's
// explicit "Crons calendar... demonstrated in tests" acceptance criterion).
// Covers the list view (human-readable schedule, next occurrences, enabled
// toggle round-tripping to disk), the invalid-schedule warning badge, and
// the month calendar's hover popover.
import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CRONS_PATH = path.join(REPO_ROOT, 'workspace', 'crons.json');

interface CronJobFixture {
  id: string;
  name: string;
  schedule: string;
  enabled: boolean;
  [key: string]: unknown;
}

interface CronsFixture {
  jobs: CronJobFixture[];
}

async function readCrons(): Promise<CronsFixture> {
  return JSON.parse(await readFile(CRONS_PATH, 'utf8')) as CronsFixture;
}

test('crons panel renders the list + calendar, toggles enabled state, and flags invalid schedules', async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  const original = await readFile(CRONS_PATH, 'utf8');

  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Crons' }).click();

    // workspace.example/crons.json's 5 example jobs (PLAN.md §4).
    await expect(page.locator('.cron-row')).toHaveCount(5);
    await expect(page.getByText('Nightly skill scan')).toBeVisible();
    await expect(page.getByText('Heartbeat check')).toBeVisible();
    // Human-readable describe fn output for a concrete schedule.
    await expect(page.getByText('Every 5 minutes')).toBeVisible();
    await expect(page.getByText('Every Monday at 09:00')).toBeVisible();
    // Disabled job shows a "disabled" badge and "never" for lastRun.
    const auditRow = page.locator('.cron-row[data-cron-id="weekly-harness-audit"]');
    await expect(auditRow.getByText('disabled', { exact: true })).toBeVisible();

    // Core interaction 1 (the §11 acceptance criterion, list half): toggle a currently-enabled
    // job off via the checkbox and confirm the write lands in crons.json on disk.
    const digestRow = page.locator('.cron-row[data-cron-id="hourly-digest"]');
    const digestToggle = digestRow.locator('input[type="checkbox"]');
    await expect(digestToggle).toBeChecked();
    await digestToggle.click();
    await expect
      .poll(async () => {
        const fixture = await readCrons();
        return fixture.jobs.find((j) => j.id === 'hourly-digest')?.enabled;
      })
      .toBe(false);
    await expect(digestRow.getByText('disabled')).toBeVisible();

    // Core interaction 2: an invalid schedule (valid 5-field shape, semantically out-of-range
    // minute) gets a warning badge in the list and no next-occurrence times — written directly to
    // disk to also prove the live SSE refetch path picks it up, same as agents.spec.ts's pattern.
    const withInvalid = await readCrons();
    withInvalid.jobs.push({
      id: 'e2e-invalid-schedule',
      name: 'E2E invalid schedule job',
      schedule: '70 3 * * *',
      enabled: true,
    });
    await writeFile(CRONS_PATH, JSON.stringify(withInvalid, null, 2) + '\n', 'utf8');

    const invalidRow = page.locator('.cron-row[data-cron-id="e2e-invalid-schedule"]');
    await expect(invalidRow).toBeVisible({ timeout: 2000 });
    await expect(invalidRow.locator('.cron-row__badge--invalid')).toHaveText('⚠ invalid schedule');
    await expect(invalidRow.getByText('could not be parsed')).toBeVisible();
    await expect(invalidRow.locator('.cron-row__dash')).toHaveText('—');
    // 6 rows now (5 example + the invalid one); the calendar still renders without error.
    await expect(page.locator('.cron-row')).toHaveCount(6);

    // Core interaction 3: calendar hover popover. Every-5-minutes and hourly jobs both fire every
    // day, so any in-month day cell should have dots and a hover popover naming real jobs.
    const dotDay = page.locator('.cron-calendar__day:not(.cron-calendar__day--outside)').filter({
      has: page.locator('.cron-calendar__dot'),
    });
    await expect(dotDay.first()).toBeVisible();
    await dotDay.first().hover();
    const popover = page.locator('.cron-calendar__popover');
    await expect(popover).toBeVisible();
    await expect(popover.getByText('Heartbeat check')).toBeVisible();
  } finally {
    await writeFile(CRONS_PATH, original, 'utf8');
  }

  expect(consoleErrors).toEqual([]);
});
