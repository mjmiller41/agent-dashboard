// Skill Trees panel (PLAN.md §8 item 8): force-directed graph of
// skills.json, read/written through the one data hook (PLAN.md §12
// guardrail 3 — this panel is read-only for now, no write path needed).
import { useState } from 'react';
import { SkillsFileSchema } from '@agent-dashboard/shared';
import { EmptyState } from '../../components/EmptyState';
import { ErrorCard } from '../../components/ErrorCard';
import { useWorkspaceFile } from '../../hooks/useWorkspaceFile';
import { SkillDetailDrawer } from './SkillDetailDrawer';
import { SkillGraph } from './SkillGraph';

export default function SkillsPanel() {
  const { data, error, loading } = useWorkspaceFile('skills.json', SkillsFileSchema);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (error) {
    return <ErrorCard path={error.path} message={error.message} issues={error.issues} />;
  }
  if (loading && !data) {
    return <p>Loading skills…</p>;
  }
  if (!data) {
    return null;
  }
  if (data.nodes.length === 0) {
    return <EmptyState message="No skills yet — skills.json's nodes array is empty." />;
  }

  const selectedNode = data.nodes.find((n) => n.id === selectedId) ?? null;

  return (
    <div className="skills-panel">
      <p className="skills-panel__hint">
        Drag a node to pin it in place. Scroll to zoom, drag the background to pan.
      </p>
      <SkillGraph
        nodes={data.nodes}
        edges={data.edges}
        selectedId={selectedId}
        onSelectNode={setSelectedId}
      />
      {selectedNode && <SkillDetailDrawer node={selectedNode} onClose={() => setSelectedId(null)} />}
    </div>
  );
}
