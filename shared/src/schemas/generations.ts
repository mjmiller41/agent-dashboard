// generations.json — PLAN.md §4: gallery of generated images/videos.
import { z } from 'zod';

export const GenerationKindSchema = z.enum(['image', 'video']);
export type GenerationKind = z.infer<typeof GenerationKindSchema>;

export const GenerationItemSchema = z.object({
  id: z.string().min(1),
  createdAt: z.iso.datetime({ offset: true }),
  kind: GenerationKindSchema,
  prompt: z.string().optional(),
  model: z.string().optional(),
  path: z.string().optional(),
  url: z.string().optional(),
  tags: z.array(z.string()),
});
export type GenerationItem = z.infer<typeof GenerationItemSchema>;

export const GenerationsFileSchema = z.object({
  items: z.array(GenerationItemSchema),
});
export type GenerationsFile = z.infer<typeof GenerationsFileSchema>;
