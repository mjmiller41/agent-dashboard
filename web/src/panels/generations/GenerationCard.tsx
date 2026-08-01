// One gallery tile (PLAN.md §8 item 4): image or video thumbnail, kind
// badge, tag chips. Clicking opens the lightbox.
import type { GenerationItem } from '@agent-dashboard/shared';
import { mediaSrc } from './media';

export interface GenerationCardProps {
  item: GenerationItem;
  onOpen: () => void;
}

export function GenerationCard({ item, onOpen }: GenerationCardProps) {
  const src = mediaSrc(item);

  return (
    <button type="button" className="generation-card" data-generation-id={item.id} onClick={onOpen}>
      <div className="generation-card__media">
        {src ? (
          item.kind === 'video' ? (
            <video src={src} muted playsInline preload="metadata" />
          ) : (
            <img src={src} alt={item.prompt ?? item.id} loading="lazy" />
          )
        ) : (
          <div className="generation-card__media-missing">no media</div>
        )}
        <span className={`generation-card__kind generation-card__kind--${item.kind}`}>{item.kind}</span>
      </div>
      {item.prompt && <p className="generation-card__prompt">{item.prompt}</p>}
      {item.tags.length > 0 && (
        <div className="generation-card__tags">
          {item.tags.map((tag) => (
            <span key={tag} className="generation-card__tag">
              {tag}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}
