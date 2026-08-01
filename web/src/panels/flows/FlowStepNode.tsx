// Custom React Flow node (PLAN.md §8 item 9: "node card shows label, agent
// chip, status color"). `data-status` (in addition to the status modifier
// class) is what the e2e spec asserts on, per the brief's "not just
// visually" instruction.
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { FlowStepStatus } from '@agent-dashboard/shared';

export interface FlowNodeData extends Record<string, unknown> {
  label: string;
  agentId?: string;
  status: FlowStepStatus;
  notes?: string;
}

export type FlowNode = Node<FlowNodeData, 'step'>;

export function FlowStepNode({ data }: NodeProps<FlowNode>) {
  return (
    <div className={`flow-node flow-node--${data.status}`} data-status={data.status}>
      <Handle type="target" position={Position.Left} />
      <div className="flow-node__label">{data.label}</div>
      <div className="flow-node__meta">
        {data.agentId && <span className="flow-node__agent">{data.agentId}</span>}
        <span className="flow-node__status">{data.status}</span>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
