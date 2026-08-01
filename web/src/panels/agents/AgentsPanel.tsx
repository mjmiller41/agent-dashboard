// Agents panel (PLAN.md §8 item 3 — "the most demo-critical panel"): roster
// cards + inline edit drawer. Reads/writes agents.json through the one data
// hook; live updates from disk arrive "for free" via useWorkspaceFile's SSE
// subscription (PLAN.md §12 guardrail 3).
import { useEffect, useState } from 'react';
import { AgentsFileSchema } from '@agent-dashboard/shared';
import { EmptyState } from '../../components/EmptyState';
import { ErrorCard } from '../../components/ErrorCard';
import { useWorkspaceFile } from '../../hooks/useWorkspaceFile';
import { AgentCard } from './AgentCard';
import { AgentDrawer } from './AgentDrawer';

const RELATIVE_TIME_REFRESH_MS = 30_000;

export default function AgentsPanel() {
  const { data, error, loading, save } = useWorkspaceFile('agents.json', AgentsFileSchema);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Keep "3m ago" labels fresh even when nothing on disk changes.
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), RELATIVE_TIME_REFRESH_MS);
    return () => clearInterval(interval);
  }, []);

  if (error) {
    return <ErrorCard path={error.path} message={error.message} issues={error.issues} />;
  }
  if (loading && !data) {
    return <p>Loading agents…</p>;
  }
  if (!data) {
    return null;
  }
  if (data.agents.length === 0) {
    return <EmptyState message="No agents yet — agents.json's agents array is empty." />;
  }

  const editingAgent = data.agents.find((agent) => agent.id === editingId) ?? null;

  return (
    <div className="agents-panel">
      <div className="agents-panel__grid">
        {data.agents.map((agent) => (
          <AgentCard key={agent.id} agent={agent} now={now} onEdit={() => setEditingId(agent.id)} />
        ))}
      </div>

      {editingAgent && (
        <AgentDrawer
          key={editingAgent.id}
          agent={editingAgent}
          onClose={() => setEditingId(null)}
          onSave={async (patch) => {
            await save((current) => ({
              agents: (current?.agents ?? []).map((agent) =>
                agent.id === editingAgent.id ? { ...agent, ...patch } : agent,
              ),
            }));
            setEditingId(null);
          }}
        />
      )}
    </div>
  );
}
