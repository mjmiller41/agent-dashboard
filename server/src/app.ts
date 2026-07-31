import { Hono } from 'hono';
import { createEventsRoutes } from './routes/events.ts';
import { createWsRoutes } from './routes/ws.ts';
import { watcher, workspace } from './workspace-instance.ts';

// Phase 1 adds /api/ws/* and /api/events (PLAN.md §5). Later phases add
// /api/providers/*, /api/chat, /api/media, /api/scan/skills.
export const app = new Hono();

app.get('/api/health', (c) => c.json({ status: 'ok' }));
app.route('/api/ws', createWsRoutes(workspace));
app.route('/api/events', createEventsRoutes(watcher));
