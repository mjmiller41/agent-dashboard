// Reusable error surface for a workspace file that failed to load or failed
// zod validation (PLAN.md §4: "surface a per-panel error card showing the
// zod issue list and the file path"). Every future panel renders this
// instead of crashing when useWorkspaceFile returns an `error`.
import type { WorkspaceFileIssue } from '../hooks/useWorkspaceFile';

export interface ErrorCardProps {
  path: string;
  message: string;
  issues?: WorkspaceFileIssue[] | undefined;
}

export function ErrorCard({ path, message, issues }: ErrorCardProps) {
  return (
    <div className="error-card" role="alert">
      <h3 className="error-card__title">Failed to load {path}</h3>
      <p className="error-card__message">{message}</p>
      {issues && issues.length > 0 && (
        <ul className="error-card__issues">
          {issues.map((issue, index) => (
            <li key={index}>
              <code>{issue.path.length > 0 ? issue.path.map(String).join('.') : '(root)'}</code>:{' '}
              {issue.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
