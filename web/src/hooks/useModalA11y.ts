// Shared keyboard behavior for every modal-backdrop drawer/popover in this
// repo (PLAN.md §11 Phase 6: "modals... trap focus and close on Escape").
// Rather than each of AgentDrawer/ProviderDrawer/ConsentModal/
// SkillDetailDrawer/AssigneePopover/the Icons panel's assign popover/
// QuickSwitcher/SettingsModal hand-rolling its own Escape handler and focus
// trap, they all call this the same way on their root container ref.
//
// Behavior: on mount, focuses the first focusable descendant (or the
// container itself, which callers make focusable via `tabIndex={-1}`, if it
// has none); Tab/Shift+Tab cycles focus within the container instead of
// escaping to the page behind it; Escape calls `onClose` and stops the event
// from bubbling further (so a nested modal-within-a-modal, e.g. ConsentModal
// rendered inside ProviderDrawer, closes only the topmost one); on unmount,
// restores focus to whatever was focused before the modal opened.
import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export function useModalA11y<T extends HTMLElement>(
  containerRef: RefObject<T | null>,
  onClose: () => void,
): void {
  // Mirrors the latest `onClose` without making the setup effect below
  // re-run (and re-steal focus) on every render a parent passes a fresh
  // inline arrow function for it — the same "ref updated every render,
  // effect depends only on the ref" shape as the codebase's existing
  // useFlowPlayback.ts precedent for a similar "don't re-run on every
  // identity change" problem.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const container = containerRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    function focusables(): HTMLElement[] {
      return Array.from(container?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? []);
    }

    (focusables()[0] ?? container)?.focus();

    function handleKeydown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (event.shiftKey && document.activeElement === firstEl) {
        event.preventDefault();
        lastEl?.focus();
      } else if (!event.shiftKey && document.activeElement === lastEl) {
        event.preventDefault();
        firstEl?.focus();
      }
    }

    container?.addEventListener('keydown', handleKeydown);
    return () => {
      container?.removeEventListener('keydown', handleKeydown);
      previouslyFocused?.focus();
    };
  }, [containerRef]);
}
