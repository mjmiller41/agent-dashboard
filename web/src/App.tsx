import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { ConfigSchema, type Tab } from '@agent-dashboard/shared';
import { useWorkspaceFile } from './hooks/useWorkspaceFile';
import { useRoute } from './hooks/useRoute';
import { navigate } from './router';
import { ErrorCard } from './components/ErrorCard';
import { EmptyState } from './components/EmptyState';
import { OfflineBanner } from './components/OfflineBanner';
import { QuickSwitcher } from './components/QuickSwitcher';
import { SettingsModal } from './components/SettingsModal';

const ProvidersPanel = lazy(() => import('./panels/providers/ProvidersPanel'));
const AssistantPanel = lazy(() => import('./panels/assistant/AssistantPanel'));
const LinksPanel = lazy(() => import('./panels/links/LinksPanel'));
const IconsPanel = lazy(() => import('./panels/icons/IconsPanel'));
const AgentsPanel = lazy(() => import('./panels/agents/AgentsPanel'));
const GenerationsPanel = lazy(() => import('./panels/generations/GenerationsPanel'));
const DocsPanel = lazy(() => import('./panels/docs/DocsPanel'));
const SprintsPanel = lazy(() => import('./panels/sprints/SprintsPanel'));
const CronsPanel = lazy(() => import('./panels/crons/CronsPanel'));
const SkillsPanel = lazy(() => import('./panels/skills/SkillsPanel'));
const FlowsPanel = lazy(() => import('./panels/flows/FlowsPanel'));

// Panel ids the shell knows how to route to. Every panel now has a real
// component (Phase 5 parts 1-3, the closing slice — `PlaceholderPanel`
// still exists as a file but nothing routes to it anymore); a tab whose
// `panel` isn't in this set renders as an error tab, per PLAN.md §4
// ("unknown panel ids render an error tab").
const KNOWN_PANEL_IDS = new Set([
  'agents',
  'flows',
  'skills',
  'crons',
  'generations',
  'docs',
  'links',
  'sprints',
  'icons',
  'providers',
  'assistant',
]);

const DEFAULT_TABS: Tab[] = [
  { id: 'agents', panel: 'agents', label: 'Agents', icon: 'icon-01.svg' },
  { id: 'flows', panel: 'flows', label: 'Flows', icon: 'icon-02.svg' },
];

export function App() {
  const { data: config, error, save } = useWorkspaceFile('config.json', ConfigSchema);
  const route = useRoute();
  const [quickSwitcherOpen, setQuickSwitcherOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const tabs = useMemo(() => config?.tabs ?? [], [config]);
  const activeTabId = route.panelId ?? tabs[0]?.id ?? null;
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;

  useEffect(() => {
    if (!config) return;
    document.documentElement.dataset.theme = config.theme.preset;
    document.documentElement.style.setProperty('--color-accent', config.theme.accent);
    document.title = config.title;
  }, [config]);

  useEffect(() => {
    function handleKeydown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setQuickSwitcherOpen((open) => !open);
        return;
      }
      if (event.key === 'Escape') {
        setQuickSwitcherOpen(false);
        setSettingsOpen(false);
        return;
      }
      if (quickSwitcherOpen || settingsOpen) return;
      if (/^[1-9]$/.test(event.key)) {
        const target = tabs[Number(event.key) - 1];
        if (target) navigate(target.id);
      }
    }
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, [tabs, quickSwitcherOpen, settingsOpen]);

  if (error) {
    return (
      <main className="app app--error">
        <ErrorCard path={error.path} message={error.message} issues={error.issues} />
      </main>
    );
  }

  if (!config) {
    return (
      <main className="app app--loading">
        <p>Loading workspace…</p>
      </main>
    );
  }

  return (
    <div className="app">
      <OfflineBanner />
      <nav className="tab-strip" aria-label="Panels">
        {tabs.map((tab, index) => {
          const isUnknown = !KNOWN_PANEL_IDS.has(tab.panel);
          const classNames = ['tab'];
          if (tab.id === activeTabId) classNames.push('tab--active');
          if (isUnknown) classNames.push('tab--error');
          return (
            <button
              key={tab.id}
              type="button"
              className={classNames.join(' ')}
              onClick={() => navigate(tab.id)}
              title={index < 9 ? `${tab.label} (${index + 1})` : tab.label}
            >
              {tab.label}
              {isUnknown ? ' ⚠' : ''}
            </button>
          );
        })}
        <button type="button" className="tab tab--settings" onClick={() => setSettingsOpen(true)}>
          Theme
        </button>
      </nav>

      <main className="app__content">
        {tabs.length === 0 && (
          <EmptyState
            message="No tabs configured — config.json's tabs array is empty."
            actionLabel="Add example tabs"
            onAction={() => {
              void save((current) => ({ ...(current ?? config), tabs: DEFAULT_TABS }));
            }}
          />
        )}

        {activeTab && !KNOWN_PANEL_IDS.has(activeTab.panel) && (
          <ErrorCard
            path="config.json"
            message={`Unknown panel id "${activeTab.panel}" for tab "${activeTab.label}"`}
          />
        )}

        {activeTab && activeTab.panel === 'providers' && (
          <Suspense fallback={<p>Loading panel…</p>}>
            <ProvidersPanel />
          </Suspense>
        )}

        {activeTab && activeTab.panel === 'assistant' && (
          <Suspense fallback={<p>Loading panel…</p>}>
            <AssistantPanel />
          </Suspense>
        )}

        {activeTab && activeTab.panel === 'links' && (
          <Suspense fallback={<p>Loading panel…</p>}>
            <LinksPanel />
          </Suspense>
        )}

        {activeTab && activeTab.panel === 'icons' && (
          <Suspense fallback={<p>Loading panel…</p>}>
            <IconsPanel />
          </Suspense>
        )}

        {activeTab && activeTab.panel === 'agents' && (
          <Suspense fallback={<p>Loading panel…</p>}>
            <AgentsPanel />
          </Suspense>
        )}

        {activeTab && activeTab.panel === 'generations' && (
          <Suspense fallback={<p>Loading panel…</p>}>
            <GenerationsPanel />
          </Suspense>
        )}

        {activeTab && activeTab.panel === 'docs' && (
          <Suspense fallback={<p>Loading panel…</p>}>
            <DocsPanel />
          </Suspense>
        )}

        {activeTab && activeTab.panel === 'sprints' && (
          <Suspense fallback={<p>Loading panel…</p>}>
            <SprintsPanel />
          </Suspense>
        )}

        {activeTab && activeTab.panel === 'crons' && (
          <Suspense fallback={<p>Loading panel…</p>}>
            <CronsPanel />
          </Suspense>
        )}

        {activeTab && activeTab.panel === 'skills' && (
          <Suspense fallback={<p>Loading panel…</p>}>
            <SkillsPanel />
          </Suspense>
        )}

        {activeTab && activeTab.panel === 'flows' && (
          <Suspense fallback={<p>Loading panel…</p>}>
            <FlowsPanel />
          </Suspense>
        )}
      </main>

      {quickSwitcherOpen && (
        <QuickSwitcher
          tabs={tabs}
          onSelect={(tabId) => {
            navigate(tabId);
            setQuickSwitcherOpen(false);
          }}
          onClose={() => setQuickSwitcherOpen(false)}
        />
      )}

      {settingsOpen && (
        <SettingsModal
          theme={config.theme}
          onChange={(theme) => {
            void save((current) => ({ ...(current ?? config), theme }));
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
