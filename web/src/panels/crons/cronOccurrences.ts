// cron-parser wrappers (PLAN.md §8 item 7). Deliberately operate in the
// browser's local timezone throughout (no `utc: true`, no explicit
// currentDate passed for "now"-relative calls) — real crontab entries run in
// the system's local timezone by default, and keeping every call (next-N,
// per-day occurrence check) on the same implicit local clock avoids a
// UTC/local mismatch between the two (see DECISIONS.md).
import { CronExpressionParser, type CronExpression } from 'cron-parser';
import { endOfDay, startOfDay } from 'date-fns';

/** Parses a schedule, returning `null` (not throwing) if it's semantically invalid — e.g. a
 *  field value out of range that the shared CronScheduleSchema's shape-only regex allows through. */
export function tryParseCron(schedule: string): CronExpression | null {
  try {
    return CronExpressionParser.parse(schedule);
  } catch {
    return null;
  }
}

/** Next `count` occurrences from now, or `[]` for an invalid schedule. */
export function nextOccurrences(schedule: string, count: number): Date[] {
  const expr = tryParseCron(schedule);
  if (!expr) return [];
  return expr.take(count).map((d) => d.toDate());
}

/** Does this (valid) schedule fire at least once on the given calendar day? */
export function hasOccurrenceOnDay(schedule: string, day: Date): boolean {
  try {
    const expr = CronExpressionParser.parse(schedule, {
      currentDate: startOfDay(day),
      endDate: endOfDay(day),
    });
    return expr.hasNext();
  } catch {
    return false;
  }
}

/** All occurrence times for a (valid) schedule on the given calendar day, for the hover popover. */
export function occurrencesOnDay(schedule: string, day: Date): Date[] {
  const out: Date[] = [];
  try {
    const expr = CronExpressionParser.parse(schedule, {
      currentDate: startOfDay(day),
      endDate: endOfDay(day),
    });
    while (expr.hasNext()) {
      out.push(expr.next().toDate());
      if (out.length > 100) break; // safety cap, matches PLAN.md's "don't over-build" spirit
    }
  } catch {
    // invalid schedule — caller is expected to have already excluded these from the calendar
  }
  return out;
}
