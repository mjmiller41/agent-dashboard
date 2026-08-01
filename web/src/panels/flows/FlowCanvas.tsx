// DAG canvas (PLAN.md §8 item 9): React Flow + dagre auto-layout. Read-only
// display — no "run this flow" trigger (PLAN.md's own "no execution"
// framing; the brief for this run explicitly scoped out the full
// play/pause/scrub transport bar, see DECISIONS.md).
import { useMemo } from 'react';
import { Background, Controls, ReactFlow, ReactFlowProvider, type Edge } from '@xyflow/react';
import type { Flow } from '@agent-dashboard/shared';
import { FLOW_NODE_HEIGHT, FLOW_NODE_WIDTH, layoutFlowSteps } from './dagreLayout';
import { effectiveStepStatus } from './effectiveStatus';
import { FlowStepNode, type FlowNode } from './FlowStepNode';

export interface FlowCanvasProps {
  flow: Flow;
}

const NODE_TYPES = { step: FlowStepNode };

export function FlowCanvas({ flow }: FlowCanvasProps) {
  const latestRun = flow.runs && flow.runs.length > 0 ? flow.runs[flow.runs.length - 1] : undefined;

  const nodes = useMemo<FlowNode[]>(() => {
    const positions = layoutFlowSteps(flow.steps, flow.edges);
    return flow.steps.map((step) => ({
      id: step.id,
      type: 'step' as const,
      position: positions.get(step.id) ?? { x: 0, y: 0 },
      width: FLOW_NODE_WIDTH,
      height: FLOW_NODE_HEIGHT,
      data: {
        label: step.label,
        status: effectiveStepStatus(step, flow.runs),
        ...(step.agentId ? { agentId: step.agentId } : {}),
        ...(step.notes ? { notes: step.notes } : {}),
      },
    }));
  }, [flow.steps, flow.edges, flow.runs]);

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
      {latestRun && (
        <p className="flow-canvas__run-note">
          Showing statuses from the most recent run (started {new Date(latestRun.startedAt).toLocaleString()}
          ).
        </p>
      )}
    </div>
  );
}
