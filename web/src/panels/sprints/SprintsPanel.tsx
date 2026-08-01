// Sprints panel (PLAN.md §8 item 6, and the panel §11 explicitly names for
// its acceptance criterion: "Sprints drag-drop... demonstrated in tests").
// @dnd-kit kanban: 3 status columns (todo/doing/done) + a collapsible
// backlog rail — see DECISIONS.md "Phase 5 — Panels (part 2)" for the
// "4 columns + collapsible backlog rail" reading (backlog is a real 4th
// status per SprintTaskStatusSchema, just presented as a rail rather than a
// plain column). Drag writes status + order back to sprints.json through
// useWorkspaceFile's save() (PLAN.md §12 guardrail 3 — no raw fetch/PUT).
import { useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  AgentsFileSchema,
  SprintsFileSchema,
  SprintTaskStatusSchema,
  type SprintTask,
  type SprintTaskStatus,
} from '@agent-dashboard/shared';
import { EmptyState } from '../../components/EmptyState';
import { ErrorCard } from '../../components/ErrorCard';
import { useWorkspaceFile } from '../../hooks/useWorkspaceFile';
import { KanbanColumn } from './KanbanColumn';
import { SprintHeader } from './SprintHeader';
import { TaskCard } from './TaskCard';

const STATUSES = SprintTaskStatusSchema.options;
const BOARD_STATUSES: Array<'todo' | 'doing' | 'done'> = ['todo', 'doing', 'done'];
const COLUMN_TITLES: Record<'todo' | 'doing' | 'done', string> = {
  todo: 'To do',
  doing: 'Doing',
  done: 'Done',
};

function isStatus(value: string): value is SprintTaskStatus {
  return (STATUSES as readonly string[]).includes(value);
}

export default function SprintsPanel() {
  const { data, error, loading, save } = useWorkspaceFile('sprints.json', SprintsFileSchema);
  const { data: agentsData } = useWorkspaceFile('agents.json', AgentsFileSchema);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [backlogCollapsed, setBacklogCollapsed] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const grouped = useMemo(() => {
    const byStatus: Record<SprintTaskStatus, SprintTask[]> = { backlog: [], todo: [], doing: [], done: [] };
    for (const task of data?.tasks ?? []) byStatus[task.status].push(task);
    for (const status of STATUSES) byStatus[status].sort((a, b) => a.order - b.order);
    return byStatus;
  }, [data]);

  const tasksById = useMemo(() => {
    const map = new Map<string, SprintTask>();
    for (const task of data?.tasks ?? []) map.set(task.id, task);
    return map;
  }, [data]);

  const agentsById = useMemo(() => {
    const map = new Map<string, string>();
    for (const agent of agentsData?.agents ?? []) map.set(agent.id, agent.name);
    return map;
  }, [agentsData]);

  const agentsList = useMemo(
    () => (agentsData?.agents ?? []).map((agent) => ({ id: agent.id, name: agent.name })),
    [agentsData],
  );

  if (error) {
    return <ErrorCard path={error.path} message={error.message} issues={error.issues} />;
  }
  if (loading && !data) {
    return <p>Loading sprint…</p>;
  }
  if (!data) {
    return null;
  }
  if (data.tasks.length === 0) {
    return <EmptyState message="No sprint tasks yet — sprints.json's tasks array is empty." />;
  }

  // Captured as a plain (non-union) value so the drag/assign handlers below — nested closures
  // TypeScript doesn't narrow `data` itself across — have a definitely-defined fallback to fall
  // back to without re-deriving "possibly undefined" types.
  const sprintInfo = data.current;

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    if (!over) return;

    const activeTaskId = String(active.id);
    const overId = String(over.id);
    const activeTask = tasksById.get(activeTaskId);
    if (!activeTask) return;

    const destStatus = isStatus(overId) ? overId : tasksById.get(overId)?.status;
    if (!destStatus) return;
    if (destStatus === activeTask.status && overId === activeTaskId) return;

    void save((current) => {
      const tasks = current?.tasks ?? [];
      const byStatus: Record<SprintTaskStatus, SprintTask[]> = { backlog: [], todo: [], doing: [], done: [] };
      for (const task of [...tasks].sort((a, b) => a.order - b.order)) {
        byStatus[task.status].push(task);
      }

      const sourceArr = byStatus[activeTask.status];
      const sourceIndex = sourceArr.findIndex((task) => task.id === activeTaskId);
      if (sourceIndex === -1) return current ?? { current: sprintInfo, tasks };
      const [moved] = sourceArr.splice(sourceIndex, 1);
      if (!moved) return current ?? { current: sprintInfo, tasks };

      const destArr = byStatus[destStatus];
      let insertIndex = destArr.length;
      if (!isStatus(overId)) {
        const overIndex = destArr.findIndex((task) => task.id === overId);
        if (overIndex !== -1) insertIndex = overIndex;
      }
      destArr.splice(insertIndex, 0, { ...moved, status: destStatus });

      const nextTasks: SprintTask[] = [];
      for (const status of STATUSES) {
        byStatus[status].forEach((task, index) => nextTasks.push({ ...task, order: index }));
      }

      return { current: current?.current ?? sprintInfo, tasks: nextTasks };
    });
  }

  function handleAssign(taskId: string, agentId: string | null) {
    void save((current) => {
      const tasks = (current?.tasks ?? []).map((task) =>
        task.id === taskId ? { ...task, assigneeId: agentId ?? undefined } : task,
      );
      return { current: current?.current ?? sprintInfo, tasks };
    });
  }

  const activeTask = activeId ? (tasksById.get(activeId) ?? null) : null;
  const doneCount = data.tasks.filter((task) => task.status === 'done').length;

  return (
    <div className="sprints-panel">
      <SprintHeader info={data.current} doneCount={doneCount} totalCount={data.tasks.length} />

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="kanban-board">
          <KanbanColumn
            status="backlog"
            title="Backlog"
            tasks={grouped.backlog}
            agentsById={agentsById}
            agents={agentsList}
            onAssign={handleAssign}
            collapsible
            collapsed={backlogCollapsed}
            onToggleCollapsed={() => setBacklogCollapsed((c) => !c)}
          />
          {BOARD_STATUSES.map((status) => (
            <KanbanColumn
              key={status}
              status={status}
              title={COLUMN_TITLES[status]}
              tasks={grouped[status]}
              agentsById={agentsById}
              agents={agentsList}
              onAssign={handleAssign}
            />
          ))}
        </div>

        <DragOverlay>
          {activeTask ? (
            <TaskCard
              task={activeTask}
              assigneeName={activeTask.assigneeId ? agentsById.get(activeTask.assigneeId) : undefined}
              overlay
            />
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
