import { Hono } from 'hono';
import { createChatRoutes } from './routes/chat.ts';
import { createEventsRoutes } from './routes/events.ts';
import { createProvidersRoutes } from './routes/providers.ts';
import { createWsRoutes } from './routes/ws.ts';
import { chatHistoryStore, credentialStore, settingsStore } from './providers-instance.ts';
import { watcher, workspace } from './workspace-instance.ts';

// Phase 1 adds /api/ws/* and /api/events, Phase 3 adds /api/providers/*,
// Phase 4 adds /api/chat (PLAN.md §5). Later phases add /api/media,
// /api/scan/skills.
export const app = new Hono();

app.get('/api/health', (c) => c.json({ status: 'ok' }));
app.route('/api/ws', createWsRoutes(workspace));
app.route('/api/events', createEventsRoutes(watcher));
app.route('/api/providers', createProvidersRoutes(credentialStore, settingsStore, watcher));
app.route('/api/chat', createChatRoutes(credentialStore, workspace, chatHistoryStore));
