// Inline edit drawer (PLAN.md §8 item 3), following the same
// modal-backdrop + drawer interaction convention Phase 3's
// panels/providers/ProviderDrawer.tsx established (not a new pattern).
import { useRef, useState } from 'react';
import { AgentStatusSchema, type Agent, type AgentStatus } from '@agent-dashboard/shared';
import { useModalA11y } from '../../hooks/useModalA11y';

export interface AgentDrawerProps {
  agent: Agent;
  onClose: () => void;
  onSave: (patch: Partial<Agent>) => Promise<void>;
}

const STATUS_OPTIONS = AgentStatusSchema.options;

export function AgentDrawer({ agent, onClose, onSave }: AgentDrawerProps) {
  const [name, setName] = useState(agent.name);
  const [role, setRole] = useState(agent.role);
  const [status, setStatus] = useState<AgentStatus>(agent.status);
  const [iconId, setIconId] = useState(agent.iconId);
  const [currentTask, setCurrentTask] = useState(agent.currentTask ?? '');
  const [notes, setNotes] = useState(agent.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  useModalA11y(containerRef, onClose);

  async function submit() {
    const trimmedName = name.trim();
    const trimmedRole = role.trim();
    const trimmedIconId = iconId.trim();
    if (!trimmedName || !trimmedRole || !trimmedIconId) {
      setError('Name, role, and icon id are required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const trimmedTask = currentTask.trim();
      const trimmedNotes = notes.trim();
      await onSave({
        name: trimmedName,
        role: trimmedRole,
        status,
        iconId: trimmedIconId,
        lastUpdated: new Date().toISOString(),
        ...(trimmedTask ? { currentTask: trimmedTask } : {}),
        ...(trimmedNotes ? { notes: trimmedNotes } : {}),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={containerRef}
        tabIndex={-1}
        className="agent-drawer"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="agent-drawer__header">
          <h2>Edit {agent.name}</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {error && <p className="agent-drawer__error">{error}</p>}

        <label className="agent-drawer__field">
          Name
          <input type="text" value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="agent-drawer__field">
          Role
          <input type="text" value={role} onChange={(event) => setRole(event.target.value)} />
        </label>
        <label className="agent-drawer__field">
          Status
          <select value={status} onChange={(event) => setStatus(event.target.value as AgentStatus)}>
            {STATUS_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label className="agent-drawer__field">
          Current task
          <input type="text" value={currentTask} onChange={(event) => setCurrentTask(event.target.value)} />
        </label>
        <label className="agent-drawer__field">
          Icon id
          <input type="text" value={iconId} onChange={(event) => setIconId(event.target.value)} />
        </label>
        <label className="agent-drawer__field">
          Notes
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} />
        </label>

        <div className="agent-drawer__actions">
          <button type="button" disabled={busy} onClick={() => void submit()}>
            Save
          </button>
          <button type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
