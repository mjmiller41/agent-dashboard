// Node detail pane (PLAN.md §8 item 8: "click → detail card"), following the
// same modal-backdrop + drawer interaction convention as
// panels/agents/AgentDrawer.tsx / panels/providers/ProviderDrawer.tsx.
import { useRef } from 'react';
import type { SkillNode } from '@agent-dashboard/shared';
import { colorForCategory } from './colorForCategory';
import { useModalA11y } from '../../hooks/useModalA11y';

export interface SkillDetailDrawerProps {
  node: SkillNode;
  onClose: () => void;
}

export function SkillDetailDrawer({ node, onClose }: SkillDetailDrawerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  useModalA11y(containerRef, onClose);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={containerRef}
        tabIndex={-1}
        className="skill-detail-drawer"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="skill-detail-drawer__header">
          <h2>
            <span
              className="skill-detail-drawer__dot"
              style={{ background: colorForCategory(node.category) }}
            />
            {node.label}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <dl className="skill-detail-drawer__fields">
          <dt>Category</dt>
          <dd>{node.category}</dd>
          <dt>Description</dt>
          <dd>{node.description ?? '—'}</dd>
          <dt>Source</dt>
          <dd>{node.source ?? '—'}</dd>
        </dl>
      </div>
    </div>
  );
}
