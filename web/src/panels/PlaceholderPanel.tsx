// Trivial lazy-loaded stand-in for the real panels (Phase 5, PLAN.md §8).
// Default export so React.lazy(() => import('./PlaceholderPanel')) works.
// The point of this phase is the shell mechanics (routing/tabs/lazy
// loading), not the panels themselves.
import { EmptyState } from '../components/EmptyState';

export interface PlaceholderPanelProps {
  panelId: string;
  label: string;
}

export default function PlaceholderPanel({ panelId, label }: PlaceholderPanelProps) {
  return <EmptyState message={`${label} panel — coming in Phase 5 (panel id: "${panelId}").`} />;
}
