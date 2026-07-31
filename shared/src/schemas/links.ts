// links.json — PLAN.md §4: bookmark groups.
import { z } from 'zod';

export const LinkSchema = z.object({
  title: z.string().min(1),
  url: z.url(),
  note: z.string().optional(),
});
export type Link = z.infer<typeof LinkSchema>;

export const LinkGroupSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  links: z.array(LinkSchema),
});
export type LinkGroup = z.infer<typeof LinkGroupSchema>;

export const LinksFileSchema = z.object({
  groups: z.array(LinkGroupSchema),
});
export type LinksFile = z.infer<typeof LinksFileSchema>;
