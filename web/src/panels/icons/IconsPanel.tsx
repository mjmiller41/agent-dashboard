// Icons panel (PLAN.md §8 item 2): gallery of workspace icons/*.svg served
// via /api/media; click an icon → "assign to agent" popover → writes the
// chosen iconId into that agent's entry in agents.json through
// useWorkspaceFile's save() (a targeted field update, not a raw overwrite —
// PLAN.md §8 item 2 / §12 guardrail 3).
import { useState } from 'react';
import { AgentsFileSchema } from '@agent-dashboard/shared';
import { EmptyState } from '../../components/EmptyState';
import { ErrorCard } from '../../components/ErrorCard';
import { useWorkspaceFile } from '../../hooks/useWorkspaceFile';
import { useIconList } from './useIconList';

export default function IconsPanel() {
  const { icons, error: iconsError, loading: iconsLoading } = useIconList();
  const {
    data: agentsData,
    error: agentsError,
    save: saveAgents,
  } = useWorkspaceFile('agents.json', AgentsFileSchema);
  const [openIconId, setOpenIconId] = useState<string | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);

  if (iconsError) {
    return <ErrorCard path="workspace/icons" message={iconsError} />;
  }
  if (agentsError) {
    return <ErrorCard path={agentsError.path} message={agentsError.message} issues={agentsError.issues} />;
  }
  if (iconsLoading && !icons) {
    return <p>Loading icons…</p>;
  }
  if (!icons || icons.length === 0) {
    return <EmptyState message="No icons in workspace/icons/ yet." />;
  }

  async function assign(iconId: string, agentId: string) {
    setAssignError(null);
    try {
      await saveAgents((current) => ({
        agents: (current?.agents ?? []).map((agent) => (agent.id === agentId ? { ...agent, iconId } : agent)),
      }));
      setOpenIconId(null);
    } catch (err) {
      setAssignError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="icons-panel">
      <p className="icons-panel__intro">Click an icon to assign it to an agent.</p>
      {assignError && <p className="icons-panel__error">{assignError}</p>}
      <div className="icons-panel__grid">
        {icons.map((icon) => (
          <div key={icon.path} className="icon-tile-wrap">
            <button
              type="button"
              className="icon-tile"
              onClick={() => setOpenIconId(openIconId === icon.id ? null : icon.id)}
            >
              <img
                src={`/api/media?path=${encodeURIComponent(icon.path)}`}
                alt={icon.id}
                width={40}
                height={40}
              />
              <span className="icon-tile__label">{icon.id}</span>
            </button>

            {openIconId === icon.id && (
              <div className="icon-assign-popover">
                <p className="icon-assign-popover__title">Assign to agent</p>
                {agentsData && agentsData.agents.length > 0 ? (
                  <ul>
                    {agentsData.agents.map((agent) => (
                      <li key={agent.id}>
                        <button type="button" onClick={() => void assign(icon.id, agent.id)}>
                          {agent.name}
                          {agent.iconId === icon.id ? ' ✓' : ''}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No agents in agents.json.</p>
                )}
                <button
                  type="button"
                  className="icon-assign-popover__close"
                  onClick={() => setOpenIconId(null)}
                >
                  Close
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
