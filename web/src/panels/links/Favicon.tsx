// Favicon with a hand-rolled CSS/SVG glyph fallback (PLAN.md §8 item 1:
// "favicons from icons.duckduckgo.com... with an onerror fallback glyph" —
// no new dependency, a plain inline <svg>).
import { useState } from 'react';

export interface FaviconProps {
  url: string;
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export function Favicon({ url }: FaviconProps) {
  const [failed, setFailed] = useState(false);
  const host = hostnameOf(url);

  if (!host || failed) {
    return (
      <span className="link-card__favicon link-card__favicon--fallback" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none">
          <path
            d="M6.5 9.5l3-3M5 11a3 3 0 010-4.24l1-1a3 3 0 014.24 4.24M11 5a3 3 0 010 4.24l-1 1a3 3 0 01-4.24-4.24"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
      </span>
    );
  }

  return (
    <img
      className="link-card__favicon"
      src={`https://icons.duckduckgo.com/ip3/${host}.ico`}
      alt=""
      width={16}
      height={16}
      onError={() => setFailed(true)}
    />
  );
}
