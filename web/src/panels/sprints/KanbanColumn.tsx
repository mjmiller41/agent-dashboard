// One kanban column (PLAN.md §8 item 6). Used both for the 3 fixed status
// columns (todo/doing/done) and, with `collapsible`, for the backlog rail —
// see DECISIONS.md "Phase 5 — Panels (part 2)" for the "4 columns +
// collapsible backlog rail" reading this implements.
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { SprintTask, SprintTaskStatus } from '@agent-dashboard/shared';
import { TaskCard } from './TaskCard';

export interface KanbanColumnProps {
  status: SprintTaskStatus;
  title: string;
  tasks: SprintTask[];
  agentsById: Map<string, string>;
  agents: { id: string; name: string }[];
  onAssign: (taskId: string, agentId: string | null) => void;
  collapsible?: boolean;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

export function KanbanColumn({
  status,
  title,
  tasks,
  agentsById,
  agents,
  onAssign,
  collapsible,
  collapsed,
  onToggleCollapsed,
}: KanbanColumnProps) {
  const { setNodeRef } = useDroppable({ id: status });
  const taskIds = tasks.map((task) => task.id);
  const isCollapsed = Boolean(collapsible && collapsed);

  const classNames = ['kanban-column'];
  if (collapsible) classNames.push('kanban-column--rail');
  if (isCollapsed) classNames.push('kanban-column--collapsed');

  return (
    <div className={classNames.join(' ')} data-column={status}>
      <div className="kanban-column__header">
        {collapsible ? (
          <button type="button" className="kanban-column__toggle" onClick={onToggleCollapsed}>
            <span>{collapsed ? '▸' : '▾'}</span> {title} ({tasks.length})
          </button>
        ) : (
          <h3>
            {title} <span className="kanban-column__count">{tasks.length}</span>
          </h3>
        )}
      </div>

      {!isCollapsed && (
        <div ref={setNodeRef} className="kanban-column__list">
          <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
            {tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                assigneeName={task.assigneeId ? agentsById.get(task.assigneeId) : undefined}
                agents={agents}
                onAssign={(agentId) => onAssign(task.id, agentId)}
              />
            ))}
            {tasks.length === 0 && <p className="kanban-column__empty">No tasks</p>}
          </SortableContext>
        </div>
      )}
    </div>
  );
}
