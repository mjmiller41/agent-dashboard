// Hand-rolled lightbox using the native <dialog> element (PLAN.md §8 item 4
// — explicitly "no new dependency"). Controlled by `item`: null closes it,
// a GenerationItem opens it. Backdrop click and Escape both close (Escape
// is native <dialog> behavior; backdrop click is the standard "click
// landed on the dialog element itself, not its content" trick).
import { useEffect, useRef } from 'react';
import type { GenerationItem } from '@agent-dashboard/shared';
import { mediaSrc } from './media';

export interface LightboxProps {
  item: GenerationItem | null;
  onClose: () => void;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function Lightbox({ item, onClose }: LightboxProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (item && !dialog.open) {
      dialog.showModal();
    } else if (!item && dialog.open) {
      dialog.close();
    }
  }, [item]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    function handleClose() {
      onClose();
    }
    dialog.addEventListener('close', handleClose);
    return () => dialog.removeEventListener('close', handleClose);
  }, [onClose]);

  const src = item ? mediaSrc(item) : undefined;

  return (
    <dialog
      ref={dialogRef}
      className="lightbox"
      onClick={(event) => {
        if (event.target === dialogRef.current) dialogRef.current?.close();
      }}
    >
      {item && (
        <div className="lightbox__content">
          <button type="button" className="lightbox__close" onClick={() => dialogRef.current?.close()}>
            × Close
          </button>
          <div className="lightbox__media">
            {src ? (
              item.kind === 'video' ? (
                <video src={src} controls autoPlay />
              ) : (
                <img src={src} alt={item.prompt ?? item.id} />
              )
            ) : (
              <div className="generation-card__media-missing">no media</div>
            )}
          </div>
          <dl className="lightbox__meta">
            {item.prompt && (
              <>
                <dt>Prompt</dt>
                <dd>{item.prompt}</dd>
              </>
            )}
            {item.model && (
              <>
                <dt>Model</dt>
                <dd>{item.model}</dd>
              </>
            )}
            <dt>Created</dt>
            <dd>{formatDate(item.createdAt)}</dd>
            {item.tags.length > 0 && (
              <>
                <dt>Tags</dt>
                <dd>{item.tags.join(', ')}</dd>
              </>
            )}
          </dl>
        </div>
      )}
    </dialog>
  );
}
