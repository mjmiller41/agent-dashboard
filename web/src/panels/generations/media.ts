// Resolves a GenerationItem's media src: `path` (workspace-relative, served
// through the existing /api/media route — PLAN.md §8 item 4) takes
// precedence over `url` (an external link, e.g. workspace.example's gen-07
// which ships no local file). Neither field is required by the schema, so a
// missing item yields undefined and callers render a broken-media fallback.
import type { GenerationItem } from '@agent-dashboard/shared';

export function mediaSrc(item: GenerationItem): string | undefined {
  if (item.path) return `/api/media?path=${encodeURIComponent(item.path)}`;
  if (item.url) return item.url;
  return undefined;
}
