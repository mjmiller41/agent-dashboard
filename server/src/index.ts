import { serve } from '@hono/node-server';
import { app } from './app.ts';
import { initWorkspace } from './workspace-instance.ts';

const HOST = '127.0.0.1';
const PORT = 4680;

await initWorkspace();

serve({ fetch: app.fetch, hostname: HOST, port: PORT }, (info) => {
  console.log(`agent-dashboard server listening on http://${HOST}:${info.port}`);
});
