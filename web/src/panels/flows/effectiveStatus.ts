// Derives the status to display for a step (PLAN.md §8 item 9 wiring: "if
// the flow has a runs array, show the most recent run's step statuses", and
// its playback wording: "animate the active node... [as] events [replay]
// by timestamp"). `effectiveStepStatus` keeps the original part-3 "latest
// event overall in the latest run" behavior; `effectiveStepStatusAt` is the
// time-bounded variant playback needs (PLAN.md §8 item 9 / DECISIONS.md
// "Phase 5 — Panels (part 4)") — only events with `at <= atMs` count, so
// scrubbing to an earlier point in a run shows that point's real state
// instead of the run's final outcome. Both share `pickLatestEventAtOrBefore`
// rather than duplicating the "pick the chronologically-last matching
// event" logic twice.
//
// Comparisons use numeric epoch ms (via Date.parse), not raw ISO-string
// comparison: a scrub position derived from `Date.prototype.toISOString()`
// always includes milliseconds ("...T10:02:10.000Z"), while the shipped
// example data's `at` fields don't ("...T10:02:10Z") — comparing those two
// formats as strings can put a scrub position "before" an event that
// represents the exact same instant (since '.' < 'Z' in ASCII), which numeric
// comparison avoids entirely.
import type { FlowRun, FlowRunEvent, FlowStep, FlowStepStatus } from '@agent-dashboard/shared';

function pickLatestEventAtOrBefore(events: FlowRunEvent[], atMs?: number): FlowRunEvent | undefined {
  let latest: FlowRunEvent | undefined;
  let latestMs = -Infinity;
  for (const event of events) {
    const eventMs = Date.parse(event.at);
    if (atMs !== undefined && eventMs > atMs) continue;
    if (!latest || eventMs >= latestMs) {
      latest = event;
      latestMs = eventMs;
    }
  }
  return latest;
}

/** Static "final state" reading: the latest run's most-recent matching event, full stop. */
export function effectiveStepStatus(step: FlowStep, runs: FlowRun[] | undefined): FlowStepStatus {
  if (!runs || runs.length === 0) return step.status;
  const latestRun = runs[runs.length - 1];
  if (!latestRun) return step.status;
  const events = latestRun.events.filter((e) => e.stepId === step.id);
  return pickLatestEventAtOrBefore(events)?.status ?? step.status;
}

/**
 * Time-bounded reading for playback: the given run's most-recent matching event at or before
 * `atMs` (epoch ms). Three cases:
 *  - the run has no events for this step at all -> fall back to the step's own `status` field
 *    (same "untracked by this run" fallback as `effectiveStepStatus`);
 *  - the run tracks this step but no event has happened yet as of `atMs` -> 'pending' (hasn't
 *    started in the replay yet), not the step's own (often-final) `status` field;
 *  - otherwise -> the matching event's status.
 */
export function effectiveStepStatusAt(
  step: FlowStep,
  run: FlowRun | undefined,
  atMs: number,
): FlowStepStatus {
  if (!run) return step.status;
  const events = run.events.filter((e) => e.stepId === step.id);
  if (events.length === 0) return step.status;
  return pickLatestEventAtOrBefore(events, atMs)?.status ?? 'pending';
}
