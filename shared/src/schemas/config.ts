// config.json — PLAN.md §4: dashboard shell config (title, theme, tab strip).
import { z } from 'zod';

export const ThemePresetSchema = z.enum(['dark', 'light', 'midnight', 'terminal-green']);
export type ThemePreset = z.infer<typeof ThemePresetSchema>;

export const ThemeSchema = z.object({
  preset: ThemePresetSchema,
  accent: z.string().min(1),
});
export type Theme = z.infer<typeof ThemeSchema>;

export const TabSchema = z.object({
  id: z.string().min(1),
  panel: z.string().min(1),
  label: z.string().min(1),
  icon: z.string().min(1),
});
export type Tab = z.infer<typeof TabSchema>;

export const ConfigSchema = z.object({
  title: z.string().min(1),
  theme: ThemeSchema,
  tabs: z.array(TabSchema),
});
export type Config = z.infer<typeof ConfigSchema>;
