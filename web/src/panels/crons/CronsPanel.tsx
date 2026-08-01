// Crons panel (PLAN.md §8 item 7): list view + month calendar over
// crons.json, read/written through the one data hook (PLAN.md §12
// guardrail 3). cron-parser computes next-occurrence times; date-fns drives
// the calendar grid.
import { CronsFileSchema } from '@agent-dashboard/shared';
import { EmptyState } from '../../components/EmptyState';
import { ErrorCard } from '../../components/ErrorCard';
import { useWorkspaceFile } from '../../hooks/useWorkspaceFile';
import { CronCalendar } from './CronCalendar';
import { CronList } from './CronList';

export default function CronsPanel() {
  const { data, error, loading, save } = useWorkspaceFile('crons.json', CronsFileSchema);

  if (error) {
    return <ErrorCard path={error.path} message={error.message} issues={error.issues} />;
  }
  if (loading && !data) {
    return <p>Loading crons…</p>;
  }
  if (!data) {
    return null;
  }
  if (data.jobs.length === 0) {
    return <EmptyState message="No cron jobs yet — crons.json's jobs array is empty." />;
  }

  async function toggle(jobId: string, enabled: boolean) {
    await save((current) => ({
      jobs: (current?.jobs ?? []).map((job) => (job.id === jobId ? { ...job, enabled } : job)),
    }));
  }

  return (
    <div className="crons-panel">
      <CronList jobs={data.jobs} onToggle={(id, enabled) => void toggle(id, enabled)} />
      <CronCalendar jobs={data.jobs} />
    </div>
  );
}
