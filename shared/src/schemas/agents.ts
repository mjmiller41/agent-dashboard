// agents.json — PLAN.md §4: agent roster.
import { z } from 'zod';

export const AgentStatusSchema = z.enum(['active', 'idle', 'blocked', 'offline']);
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

export const AgentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  role: z.string().min(1),
  iconId: z.string().min(1),
  status: AgentStatusSchema,
  currentTask: z.string().optional(),
  lastUpdated: z.iso.datetime({ offset: true }),
  provider: z.string().optional(),
  notes: z.string().optional(),
});
export type Agent = z.infer<typeof AgentSchema>;

export const AgentsFileSchema = z.object({
  agents: z.array(AgentSchema),
});
export type AgentsFile = z.infer<typeof AgentsFileSchema>;
