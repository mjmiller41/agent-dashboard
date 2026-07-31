import { Hono } from 'hono';

// Phase 0: an empty app with just the health route. Later phases add
// /api/ws/*, /api/events, /api/providers/*, /api/chat, /api/media,
// /api/scan/skills (see PLAN.md §5).
export const app = new Hono();

app.get('/api/health', (c) => c.json({ status: 'ok' }));
