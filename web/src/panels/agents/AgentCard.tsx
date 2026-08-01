// Roster card (PLAN.md §8 item 3): icon, name, role, status dot (pulse when
// active), current task line, relative lastUpdated.
import type { Agent } from '@agent-dashboard/shared';
import { formatRelativeTime } from './relativeTime';

export interface AgentCardProps {
  agent: Agent;
  now: number;
  onEdit: () => void;
}

export function AgentCard({ agent, now, onEdit }: AgentCardProps) {
  return (
    <div className="agent-card">
      <div className="agent-card__header">
        <img
          className="agent-card__icon"
          src={`/api/media?path=${encodeURIComponent(`icons/${agent.iconId}`)}`}
          alt=""
          width={40}
          height={40}
        />
        <div className="agent-card__identity">
          <div className="agent-card__name">{agent.name}</div>
          <div className="agent-card__role">{agent.role}</div>
        </div>
        <span
          className={`agent-card__status-dot agent-card__status-dot--${agent.status}`}
          title={agent.status}
          aria-label={`status: ${agent.status}`}
        />
      </div>

      {agent.currentTask && <p className="agent-card__task">{agent.currentTask}</p>}

      <div className="agent-card__footer">
        <span className="agent-card__updated">Updated {formatRelativeTime(agent.lastUpdated, now)}</span>
        <button type="button" className="agent-card__edit" onClick={onEdit}>
          Edit
        </button>
      </div>
    </div>
  );
}
