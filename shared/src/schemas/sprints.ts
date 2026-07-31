// sprints.json — PLAN.md §4: current sprint + kanban tasks.
import { z } from 'zod';

export const SprintTaskStatusSchema = z.enum(['backlog', 'todo', 'doing', 'done']);
export type SprintTaskStatus = z.infer<typeof SprintTaskStatusSchema>;

export const SprintInfoSchema = z.object({
  name: z.string().min(1),
  startsOn: z.iso.date(),
  endsOn: z.iso.date(),
});
export type SprintInfo = z.infer<typeof SprintInfoSchema>;

export const SprintTaskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  status: SprintTaskStatusSchema,
  assigneeId: z.string().optional(),
  notes: z.string().optional(),
  order: z.number(),
});
export type SprintTask = z.infer<typeof SprintTaskSchema>;

export const SprintsFileSchema = z.object({
  current: SprintInfoSchema,
  tasks: z.array(SprintTaskSchema),
});
export type SprintsFile = z.infer<typeof SprintsFileSchema>;
