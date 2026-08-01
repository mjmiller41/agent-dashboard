// Recursive file-tree rendering for the Docs panel's left rail (PLAN.md §8
// item 5). Folders toggle open/closed locally (ephemeral UI state, not
// persisted — not a workspace document, so no file-first concern applies).
import { useState } from 'react';
import type { DocTreeNode } from './docTree';

export interface DocTreeViewProps {
  nodes: DocTreeNode[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

export function DocTreeView({ nodes, selectedPath, onSelect }: DocTreeViewProps) {
  return (
    <ul className="doc-tree">
      {nodes.map((node) => (
        <DocTreeItem
          key={node.path || node.name}
          node={node}
          selectedPath={selectedPath}
          onSelect={onSelect}
        />
      ))}
    </ul>
  );
}

interface DocTreeItemProps {
  node: DocTreeNode;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

function DocTreeItem({ node, selectedPath, onSelect }: DocTreeItemProps) {
  const [collapsed, setCollapsed] = useState(false);

  if (node.type === 'file') {
    const isActive = selectedPath === node.path;
    return (
      <li className="doc-tree__item">
        <button
          type="button"
          className={`doc-tree__file${isActive ? ' doc-tree__file--active' : ''}`}
          data-doc-path={node.path}
          onClick={() => onSelect(node.path)}
        >
          {node.name}
        </button>
      </li>
    );
  }

  return (
    <li className="doc-tree__item">
      <button type="button" className="doc-tree__folder" onClick={() => setCollapsed((c) => !c)}>
        <span className="doc-tree__folder-caret">{collapsed ? '▸' : '▾'}</span> {node.name}
      </button>
      {!collapsed && (
        <ul className="doc-tree__children">
          {node.children.map((child) => (
            <DocTreeItem
              key={child.path || child.name}
              node={child}
              selectedPath={selectedPath}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
