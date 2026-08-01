// Ctrl+K quick-switcher (PLAN.md §7). Scoped to tab switching for now since
// docs/links panels don't exist yet — see DECISIONS.md "Deferred" for the
// full panels+docs+links search.
import { useMemo, useRef, useState } from 'react';
import type { Tab } from '@agent-dashboard/shared';
import { useModalA11y } from '../hooks/useModalA11y';

export interface QuickSwitcherProps {
  tabs: Tab[];
  onSelect: (tabId: string) => void;
  onClose: () => void;
}

export function QuickSwitcher({ tabs, onSelect, onClose }: QuickSwitcherProps) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(
    () => tabs.filter((tab) => tab.label.toLowerCase().includes(query.toLowerCase())),
    [tabs, query],
  );
  const containerRef = useRef<HTMLDivElement>(null);
  useModalA11y(containerRef, onClose);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={containerRef}
        tabIndex={-1}
        className="quick-switcher"
        onClick={(event) => event.stopPropagation()}
      >
        <input
          autoFocus
          type="text"
          placeholder="Jump to a tab…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <ul>
          {filtered.map((tab) => (
            <li key={tab.id}>
              <button type="button" onClick={() => onSelect(tab.id)}>
                {tab.label}
              </button>
            </li>
          ))}
          {filtered.length === 0 && <li className="quick-switcher__empty">No matching tabs</li>}
        </ul>
      </div>
    </div>
  );
}
