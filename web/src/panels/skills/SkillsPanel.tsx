// Skill Trees panel (PLAN.md §8 item 8): force-directed graph of
// skills.json, read/written through the one data hook (PLAN.md §12
// guardrail 3). The "Scan" button POSTs to /api/scan/skills (PLAN.md §5);
// the resulting skills.json write flows back through the same SSE
// ws-change -> useWorkspaceFile subscription every other panel already
// relies on, so no second refetch mechanism is added here (confirmed live —
// see DECISIONS.md "Phase 5 — Panels (part 4)").
import { useCallback, useState } from 'react';
import { SkillsFileSchema } from '@agent-dashboard/shared';
import { EmptyState } from '../../components/EmptyState';
import { ErrorCard } from '../../components/ErrorCard';
import { useWorkspaceFile } from '../../hooks/useWorkspaceFile';
import { SkillDetailDrawer } from './SkillDetailDrawer';
import { SkillGraph } from './SkillGraph';

async function parseError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error ?? `scan failed: ${res.status}`;
  } catch {
    return `scan failed: ${res.status}`;
  }
}

export default function SkillsPanel() {
  const { data, error, loading } = useWorkspaceFile('skills.json', SkillsFileSchema);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const runScan = useCallback(async () => {
    setScanning(true);
    setScanError(null);
    try {
      const res = await fetch('/api/scan/skills', { method: 'POST' });
      if (!res.ok) throw new Error(await parseError(res));
      // No manual refetch here: the server's skills.json write triggers a chokidar
      // ws-change SSE event, which useWorkspaceFile('skills.json', ...) above is already
      // subscribed to and refetches from automatically.
    } catch (err) {
      setScanError(err instanceof Error ? err.message : String(err));
    } finally {
      setScanning(false);
    }
  }, []);

  if (error) {
    return <ErrorCard path={error.path} message={error.message} issues={error.issues} />;
  }
  if (loading && !data) {
    return <p>Loading skills…</p>;
  }
  if (!data) {
    return null;
  }

  const selectedNode = data.nodes.find((n) => n.id === selectedId) ?? null;

  return (
    <div className="skills-panel">
      <div className="skills-panel__toolbar">
        <p className="skills-panel__hint">
          Drag a node to pin it in place. Scroll to zoom, drag the background to pan.
        </p>
        <button
          type="button"
          className="skills-panel__scan-button"
          disabled={scanning}
          onClick={() => void runScan()}
        >
          {scanning ? 'Scanning…' : 'Scan'}
        </button>
      </div>
      {scanError && <p className="skills-panel__scan-error">{scanError}</p>}
      {data.nodes.length === 0 ? (
        <EmptyState message="No skills yet — skills.json's nodes array is empty. Click Scan to discover skills on disk." />
      ) : (
        <SkillGraph
          nodes={data.nodes}
          edges={data.edges}
          selectedId={selectedId}
          onSelectNode={setSelectedId}
        />
      )}
      {selectedNode && <SkillDetailDrawer node={selectedNode} onClose={() => setSelectedId(null)} />}
    </div>
  );
}
