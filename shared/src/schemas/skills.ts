// skills.json — PLAN.md §4: skill-tree graph (agent skills, force-directed layout).
import { z } from 'zod';

export const SkillNodeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  category: z.string().min(1),
  description: z.string().optional(),
  source: z.string().optional(),
});
export type SkillNode = z.infer<typeof SkillNodeSchema>;

export const SkillEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
});
export type SkillEdge = z.infer<typeof SkillEdgeSchema>;

export const SkillsFileSchema = z.object({
  nodes: z.array(SkillNodeSchema),
  edges: z.array(SkillEdgeSchema),
  scannedAt: z.iso.datetime({ offset: true }).optional(),
});
export type SkillsFile = z.infer<typeof SkillsFileSchema>;
