// Docs panel (PLAN.md §8 item 5): left file tree (workspace/docs/**/*.md via
// GET /api/ws/tree, filtered client-side — same pattern as Phase 5 part 1's
// Icons panel), marked+DOMPurify rendering, edit mode, create/rename/delete.
//
// Creating a file writes it to disk *before* selecting it (via the store's
// writeFile primitive directly, the same one useWorkspaceFile.save() calls —
// see DECISIONS.md "Phase 5 — Panels (part 2)"), so DocViewer only ever
// mounts bound to a path that already exists; it never has to fetch a
// not-yet-created path (which would 404, log a console error, and — with
// React StrictMode's double-effect-invocation in dev — log it twice).
import { useState } from 'react';
import { EmptyState } from '../../components/EmptyState';
import { ErrorCard } from '../../components/ErrorCard';
import { useWorkspaceStore } from '../../store';
import { buildDocTree } from './docTree';
import { DocTreeView } from './DocTreeView';
import { DocViewer } from './DocViewer';
import { useDocTree } from './useDocTree';

function stem(relPath: string): string {
  const fileName = relPath.split('/').pop() ?? relPath;
  return fileName.replace(/\.md$/, '');
}

export default function DocsPanel() {
  const { docs, error, loading, refetch } = useDocTree();
  const writeFile = useWorkspaceStore((state) => state.writeFile);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newPath, setNewPath] = useState('');
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  if (error) {
    return <ErrorCard path="workspace/docs" message={error} />;
  }
  if (loading && !docs) {
    return <p>Loading docs…</p>;
  }
  if (!docs) {
    return null;
  }

  function startCreate() {
    setCreating(true);
    setNewPath('');
    setCreateError(null);
  }

  async function submitCreate() {
    const trimmed = newPath.trim().replace(/^\/+/, '');
    if (!trimmed) {
      setCreateError('Enter a file path, e.g. "notes/idea.md".');
      return;
    }
    const withExt = trimmed.endsWith('.md') ? trimmed : `${trimmed}.md`;
    const fullPath = `docs/${withExt}`;
    setCreateBusy(true);
    setCreateError(null);
    try {
      await writeFile(fullPath, `# ${stem(withExt)}\n`);
      setSelectedPath(fullPath);
      setCreating(false);
      refetch();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreateBusy(false);
    }
  }

  const tree = buildDocTree(docs);

  return (
    <div className="docs-panel">
      <aside className="docs-panel__tree">
        <div className="docs-panel__tree-header">
          <h3>Docs</h3>
          <button type="button" onClick={startCreate}>
            + New
          </button>
        </div>

        {creating && (
          <form
            className="docs-panel__create-form"
            onSubmit={(event) => {
              event.preventDefault();
              void submitCreate();
            }}
          >
            <input
              autoFocus
              placeholder="path/to/file.md"
              value={newPath}
              onChange={(event) => setNewPath(event.target.value)}
            />
            <div className="docs-panel__create-form__actions">
              <button type="submit" disabled={createBusy}>
                Create
              </button>
              <button type="button" onClick={() => setCreating(false)}>
                Cancel
              </button>
            </div>
            {createError && <p className="docs-panel__error">{createError}</p>}
          </form>
        )}

        {docs.length === 0 ? (
          <p className="docs-panel__empty-tree">No docs yet.</p>
        ) : (
          <DocTreeView nodes={tree} selectedPath={selectedPath} onSelect={setSelectedPath} />
        )}
      </aside>

      <section className="docs-panel__viewer">
        {selectedPath ? (
          <DocViewer
            key={selectedPath}
            path={selectedPath}
            onDeleted={() => {
              setSelectedPath(null);
              refetch();
            }}
            onRenamed={(nextPath) => {
              setSelectedPath(nextPath);
              refetch();
            }}
          />
        ) : (
          <EmptyState message="Select a doc from the tree, or create a new one." />
        )}
      </section>
    </div>
  );
}
