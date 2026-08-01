// Deterministic string -> HSL color (PLAN.md §8 item 8: "color/group by
// category"). Hand-rolled hash, no dependency — same category string always
// maps to the same hue across renders/reloads.
export function colorForCategory(category: string): string {
  let hash = 0;
  for (let i = 0; i < category.length; i++) {
    hash = (hash * 31 + category.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  return `hsl(${hue}, 65%, 60%)`;
}
