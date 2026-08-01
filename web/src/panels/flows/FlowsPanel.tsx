// Flows panel (PLAN.md §8 item 9): flow list picker + a React Flow canvas
// per flow. `@xyflow/react`'s stylesheet is imported once here since this
// whole panel (and the stylesheet) is lazy-loaded only when the tab is open.
import '@xyflow/react/dist/style.css';
import { useState } from 'react';
import { EmptyState } from '../../components/EmptyState';
import { ErrorCard } from '../../components/ErrorCard';
import { useFlowList } from './useFlowList';
import { FlowDetail } from './FlowDetail';

export default function FlowsPanel() {
  const { flows, error: listError, loading: listLoading } = useFlowList();
  // No selection yet (or the previously-selected flow disappeared) falls back to the first flow,
  // computed directly during render rather than via a setState-in-effect (nothing external to sync).
  const [explicitPath, setExplicitPath] = useState<string | null>(null);

  if (listError) {
    return <ErrorCard path="flows/" message={listError} />;
  }
  if (listLoading && !flows) {
    return <p>Loading flows…</p>;
  }
  if (!flows || flows.length === 0) {
    return (
      <EmptyState message="No flows yet — add a flows/<slug>.json file (see workspace.example/flows/)." />
    );
  }

  const selectedPath =
    explicitPath && flows.some((f) => f.path === explicitPath) ? explicitPath : (flows[0]?.path ?? null);

  return (
    <div className="flows-panel">
      <div className="flows-panel__picker">
        {flows.map((entry) => (
          <button
            key={entry.path}
            type="button"
            className={`filter-pill${selectedPath === entry.path ? ' filter-pill--active' : ''}`}
            onClick={() => setExplicitPath(entry.path)}
          >
            {entry.slug}
          </button>
        ))}
      </div>

      {selectedPath && <FlowDetail key={selectedPath} path={selectedPath} />}
    </div>
  );
}
