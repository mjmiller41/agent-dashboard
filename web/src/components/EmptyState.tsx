// Reusable empty-state primitive (PLAN.md §7: "message + optional action
// button that e.g. writes an example file"). Panels built in Phase 5 supply
// their own copy/action; this phase wires it once as the placeholder-panel
// and no-tabs-configured states so it's provably used, not dead code.
export interface EmptyStateProps {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ message, actionLabel, onAction }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <p className="empty-state__message">{message}</p>
      {actionLabel && onAction && (
        <button type="button" className="empty-state__action" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}
