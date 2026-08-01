// Assignee picker popover (PLAN.md §8 item 6: "assignee picker from
// agents"). agents.json is read-only reference data here — selecting an
// agent writes assigneeId into the task's entry in sprints.json (the
// panel's own document), never back into agents.json.
import { useRef } from 'react';
import { useModalA11y } from '../../hooks/useModalA11y';

export interface AssigneePopoverProps {
  agents: { id: string; name: string }[];
  currentAssigneeId: string | undefined;
  onSelect: (agentId: string | null) => void;
  onClose: () => void;
}

export function AssigneePopover({ agents, currentAssigneeId, onSelect, onClose }: AssigneePopoverProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  useModalA11y(containerRef, onClose);

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      className="assignee-popover"
      onClick={(event) => event.stopPropagation()}
    >
      <p className="assignee-popover__title">Assign to</p>
      <ul>
        <li>
          <button type="button" onClick={() => onSelect(null)}>
            Unassigned{!currentAssigneeId ? ' ✓' : ''}
          </button>
        </li>
        {agents.map((agent) => (
          <li key={agent.id}>
            <button type="button" onClick={() => onSelect(agent.id)}>
              {agent.name}
              {currentAssigneeId === agent.id ? ' ✓' : ''}
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="assignee-popover__close" onClick={onClose}>
        Close
      </button>
    </div>
  );
}
