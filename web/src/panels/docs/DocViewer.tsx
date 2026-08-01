// View/edit a single docs/**/*.md file (PLAN.md §8 item 5): marked+DOMPurify
// rendering by default, a plain <textarea> + Save for edit mode (explicitly
// no code-editor dependency), plus rename/delete. DocsPanel only ever mounts
// this for a path that already exists on disk — file creation happens
// before selection (see DocsPanel's create form), so this component never
// needs to special-case a not-yet-created file.
//
// Markdown files aren't one of shared/src/schemas' document types (Phase 1's
// isUnvalidatedWorkspacePath recognizes docs/**/*.md as valid-but-unvalidated
// raw text), but useWorkspaceFile is generic in T — GET/PUT /api/ws/file
// already return/accept raw text for any non-.json path (server/src/
// workspace.ts's readFile/writeFile), so `useWorkspaceFile(path, z.string())`
// works unchanged. No variant hook needed (PLAN.md §12 guardrail 3: extend
// the one hook's usage, don't bypass it).
//
// The textarea is uncontrolled (defaultValue + a ref, read on Save) rather
// than a `draft` state kept in sync with `data` via useEffect: the parent
// (DocsPanel) already remounts this whole component with `key={path}` per
// selected doc, and the textarea itself only mounts when `editing` toggles
// on — no derived-state effect needed (avoids react-hooks' set-state-in-
// effect lint rule entirely).
import { useRef, useState } from 'react';
import { z } from 'zod';
import { ErrorCard } from '../../components/ErrorCard';
import { useWorkspaceFile } from '../../hooks/useWorkspaceFile';
import { useWorkspaceStore } from '../../store';
import { renderMarkdown } from './renderMarkdown';

const DocContentSchema = z.string();

export interface DocViewerProps {
  /** Full workspace-relative path, e.g. "docs/architecture/overview.md". Must already exist on
   *  disk — DocsPanel's create form writes the file before ever selecting it. */
  path: string;
  onDeleted: () => void;
  onRenamed: (nextPath: string) => void;
}

export function DocViewer({ path, onDeleted, onRenamed }: DocViewerProps) {
  const { data, error, loading, save, remove } = useWorkspaceFile(path, DocContentSchema);
  // Rename needs to write the *new* path while this hook instance is still bound to the old one —
  // reusing the store's writeFile primitive directly (the exact function useWorkspaceFile.save()
  // itself calls) rather than a raw fetch. See DECISIONS.md "Phase 5 — Panels (part 2)".
  const writeAnyPath = useWorkspaceStore((state) => state.writeFile);

  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(() => path.replace(/^docs\//, ''));
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  if (error) {
    return <ErrorCard path={error.path} message={error.message} issues={error.issues} />;
  }
  if (loading && data === undefined) {
    return <p>Loading…</p>;
  }

  const title = path.replace(/^docs\//, '');

  async function handleSave() {
    const content = textareaRef.current?.value ?? '';
    setBusy(true);
    setActionError(null);
    try {
      await save(() => content);
      setEditing(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Delete ${path}? This cannot be undone.`)) return;
    setBusy(true);
    setActionError(null);
    try {
      await remove();
      onDeleted();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  async function handleRename() {
    const trimmed = renameValue.trim().replace(/^\/+/, '');
    if (!trimmed) {
      setActionError('Enter a new path.');
      return;
    }
    const withExt = trimmed.endsWith('.md') ? trimmed : `${trimmed}.md`;
    const nextPath = `docs/${withExt}`;
    if (nextPath === path) {
      setRenaming(false);
      return;
    }
    const content = textareaRef.current?.value ?? data ?? '';
    setBusy(true);
    setActionError(null);
    try {
      await writeAnyPath(nextPath, content);
      await remove();
      onRenamed(nextPath);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div className="doc-viewer">
      <div className="doc-viewer__header">
        <h2>{title}</h2>
        <div className="doc-viewer__actions">
          {!editing && (
            <button type="button" onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
          {editing && (
            <button type="button" disabled={busy} onClick={() => void handleSave()}>
              Save
            </button>
          )}
          {editing && (
            <button type="button" disabled={busy} onClick={() => setEditing(false)}>
              Cancel
            </button>
          )}
          <button type="button" disabled={busy} onClick={() => setRenaming((r) => !r)}>
            Rename
          </button>
          <button
            type="button"
            disabled={busy}
            className="doc-viewer__delete"
            onClick={() => void handleDelete()}
          >
            Delete
          </button>
        </div>
      </div>

      {actionError && <p className="doc-viewer__error">{actionError}</p>}

      {renaming && (
        <form
          className="doc-viewer__rename-form"
          onSubmit={(event) => {
            event.preventDefault();
            void handleRename();
          }}
        >
          <input value={renameValue} onChange={(event) => setRenameValue(event.target.value)} />
          <button type="submit" disabled={busy}>
            Confirm rename
          </button>
          <button type="button" onClick={() => setRenaming(false)}>
            Cancel
          </button>
        </form>
      )}

      {editing ? (
        <textarea ref={textareaRef} className="doc-viewer__textarea" defaultValue={data ?? ''} rows={22} />
      ) : (
        <div
          className="doc-viewer__rendered"
          // Sanitized via DOMPurify in renderMarkdown() — PLAN.md §12 guardrail 4.
          dangerouslySetInnerHTML={{ __html: renderMarkdown(data ?? '') }}
        />
      )}
    </div>
  );
}
