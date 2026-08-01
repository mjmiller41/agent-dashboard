// Derives the status to display for a step (PLAN.md §8 item 9 wiring: "if
// the flow has a runs array, show the most recent run's step statuses").
// Falls back to the step's own `status` field when there's no run data for
// it — the two agree in the shipped example data, but this makes the
// "derive from the latest run" instruction literally true rather than
// coincidentally true.
import type { FlowRun, FlowStep, FlowStepStatus } from '@agent-dashboard/shared';

export function effectiveStepStatus(step: FlowStep, runs: FlowRun[] | undefined): FlowStepStatus {
  if (!runs || runs.length === 0) return step.status;
  const latestRun = runs[runs.length - 1];
  if (!latestRun) return step.status;
  let latest: FlowRun['events'][number] | undefined;
  for (const event of latestRun.events) {
    if (event.stepId !== step.id) continue;
    if (!latest || event.at >= latest.at) latest = event;
  }
  return latest?.status ?? step.status;
}
