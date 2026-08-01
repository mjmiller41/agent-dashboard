// DAG canvas (PLAN.md §8 item 9): React Flow + dagre auto-layout, plus a playback transport bar
// when the flow has a non-empty `runs` array (PLAN.md §8 item 9: "a transport bar
// (play/pause/scrub/speed) that replays events by timestamp — animate the active node... and
// mark edges traversed"). Still no "run this flow" trigger (PLAN.md's own "no execution"
// framing) — playback only replays already-recorded run events, never starts a new run.
import { useMemo, useState } from 'react';
import { Background, Controls, ReactFlow, ReactFlowProvider, type Edge } from '@xyflow/react';
import type { Flow } from '@agent-dashboard/shared';
import { FLOW_NODE_HEIGHT, FLOW_NODE_WIDTH, layoutFlowSteps } from './dagreLayout';
import { effectiveStepStatusAt } from './effectiveStatus';
import { FlowPlaybackBar } from './FlowPlaybackBar';
import { FlowStepNode, type FlowNode } from './FlowStepNode';
import { useFlowPlayback } from './useFlowPlayback';

export interface FlowCanvasProps {
  flow: Flow;
}

const NODE_TYPES = { step: FlowStepNode };

export function FlowCanvas({ flow }: FlowCanvasProps) {
  const runs = useMemo(() => flow.runs ?? [], [flow.runs]);
  const hasRuns = runs.length > 0;

  // Default to the most recent run (matches the pre-playback static behavior). Initialized once
  // per mount from the flow's own runs — FlowsPanel remounts FlowCanvas's ancestor with
  // `key={selectedPath}` whenever the picker changes flow, so this naturally resets per flow
  // without an extra effect (same "derive during render/init, don't setState-in-effect for a
  // pure default" reasoning as FlowsPanel's own selectedPath fallback, DECISIONS.md Phase 5
  // part 3).
  const [selectedRunIndex, setSelectedRunIndex] = useState(() => Math.max(0, runs.length - 1));
  const clampedRunIndex = hasRuns ? Math.min(selectedRunIndex, runs.length - 1) : 0;
  const selectedRun = hasRuns ? runs[clampedRunIndex] : undefined;

  const playback = useFlowPlayback(selectedRun);

  const positions = useMemo(() => layoutFlowSteps(flow.steps, flow.edges), [flow.steps, flow.edges]);

  const nodes = useMemo<FlowNode[]>(() => {
    return flow.steps.map((step) => ({
      id: step.id,
      type: 'step' as const,
      position: positions.get(step.id) ?? { x: 0, y: 0 },
      width: FLOW_NODE_WIDTH,
      height: FLOW_NODE_HEIGHT,
      data: {
        label: step.label,
        status: hasRuns ? effectiveStepStatusAt(step, selectedRun, playback.scrubMs) : step.status,
        ...(step.agentId ? { agentId: step.agentId } : {}),
        ...(step.notes ? { notes: step.notes } : {}),
      },
    }));
  }, [flow.steps, positions, hasRuns, selectedRun, playback.scrubMs]);

  const statusById = useMemo(() => {
    const map = new Map<string, string>();
    for (const node of nodes) map.set(node.id, node.data.status);
    return map;
  }, [nodes]);

  const edges = useMemo<Edge[]>(() => {
    return flow.edges.map((edge) => {
      const fromStatus = statusById.get(edge.from);
      const traversed = fromStatus === 'done' || fromStatus === 'running';
      const failed = fromStatus === 'failed';
      const className = failed ? 'flow-edge--failed' : traversed ? 'flow-edge--traversed' : undefined;
      return {
        id: `${edge.from}->${edge.to}`,
        source: edge.from,
        target: edge.to,
        animated: fromStatus === 'running',
        ...(className ? { className } : {}),
      };
    });
  }, [flow.edges, statusById]);

  return (
    <div className="flow-canvas" data-run-count={flow.runs?.length ?? 0}>
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          fitView
          nodesDraggable
          nodesConnectable={false}
          elementsSelectable={false}
        >
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      </ReactFlowProvider>
      {hasRuns && selectedRun && (
        <>
          <FlowPlaybackBar
            runs={runs}
            selectedRunIndex={clampedRunIndex}
            onSelectRun={setSelectedRunIndex}
            playback={playback}
          />
          <p className="flow-canvas__run-note">
            Showing statuses from the {clampedRunIndex === runs.length - 1 ? 'most recent' : 'selected'} run
            (started {new Date(selectedRun.startedAt).toLocaleString()}).
          </p>
        </>
      )}
    </div>
  );
}
