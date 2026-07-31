// flows/<slug>.json — PLAN.md §4: a flow DAG, optionally with recorded playback runs.
import { z } from 'zod';

export const FlowStepStatusSchema = z.enum(['pending', 'running', 'done', 'failed', 'skipped']);
export type FlowStepStatus = z.infer<typeof FlowStepStatusSchema>;

export const FlowStepSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  agentId: z.string().optional(),
  status: FlowStepStatusSchema,
  startedAt: z.iso.datetime({ offset: true }).optional(),
  finishedAt: z.iso.datetime({ offset: true }).optional(),
  notes: z.string().optional(),
});
export type FlowStep = z.infer<typeof FlowStepSchema>;

export const FlowEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
});
export type FlowEdge = z.infer<typeof FlowEdgeSchema>;

export const FlowRunEventSchema = z.object({
  stepId: z.string().min(1),
  status: FlowStepStatusSchema,
  at: z.iso.datetime({ offset: true }),
});
export type FlowRunEvent = z.infer<typeof FlowRunEventSchema>;

export const FlowRunSchema = z.object({
  startedAt: z.iso.datetime({ offset: true }),
  events: z.array(FlowRunEventSchema),
});
export type FlowRun = z.infer<typeof FlowRunSchema>;

export const FlowSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  steps: z.array(FlowStepSchema),
  edges: z.array(FlowEdgeSchema),
  runs: z.array(FlowRunSchema).optional(),
});
export type Flow = z.infer<typeof FlowSchema>;
