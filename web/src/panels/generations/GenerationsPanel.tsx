// Generations panel (PLAN.md §8 item 4): filterable CSS-grid gallery +
// hand-rolled <dialog> lightbox. Reads generations.json through the one
// data hook (PLAN.md §12 guardrail 3); thumbnails/video stream through the
// existing GET /api/media route (Phase 5 part 1's work, reused unchanged).
import { useMemo, useState } from 'react';
import { GenerationsFileSchema, type GenerationKind } from '@agent-dashboard/shared';
import { EmptyState } from '../../components/EmptyState';
import { ErrorCard } from '../../components/ErrorCard';
import { useWorkspaceFile } from '../../hooks/useWorkspaceFile';
import { GenerationCard } from './GenerationCard';
import { Lightbox } from './Lightbox';

type KindFilter = 'all' | GenerationKind;

export default function GenerationsPanel() {
  const { data, error, loading } = useWorkspaceFile('generations.json', GenerationsFileSchema);
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const item of data?.items ?? []) {
      for (const tag of item.tags) set.add(tag);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [data]);

  const filtered = useMemo(() => {
    return (data?.items ?? []).filter((item) => {
      if (kindFilter !== 'all' && item.kind !== kindFilter) return false;
      if (activeTags.size > 0 && !item.tags.some((tag) => activeTags.has(tag))) return false;
      return true;
    });
  }, [data, kindFilter, activeTags]);

  if (error) {
    return <ErrorCard path={error.path} message={error.message} issues={error.issues} />;
  }
  if (loading && !data) {
    return <p>Loading generations…</p>;
  }
  if (!data) {
    return null;
  }
  if (data.items.length === 0) {
    return <EmptyState message="No generations yet — generations.json's items array is empty." />;
  }

  function toggleTag(tag: string) {
    setActiveTags((current) => {
      const next = new Set(current);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }

  const hasFilters = kindFilter !== 'all' || activeTags.size > 0;
  const openItem = data.items.find((item) => item.id === openId) ?? null;

  return (
    <div className="generations-panel">
      <div className="generations-panel__filters">
        <div className="generations-panel__kind-filter">
          {(['all', 'image', 'video'] as KindFilter[]).map((kind) => (
            <button
              key={kind}
              type="button"
              className={`filter-pill${kindFilter === kind ? ' filter-pill--active' : ''}`}
              onClick={() => setKindFilter(kind)}
            >
              {kind === 'all' ? 'All' : kind === 'image' ? 'Images' : 'Videos'}
            </button>
          ))}
        </div>
        {allTags.length > 0 && (
          <div className="generations-panel__tag-filter">
            {allTags.map((tag) => (
              <button
                key={tag}
                type="button"
                className={`filter-pill filter-pill--tag${activeTags.has(tag) ? ' filter-pill--active' : ''}`}
                onClick={() => toggleTag(tag)}
              >
                {tag}
              </button>
            ))}
          </div>
        )}
        {hasFilters && (
          <button
            type="button"
            className="generations-panel__clear-filters"
            onClick={() => {
              setKindFilter('all');
              setActiveTags(new Set());
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState message="No generations match the current filters." />
      ) : (
        <div className="generations-panel__grid">
          {filtered.map((item) => (
            <GenerationCard key={item.id} item={item} onOpen={() => setOpenId(item.id)} />
          ))}
        </div>
      )}

      <Lightbox item={openItem} onClose={() => setOpenId(null)} />
    </div>
  );
}
