// One kanban card (PLAN.md §8 item 6). Draggable via @dnd-kit/sortable's
// useSortable — the whole card is the drag handle, but PointerSensor's
// activation-distance constraint (set on the DndContext in SprintsPanel)
// means a plain click (no movement) still reaches the assignee button
// normally instead of starting a drag.
import { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { SprintTask } from '@agent-dashboard/shared';
import { AssigneePopover } from './AssigneePopover';

export interface TaskCardProps {
  task: SprintTask;
  assigneeName?: string | undefined;
  agents?: { id: string; name: string }[];
  onAssign?: (agentId: string | null) => void;
  /** True only for the DragOverlay's floating copy — not sortable, not interactive. */
  overlay?: boolean;
}

export function TaskCard({ task, assigneeName, agents, onAssign, overlay }: TaskCardProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const sortable = useSortable({ id: task.id, ...(overlay ? { disabled: true } : {}) });

  const style = overlay
    ? undefined
    : {
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
        opacity: sortable.isDragging ? 0.4 : 1,
      };

  return (
    <div
      ref={overlay ? undefined : sortable.setNodeRef}
      style={style}
      className={`kanban-card${overlay ? ' kanban-card--overlay' : ''}`}
      data-task-id={task.id}
      {...(overlay ? {} : sortable.attributes)}
      {...(overlay ? {} : sortable.listeners)}
    >
      <p className="kanban-card__title">{task.title}</p>
      {task.notes && <p className="kanban-card__notes">{task.notes}</p>}
      <div className="kanban-card__footer">
        {agents && onAssign ? (
          <div className="kanban-card__assignee-wrap">
            <button
              type="button"
              className="kanban-card__assignee"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                setPopoverOpen((open) => !open);
              }}
            >
              {assigneeName ?? 'Unassigned'}
            </button>
            {popoverOpen && (
              <AssigneePopover
                agents={agents}
                currentAssigneeId={task.assigneeId}
                onSelect={(agentId) => {
                  onAssign(agentId);
                  setPopoverOpen(false);
                }}
                onClose={() => setPopoverOpen(false)}
              />
            )}
          </div>
        ) : (
          <span className="kanban-card__assignee">{assigneeName ?? 'Unassigned'}</span>
        )}
      </div>
    </div>
  );
}
