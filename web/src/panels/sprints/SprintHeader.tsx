// Sprint header (PLAN.md §8 item 6): name, date range, done-count progress
// bar — from SprintInfoSchema's fields plus a derived done/total count.
import type { SprintInfo } from '@agent-dashboard/shared';

export interface SprintHeaderProps {
  info: SprintInfo;
  doneCount: number;
  totalCount: number;
}

function formatDate(iso: string): string {
  const parsed = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function SprintHeader({ info, doneCount, totalCount }: SprintHeaderProps) {
  const percent = totalCount === 0 ? 0 : Math.round((doneCount / totalCount) * 100);

  return (
    <div className="sprint-header">
      <div className="sprint-header__title-row">
        <h2 className="sprint-header__name">{info.name}</h2>
        <span className="sprint-header__dates">
          {formatDate(info.startsOn)} – {formatDate(info.endsOn)}
        </span>
      </div>
      <div className="sprint-header__progress">
        <div
          className="sprint-header__progress-bar"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="sprint-header__progress-fill" style={{ width: `${percent}%` }} />
        </div>
        <span className="sprint-header__progress-label">
          {doneCount}/{totalCount} done ({percent}%)
        </span>
      </div>
    </div>
  );
}
