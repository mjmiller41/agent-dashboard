// List view (PLAN.md §8 item 7): name, human-readable schedule, next 3
// occurrences, lastRun, enabled toggle. Invalid schedules get a warning
// badge instead of next-occurrence times.
import { format } from 'date-fns';
import type { CronJob } from '@agent-dashboard/shared';
import { describeCronSchedule } from './describeCron';
import { nextOccurrences, tryParseCron } from './cronOccurrences';

export interface CronListProps {
  jobs: CronJob[];
  onToggle: (jobId: string, enabled: boolean) => void;
}

export function CronList({ jobs, onToggle }: CronListProps) {
  return (
    <ul className="cron-list">
      {jobs.map((job) => {
        const valid = tryParseCron(job.schedule) !== null;
        const upcoming = valid ? nextOccurrences(job.schedule, 3) : [];
        return (
          <li key={job.id} className="cron-row" data-cron-id={job.id}>
            <div className="cron-row__main">
              <label className="cron-row__toggle">
                <input
                  type="checkbox"
                  checked={job.enabled}
                  onChange={(event) => onToggle(job.id, event.target.checked)}
                />
              </label>
              <div className="cron-row__body">
                <div className="cron-row__name-line">
                  <span className="cron-row__name">{job.name}</span>
                  {!valid && (
                    <span className="cron-row__badge cron-row__badge--invalid">⚠ invalid schedule</span>
                  )}
                  {!job.enabled && (
                    <span className="cron-row__badge cron-row__badge--disabled">disabled</span>
                  )}
                </div>
                <p className="cron-row__schedule">
                  <code>{job.schedule}</code> —{' '}
                  {valid ? describeCronSchedule(job.schedule) : 'could not be parsed'}
                </p>
                {(job.command ?? job.agentId ?? job.notes) && (
                  <p className="cron-row__meta">
                    {job.command && <code className="cron-row__command">{job.command}</code>}
                    {job.agentId && <span className="cron-row__agent">agent: {job.agentId}</span>}
                    {job.notes && <span className="cron-row__notes">{job.notes}</span>}
                  </p>
                )}
              </div>
            </div>
            <div className="cron-row__times">
              <div className="cron-row__next">
                <span className="cron-row__label">Next</span>
                {valid ? (
                  <ul>
                    {upcoming.map((date) => (
                      <li key={date.toISOString()}>{format(date, 'MMM d, HH:mm')}</li>
                    ))}
                  </ul>
                ) : (
                  <span className="cron-row__dash">—</span>
                )}
              </div>
              <div className="cron-row__last">
                <span className="cron-row__label">Last run</span>
                <span>{job.lastRun ? format(new Date(job.lastRun), 'MMM d, HH:mm') : 'never'}</span>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
