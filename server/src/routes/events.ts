// GET /api/events — SSE stream of workspace change events (PLAN.md §5).
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { WorkspaceWatcher } from '../watch.ts';

const KEEPALIVE_MS = 20_000;

export function createEventsRoutes(watcher: WorkspaceWatcher): Hono {
  const routes = new Hono();

  routes.get('/', (c) => {
    return streamSSE(c, async (stream) => {
      let closed = false;
      stream.onAbort(() => {
        closed = true;
      });

      const unsubscribe = watcher.subscribe((event) => {
        void stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
      });

      try {
        // Keep the connection alive with periodic comments until the client disconnects.
        while (!closed) {
          await stream.sleep(KEEPALIVE_MS);
          if (closed) break;
          await stream.writeSSE({ event: 'ping', data: '{}' });
        }
      } finally {
        unsubscribe();
      }
    });
  });

  return routes;
}
