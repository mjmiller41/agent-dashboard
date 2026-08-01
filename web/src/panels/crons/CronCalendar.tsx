// Month calendar (PLAN.md §8 item 7): date-fns grid, dots + hover popover.
// Only schedules that parse successfully are plotted — invalid ones are
// excluded per the item's own instruction.
import { useMemo, useState } from 'react';
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns';
import type { CronJob } from '@agent-dashboard/shared';
import { hasOccurrenceOnDay, occurrencesOnDay, tryParseCron } from './cronOccurrences';

export interface CronCalendarProps {
  jobs: CronJob[];
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function CronCalendar({ jobs }: CronCalendarProps) {
  const [monthCursor, setMonthCursor] = useState(() => startOfMonth(new Date()));
  const [hoveredDay, setHoveredDay] = useState<string | null>(null);

  const validJobs = useMemo(() => jobs.filter((job) => tryParseCron(job.schedule) !== null), [jobs]);

  const days = useMemo(() => {
    const gridStart = startOfWeek(startOfMonth(monthCursor));
    const gridEnd = endOfWeek(endOfMonth(monthCursor));
    return eachDayOfInterval({ start: gridStart, end: gridEnd });
  }, [monthCursor]);

  return (
    <div className="cron-calendar">
      <div className="cron-calendar__header">
        <button
          type="button"
          onClick={() => setMonthCursor((m) => subMonths(m, 1))}
          aria-label="Previous month"
        >
          ‹
        </button>
        <span className="cron-calendar__month-label">{format(monthCursor, 'MMMM yyyy')}</span>
        <button type="button" onClick={() => setMonthCursor((m) => addMonths(m, 1))} aria-label="Next month">
          ›
        </button>
      </div>

      <div className="cron-calendar__weekdays">
        {WEEKDAY_LABELS.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>

      <div className="cron-calendar__grid">
        {days.map((day) => {
          const dayKey = format(day, 'yyyy-MM-dd');
          const dayJobs = validJobs.filter((job) => hasOccurrenceOnDay(job.schedule, day));
          const inMonth = isSameMonth(day, monthCursor);
          return (
            <div
              key={dayKey}
              className={[
                'cron-calendar__day',
                !inMonth ? 'cron-calendar__day--outside' : '',
                isToday(day) ? 'cron-calendar__day--today' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onMouseEnter={() => dayJobs.length > 0 && setHoveredDay(dayKey)}
              onMouseLeave={() => setHoveredDay((current) => (current === dayKey ? null : current))}
            >
              <span className="cron-calendar__day-number">{format(day, 'd')}</span>
              {dayJobs.length > 0 && (
                <div className="cron-calendar__dots">
                  {dayJobs.slice(0, 4).map((job) => (
                    <span key={job.id} className="cron-calendar__dot" title={job.name} />
                  ))}
                </div>
              )}
              {hoveredDay === dayKey && dayJobs.length > 0 && (
                <div className="cron-calendar__popover" data-testid="cron-day-popover">
                  <p className="cron-calendar__popover-date">{format(day, 'MMM d, yyyy')}</p>
                  <ul>
                    {dayJobs.map((job) => (
                      <li key={job.id}>
                        <strong>{job.name}</strong>
                        <span>
                          {occurrencesOnDay(job.schedule, day)
                            .slice(0, 6)
                            .map((d) => format(d, 'HH:mm'))
                            .join(', ')}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
