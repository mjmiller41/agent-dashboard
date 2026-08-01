// System prompt for POST /api/chat (PLAN.md §6 "Assistant panel": "embed a
// compact version of SCHEMAS.md and the rule 'you are operating on the
// user's live dashboard files'"). SCHEMAS.md itself doesn't exist yet — its
// generation pipeline is explicitly Phase 6 scope (PLAN.md §11) — so this is
// a small hand-maintained summary of the workspace file shapes from PLAN.md
// §4, kept short enough to not bloat every request. Update it if a workspace
// schema's shape changes.
const WORKSPACE_SCHEMA_SUMMARY = `Workspace files you can read/write (all paths are relative to the workspace root):
- config.json: { title, theme: {preset, accent}, tabs: [{id, panel, label, icon}] }
- agents.json: { agents: [{ id, name, role, iconId, status: 'active'|'idle'|'blocked'|'offline', currentTask?, lastUpdated (ISO datetime), provider?, notes? }] }
- sprints.json: { current: {name, startsOn, endsOn}, tasks: [{ id, title, status: 'backlog'|'todo'|'doing'|'done', assigneeId?, notes?, order }] }
- flows/<slug>.json: { id, name, description?, steps: [{id, label, agentId?, status: 'pending'|'running'|'done'|'failed'|'skipped', startedAt?, finishedAt?, notes?}], edges: [{from, to}], runs?: [...] }
- skills.json: { nodes: [{id, label, category, description?, source?}], edges: [{from, to}], scannedAt? }
- crons.json: { jobs: [{id, name, schedule (5-field cron), command?, agentId?, enabled, lastRun?, notes?}] }
- generations.json: { items: [{id, createdAt, kind: 'image'|'video', prompt?, model?, path?, url?, tags: []}] }
- links.json: { groups: [{id, title, links: [{title, url, note?}]}] }
- docs/**/*.md: free-form Markdown
- icons/*.svg: avatar gallery (referenced by agents[].iconId)`;

export function buildSystemPrompt(workspaceToolsEnabled: boolean): string {
  const base = [
    'You are the built-in Assistant for Agent Dashboard, a self-hosted command centre for AI agents.',
    "You are operating on the user's live dashboard files — changes you make take effect immediately and are visible in the UI.",
    'Be concise. Prefer taking the requested action over describing how you would take it.',
    '',
    WORKSPACE_SCHEMA_SUMMARY,
  ];

  if (workspaceToolsEnabled) {
    base.push(
      '',
      'You have tools to read, list, and write workspace files, plus two convenience tools ' +
        '(update_sprint_task, update_agent_status) for single-field edits. Always read a JSON file ' +
        'before writing it back with write_workspace_file so you do not drop existing fields — a ' +
        'partial document will fail schema validation. Prefer update_sprint_task / ' +
        'update_agent_status over write_workspace_file when only one field is changing.',
    );
  } else {
    base.push(
      '',
      'Workspace tools are disabled for this conversation — you can only discuss, not edit, files.',
    );
  }

  return base.join('\n');
}
