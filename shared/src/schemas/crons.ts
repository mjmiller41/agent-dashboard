// crons.json — PLAN.md §4: cron job list (display-only in Phase 1, no execution).
import { z } from 'zod';

// A plain 5-field cron expression: minute hour day-of-month month day-of-week.
// Fields may be numbers, '*', ranges, lists, or steps (e.g. '*/5', '1-5', '1,2,3').
const CRON_FIELD = String.raw`(\*|\*\/\d+|\d+(-\d+)?(\/\d+)?(,\d+(-\d+)?(\/\d+)?)*)`;
const CRON_5_FIELD = new RegExp(`^${CRON_FIELD}(\\s+${CRON_FIELD}){4}$`);

export const CronScheduleSchema = z
  .string()
  .regex(CRON_5_FIELD, 'must be a 5-field cron expression (minute hour dom month dow)');

export const CronJobSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  schedule: CronScheduleSchema,
  command: z.string().optional(),
  agentId: z.string().optional(),
  enabled: z.boolean(),
  lastRun: z.iso.datetime({ offset: true }).optional(),
  notes: z.string().optional(),
});
export type CronJob = z.infer<typeof CronJobSchema>;

export const CronsFileSchema = z.object({
  jobs: z.array(CronJobSchema),
});
export type CronsFile = z.infer<typeof CronsFileSchema>;
