// Hand-rolled relative-time formatting ("3m ago") — PLAN.md §8 item 3
// explicitly says no new date library is needed for this alone.
const UNITS: Array<[string, number]> = [
  ['y', 365 * 24 * 3600],
  ['mo', 30 * 24 * 3600],
  ['d', 24 * 3600],
  ['h', 3600],
  ['m', 60],
  ['s', 1],
];

export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'unknown';

  const diffSeconds = Math.round((now - then) / 1000);
  const future = diffSeconds < 0;
  const abs = Math.abs(diffSeconds);

  if (abs < 10) return 'just now';

  for (const [label, secondsPerUnit] of UNITS) {
    if (abs >= secondsPerUnit) {
      const value = Math.floor(abs / secondsPerUnit);
      return future ? `in ${value}${label}` : `${value}${label} ago`;
    }
  }
  return 'just now';
}
