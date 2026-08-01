import { serve } from '@hono/node-server';
import { app } from './app.ts';
import { initWorkspace, workspace } from './workspace-instance.ts';

const HOST = '127.0.0.1';
const PORT = 4680;

const seeded = await initWorkspace();

serve({ fetch: app.fetch, hostname: HOST, port: PORT }, (info) => {
  const url = `http://${HOST}:${info.port}`;
  // PLAN.md §10: "First-run: if ./workspace missing, server copies
  // workspace.example/ and logs a welcome message with the URL."
  if (seeded) {
    console.log('');
    console.log('Welcome to Agent Dashboard!');
    console.log(`A starter workspace was created at ${workspace.root}`);
    console.log(`Open ${url} to get started.`);
    console.log('See AGENTS.md if you plan to point a coding agent at this workspace.');
    console.log('');
  }
  console.log(`agent-dashboard server listening on ${url}`);
});
