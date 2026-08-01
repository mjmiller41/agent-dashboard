// dagre auto-layout (PLAN.md §8 item 9: "on load run dagre layout
// (left→right) for any nodes without stored positions"). FlowStep/FlowEdge
// don't carry a stored position in the schema at all, so every load is
// laid out fresh — dagre computes node centers from the steps/edges graph,
// converted here to React Flow's top-left node positions.
import dagre, { type GraphLabel, type NodeLabel, type EdgeLabel } from '@dagrejs/dagre';
import type { FlowEdge, FlowStep } from '@agent-dashboard/shared';

export const FLOW_NODE_WIDTH = 200;
export const FLOW_NODE_HEIGHT = 72;

export function layoutFlowSteps(steps: FlowStep[], edges: FlowEdge[]): Map<string, { x: number; y: number }> {
  const graph = new dagre.graphlib.Graph<GraphLabel, NodeLabel, EdgeLabel>();
  graph.setGraph({ rankdir: 'LR', nodesep: 40, ranksep: 90 });
  graph.setDefaultEdgeLabel(() => ({}));

  for (const step of steps) {
    graph.setNode(step.id, { width: FLOW_NODE_WIDTH, height: FLOW_NODE_HEIGHT });
  }
  const stepIds = new Set(steps.map((s) => s.id));
  for (const edge of edges) {
    if (stepIds.has(edge.from) && stepIds.has(edge.to)) {
      graph.setEdge(edge.from, edge.to);
    }
  }

  dagre.layout(graph);

  const positions = new Map<string, { x: number; y: number }>();
  for (const step of steps) {
    const node = graph.node(step.id);
    if (!node || node.x === undefined || node.y === undefined) continue;
    // dagre positions are node centers; React Flow positions are top-left.
    positions.set(step.id, { x: node.x - FLOW_NODE_WIDTH / 2, y: node.y - FLOW_NODE_HEIGHT / 2 });
  }
  return positions;
}
