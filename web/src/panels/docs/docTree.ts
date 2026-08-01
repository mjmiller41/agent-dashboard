// Builds a nested folder/file tree from useDocTree's flat DocEntry list, for
// the Docs panel's file tree (PLAN.md §8 item 5).
import type { DocEntry } from './useDocTree';

export interface DocTreeFileNode {
  type: 'file';
  name: string;
  /** Full workspace-relative path, e.g. "docs/architecture/overview.md". */
  path: string;
}

export interface DocTreeFolderNode {
  type: 'folder';
  name: string;
  /** Folder path relative to docs/, e.g. "architecture". Used as a stable key. */
  path: string;
  children: DocTreeNode[];
}

export type DocTreeNode = DocTreeFileNode | DocTreeFolderNode;

export function buildDocTree(entries: DocEntry[]): DocTreeNode[] {
  const root: DocTreeFolderNode = { type: 'folder', name: '', path: '', children: [] };

  for (const entry of [...entries].sort((a, b) => a.relPath.localeCompare(b.relPath))) {
    const segments = entry.relPath.split('/');
    let cursor = root;
    for (let i = 0; i < segments.length - 1; i++) {
      const segment = segments[i];
      if (segment === undefined) continue; // unreachable given the loop bound; keeps noUncheckedIndexedAccess happy
      const folderPath = cursor.path ? `${cursor.path}/${segment}` : segment;
      const existing = cursor.children.find(
        (child): child is DocTreeFolderNode => child.type === 'folder' && child.name === segment,
      );
      const next: DocTreeFolderNode = existing ?? {
        type: 'folder',
        name: segment,
        path: folderPath,
        children: [],
      };
      if (!existing) cursor.children.push(next);
      cursor = next;
    }
    const fileName = segments[segments.length - 1] ?? entry.relPath;
    cursor.children.push({ type: 'file', name: fileName, path: entry.path });
  }

  sortTree(root.children);
  return root.children;
}

function sortTree(nodes: DocTreeNode[]): void {
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const node of nodes) {
    if (node.type === 'folder') sortTree(node.children);
  }
}
