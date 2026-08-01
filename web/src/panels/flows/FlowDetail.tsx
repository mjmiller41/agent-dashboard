// Loads and renders one flow file (split out from FlowsPanel so
// useWorkspaceFile is only ever called with a real, known path — never a
// placeholder — matching the per-path-hook convention `useWorkspaceFile`
// requires, same reasoning as panels/docs/DocViewer.tsx being keyed by path).
import { FlowSchema } from '@agent-dashboard/shared';
import { ErrorCard } from '../../components/ErrorCard';
import { useWorkspaceFile } from '../../hooks/useWorkspaceFile';
import { FlowCanvas } from './FlowCanvas';

export interface FlowDetailProps {
  path: string;
}

export function FlowDetail({ path }: FlowDetailProps) {
  const { data, error, loading } = useWorkspaceFile(path, FlowSchema);

  if (error) {
    return <ErrorCard path={error.path} message={error.message} issues={error.issues} />;
  }
  if (loading && !data) {
    return <p>Loading flow…</p>;
  }
  if (!data) {
    return null;
  }
  return <FlowCanvas flow={data} />;
}
