// Smoke test for the Flows panel (PLAN.md §8 item 9 / §11 Phase 5's explicit "Flows playback...
// demonstrated in tests" acceptance criterion). Covers both the static "most recent run's step
// statuses" display (part 3) and the playback transport bar (part 4: scrub slider, play/pause,
// run picker). Read-only panel — playback is pure client-side timing state, nothing is written
// to disk, so no on-disk fixture restore is needed.
import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEPLOY_PIPELINE_PATH = path.join(REPO_ROOT, 'workspace', 'flows', 'deploy-pipeline.json');

interface FlowRunEventFixture {
  stepId: string;
  status: string;
  at: string;
}

interface FlowFixture {
  runs?: Array<{ startedAt: string; events: FlowRunEventFixture[] }>;
}

/** Mirrors web/src/panels/flows/effectiveStatus.ts's effectiveStepStatusAt, so the test computes
 *  its expected value from the same fixture data instead of hardcoding a guessed status. */
function effectiveStatusAt(events: FlowRunEventFixture[], stepId: string, atMs: number): string {
  const stepEvents = events.filter((e) => e.stepId === stepId);
  if (stepEvents.length === 0)
    throw new Error(`no run events at all for step ${stepId} — fixture assumption broke`);
  let latestStatus: string | undefined;
  let latestMs = -Infinity;
  for (const event of stepEvents) {
    const ms = Date.parse(event.at);
    if (ms > atMs) continue;
    if (!latestStatus || ms >= latestMs) {
      latestStatus = event.status;
      latestMs = ms;
    }
  }
  return latestStatus ?? 'pending';
}

// Matches FlowPlaybackBar.tsx's SCRUB_STEP_MS — if that constant ever changes, this press-count
// math needs updating too.
const SCRUB_STEP_MS = 10_000;

test('flows panel lays out a DAG per flow, switches via the picker, and distinguishes step status in the DOM', async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  const deployPipeline = JSON.parse(await readFile(DEPLOY_PIPELINE_PATH, 'utf8')) as FlowFixture;
  const run = deployPipeline.runs?.[0];
  if (!run) throw new Error('workspace/flows/deploy-pipeline.json has no runs — fixture assumption broke');
  const startMs = Date.parse(run.startedAt);

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
  // attribute and a modifier class, not just visually. This is the default scrub position (the
  // end of the run), matching the pre-playback static behavior.
  const checkoutNode = page.locator('.flow-node', { hasText: 'Checkout' });
  await expect(checkoutNode).toHaveAttribute('data-status', 'done');
  await expect(checkoutNode).toHaveClass(/flow-node--done/);
  const deployNode = page.locator('.flow-node', { hasText: 'Deploy' });
  await expect(deployNode).toHaveAttribute('data-status', 'failed');
  await expect(deployNode).toHaveClass(/flow-node--failed/);
  const buildNode = page.locator('.flow-node', { hasText: 'Build' });
  await expect(buildNode).toHaveAttribute('data-status', 'done');

  // Core interaction 2 — the literal §11 "Flows playback... demonstrated in tests" bar: a run
  // picker (one option, since this flow has one run), a play/pause button, a speed select, and a
  // real scrub slider that re-computes each node's status as of the scrub position (not the
  // run's final outcome).
  const runSelect = page.locator('.flow-playback__run-select');
  await expect(runSelect).toBeVisible();
  await expect(runSelect.locator('option')).toHaveCount(1);

  const scrubInput = page.locator('.flow-playback__scrub-input');
  await expect(scrubInput).toBeVisible();

  // Real keyboard interaction on the real range input: Home jumps to the minimum (the run's
  // startedAt), then 15 ArrowRight presses (15 * 10s step = 150s) lands exactly on
  // startedAt + 150000ms — a scrub position mid-way through the run, not its final state.
  await scrubInput.press('Home');
  await expect(scrubInput).toHaveValue(String(startMs));
  for (let i = 0; i < 15; i++) {
    await scrubInput.press('ArrowRight');
  }
  const targetMs = startMs + 15 * SCRUB_STEP_MS;
  await expect(scrubInput).toHaveValue(String(targetMs));

  // At this scrub position: "test" finished (done), "build" is mid-run (running, its own done
  // event is still in the future), and "deploy" hasn't started yet (pending) — genuinely
  // different from the "done"/"failed" final-state assertions above, proving this is real
  // time-bounded computation, not the static display. Expected values are computed from the same
  // fixture JSON read above, not hardcoded guesses.
  const expectedBuildStatus = effectiveStatusAt(run.events, 'build', targetMs);
  const expectedDeployStatus = effectiveStatusAt(run.events, 'deploy', targetMs);
  expect(expectedBuildStatus).toBe('running');
  expect(expectedDeployStatus).toBe('pending');
  await expect(buildNode).toHaveAttribute('data-status', expectedBuildStatus);
  await expect(buildNode).toHaveClass(new RegExp(`flow-node--${expectedBuildStatus}`));
  await expect(deployNode).toHaveAttribute('data-status', expectedDeployStatus);
  await expect(deployNode).toHaveClass(new RegExp(`flow-node--${expectedDeployStatus}`));

  // Play/pause: a real timer advances the scrub position over real wall-clock time, and pausing
  // really stops it (not just visually). Read via `data-scrub-ms` (the flow-playback container's
  // unquantized value), not the slider's own DOM `.value` — the browser's range-input value
  // sanitization algorithm snaps that to the nearest `step` (10s) even for programmatic sets, so
  // it can under-report real sub-step advancement over a short wait.
  const playbackBar = page.locator('.flow-playback');
  async function readScrubMs(): Promise<number> {
    const raw = await playbackBar.getAttribute('data-scrub-ms');
    if (raw === null) throw new Error('flow-playback is missing data-scrub-ms');
    return Number(raw);
  }

  await page.locator('.flow-playback__speed-select').selectOption('4');
  const playButton = page.locator('.flow-playback__play-button');
  await expect(playButton).toHaveText('Play');
  await playButton.click();
  await expect(playButton).toHaveText('Pause');
  await page.waitForTimeout(750);
  const scrubDuringPlay = await readScrubMs();
  expect(scrubDuringPlay).toBeGreaterThan(targetMs);

  await playButton.click(); // pause
  await expect(playButton).toHaveText('Play');
  const scrubAfterPause = await readScrubMs();
  await page.waitForTimeout(300);
  const scrubStillAfterPause = await readScrubMs();
  expect(scrubStillAfterPause).toBe(scrubAfterPause); // genuinely stopped advancing, not just visually paused

  // Core interaction 3: switching the picker changes the rendered nodes to the second flow's
  // real steps (different labels, different statuses — including a "running" step in progress),
  // and resets the transport bar back to that flow's own run (final-state default).
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

  // The most-recent-run note is shown (research-to-report's single in-progress run), and the
  // transport bar's own scrub slider reset to that run's end (the new flow's default).
  await expect(page.getByText(/Showing statuses from the most recent run/)).toBeVisible();
  const newScrubInput = page.locator('.flow-playback__scrub-input');
  const newScrubMax = await newScrubInput.getAttribute('max');
  expect(newScrubMax).toBeTruthy();
  await expect(newScrubInput).toHaveValue(newScrubMax ?? '');

  expect(consoleErrors).toEqual([]);
});
