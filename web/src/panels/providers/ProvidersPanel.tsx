// Providers wizard panel (PLAN.md §6 "Provider setup UX"): a grid of
// provider cards; click one to open the connect/test/disconnect drawer.
// Default export so React.lazy(() => import('./ProvidersPanel')) works
// (App.tsx wires panelId 'providers' to this, replacing PlaceholderPanel).
import { useState } from 'react';
import { EmptyState } from '../../components/EmptyState';
import { ErrorCard } from '../../components/ErrorCard';
import { ProviderCard } from './ProviderCard';
import { ProviderDrawer } from './ProviderDrawer';
import { useProviders } from './useProviders';

export default function ProvidersPanel() {
  const { providers, error, loading, refetch } = useProviders();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (error) {
    return <ErrorCard path="/api/providers" message={error} />;
  }

  if (loading && !providers) {
    return <p>Loading providers…</p>;
  }

  if (!providers || providers.length === 0) {
    return <EmptyState message="No providers registered." />;
  }

  const selected = providers.find((p) => p.id === selectedId) ?? null;

  return (
    <div className="providers-panel">
      <p className="providers-panel__intro">
        Connect an LLM provider to power the Assistant panel. OAuth where supported, API key everywhere else —
        stored encrypted outside the workspace.
      </p>
      <div className="providers-panel__grid">
        {providers.map((provider) => (
          <ProviderCard key={provider.id} provider={provider} onClick={() => setSelectedId(provider.id)} />
        ))}
      </div>
      {selected && (
        <ProviderDrawer
          key={selected.id}
          provider={selected}
          onClose={() => setSelectedId(null)}
          onChanged={refetch}
        />
      )}
    </div>
  );
}
