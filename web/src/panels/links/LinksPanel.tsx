// Links panel (PLAN.md §8 item 1): card grid by group, inline add/edit/
// delete, favicons with a fallback glyph. Reads/writes links.json through
// the one data hook (PLAN.md §12 guardrail 3) — never a bespoke fetch.
import { useState } from 'react';
import { LinksFileSchema, type Link, type LinksFile } from '@agent-dashboard/shared';
import { EmptyState } from '../../components/EmptyState';
import { ErrorCard } from '../../components/ErrorCard';
import { useWorkspaceFile } from '../../hooks/useWorkspaceFile';
import { Favicon } from './Favicon';

interface LinkDraft {
  title: string;
  url: string;
  note: string;
}

const EMPTY_DRAFT: LinkDraft = { title: '', url: '', note: '' };

function makeId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

function draftToLink(draft: LinkDraft): Link | null {
  const title = draft.title.trim();
  const url = draft.url.trim();
  if (!title || !url) return null;
  const note = draft.note.trim();
  return note ? { title, url, note } : { title, url };
}

export default function LinksPanel() {
  const { data, error, loading, save } = useWorkspaceFile('links.json', LinksFileSchema);
  const [newGroupTitle, setNewGroupTitle] = useState('');
  const [addingLinkFor, setAddingLinkFor] = useState<string | null>(null);
  const [addDraft, setAddDraft] = useState<LinkDraft>(EMPTY_DRAFT);
  const [editing, setEditing] = useState<{ groupId: string; index: number } | null>(null);
  const [editDraft, setEditDraft] = useState<LinkDraft>(EMPTY_DRAFT);
  const [saveError, setSaveError] = useState<string | null>(null);

  if (error) {
    return <ErrorCard path={error.path} message={error.message} issues={error.issues} />;
  }
  if (loading && !data) {
    return <p>Loading links…</p>;
  }
  if (!data) {
    return null;
  }

  async function persist(mutator: (current: LinksFile | undefined) => LinksFile) {
    setSaveError(null);
    try {
      await save(mutator);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  }

  function addGroup() {
    const title = newGroupTitle.trim();
    if (!title) return;
    void persist((current) => ({
      groups: [...(current?.groups ?? []), { id: makeId('group'), title, links: [] }],
    }));
    setNewGroupTitle('');
  }

  function deleteGroup(groupId: string) {
    void persist((current) => ({
      groups: (current?.groups ?? []).filter((g) => g.id !== groupId),
    }));
  }

  function submitAddLink(groupId: string) {
    const link = draftToLink(addDraft);
    if (!link) return;
    void persist((current) => ({
      groups: (current?.groups ?? []).map((g) =>
        g.id === groupId ? { ...g, links: [...g.links, link] } : g,
      ),
    }));
    setAddingLinkFor(null);
    setAddDraft(EMPTY_DRAFT);
  }

  function startEdit(groupId: string, index: number, link: Link) {
    setEditing({ groupId, index });
    setEditDraft({ title: link.title, url: link.url, note: link.note ?? '' });
  }

  function submitEdit() {
    if (!editing) return;
    const link = draftToLink(editDraft);
    if (!link) return;
    const { groupId, index } = editing;
    void persist((current) => ({
      groups: (current?.groups ?? []).map((g) =>
        g.id === groupId ? { ...g, links: g.links.map((l, i) => (i === index ? link : l)) } : g,
      ),
    }));
    setEditing(null);
  }

  function deleteLink(groupId: string, index: number) {
    void persist((current) => ({
      groups: (current?.groups ?? []).map((g) =>
        g.id === groupId ? { ...g, links: g.links.filter((_, i) => i !== index) } : g,
      ),
    }));
  }

  return (
    <div className="links-panel">
      {saveError && <p className="links-panel__error">{saveError}</p>}

      {data.groups.length === 0 && (
        <EmptyState message="No link groups yet — add one below, or agents can write to links.json." />
      )}

      {data.groups.map((group) => (
        <section key={group.id} className="link-group">
          <div className="link-group__header">
            <h3 className="link-group__title">{group.title}</h3>
            <button type="button" className="link-group__delete" onClick={() => deleteGroup(group.id)}>
              Delete group
            </button>
          </div>

          <div className="link-grid">
            {group.links.map((link, index) => {
              const isEditing = editing?.groupId === group.id && editing.index === index;
              if (isEditing) {
                return (
                  <form
                    key={`${group.id}-${index}`}
                    className="link-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      submitEdit();
                    }}
                  >
                    <input
                      type="text"
                      placeholder="Title"
                      value={editDraft.title}
                      onChange={(event) => setEditDraft({ ...editDraft, title: event.target.value })}
                    />
                    <input
                      type="text"
                      placeholder="https://…"
                      value={editDraft.url}
                      onChange={(event) => setEditDraft({ ...editDraft, url: event.target.value })}
                    />
                    <input
                      type="text"
                      placeholder="Note (optional)"
                      value={editDraft.note}
                      onChange={(event) => setEditDraft({ ...editDraft, note: event.target.value })}
                    />
                    <div className="link-form__actions">
                      <button type="submit">Save</button>
                      <button type="button" onClick={() => setEditing(null)}>
                        Cancel
                      </button>
                    </div>
                  </form>
                );
              }

              return (
                <div key={`${group.id}-${index}`} className="link-card">
                  <Favicon url={link.url} />
                  <div className="link-card__body">
                    <a className="link-card__title" href={link.url} target="_blank" rel="noreferrer">
                      {link.title}
                    </a>
                    {link.note && <p className="link-card__note">{link.note}</p>}
                  </div>
                  <div className="link-card__actions">
                    <button type="button" onClick={() => startEdit(group.id, index, link)}>
                      Edit
                    </button>
                    <button type="button" onClick={() => deleteLink(group.id, index)}>
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {addingLinkFor === group.id ? (
            <form
              className="link-form"
              onSubmit={(event) => {
                event.preventDefault();
                submitAddLink(group.id);
              }}
            >
              <input
                type="text"
                placeholder="Title"
                value={addDraft.title}
                onChange={(event) => setAddDraft({ ...addDraft, title: event.target.value })}
                autoFocus
              />
              <input
                type="text"
                placeholder="https://…"
                value={addDraft.url}
                onChange={(event) => setAddDraft({ ...addDraft, url: event.target.value })}
              />
              <input
                type="text"
                placeholder="Note (optional)"
                value={addDraft.note}
                onChange={(event) => setAddDraft({ ...addDraft, note: event.target.value })}
              />
              <div className="link-form__actions">
                <button type="submit">Save</button>
                <button
                  type="button"
                  onClick={() => {
                    setAddingLinkFor(null);
                    setAddDraft(EMPTY_DRAFT);
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              className="link-group__add-link-toggle"
              onClick={() => {
                setAddingLinkFor(group.id);
                setAddDraft(EMPTY_DRAFT);
              }}
            >
              + Add link
            </button>
          )}
        </section>
      ))}

      <form
        className="links-panel__add-group"
        onSubmit={(event) => {
          event.preventDefault();
          addGroup();
        }}
      >
        <input
          type="text"
          placeholder="New group title"
          value={newGroupTitle}
          onChange={(event) => setNewGroupTitle(event.target.value)}
        />
        <button type="submit">Add group</button>
      </form>
    </div>
  );
}
