# Agent instructions

This repo is a self-hosted, file-first dashboard for coordinating AI agents (PLAN.md §1). If
you're a coding agent (Claude Code, Codex, Gemini CLI, etc.) working in a project that has this
dashboard pointed at it — or working _on_ this repo itself and asked to act like one of its own
agents — read this file first.

## Where the workspace lives

All dashboard state is plain JSON/Markdown files under `./workspace/` (overridable via the
`WORKSPACE_DIR` environment variable). The dashboard's web UI and its server both treat these
files as the single source of truth: editing one on disk updates the running UI within ~200ms via
a file-watcher + Server-Sent Events, no dashboard-side action required. There is no database —
the workspace directory _is_ the database.

```
workspace/
├── config.json        # dashboard shell config (title, theme, tabs, skill scan roots)
├── agents.json         # agent roster (this is probably the file you update most)
├── flows/<slug>.json   # one file per flow DAG, with optional recorded playback runs
├── skills.json         # skill-tree graph (nodes + edges)
├── crons.json          # cron job list (display-only, nothing here actually runs)
├── generations.json    # image/video gallery metadata
├── docs/**/*.md         # free-form Markdown, shown in the Docs panel
├── links.json           # bookmark groups
├── sprints.json         # current sprint + kanban tasks
├── icons/*.svg          # avatar gallery
└── media/               # generation thumbnails/video files, served via /api/media
```

**Full field-by-field contracts, with a real example for every file type, are in
[`SCHEMAS.md`](./SCHEMAS.md)** — read it before writing to any of these files for the first time.
`SCHEMAS.md` is generated directly from the zod schemas in `shared/src/schemas/*.ts`, so it's
always in sync with what the server will actually accept.

## Behavioral rules

1. **Validate before you write.** Every JSON file is checked against its schema on write (see
   `SCHEMAS.md` / `shared/src/schemas/`); a write that doesn't match the shape is rejected. If
   you're writing through the dashboard's own HTTP API (`PUT /api/ws/file?path=...`) you'll get a
   4xx with the zod issue list back — read it and fix the payload, don't retry blindly. If you're
   editing the file directly on disk, make sure your JSON matches `SCHEMAS.md` before saving.
2. **Update your `agents.json` entry when you start and finish a task.** Set `status: "active"`
   and `currentTask` to a short human-readable description when you start working, set
   `status: "idle"` (or `"blocked"` if you're stuck) and clear/update `currentTask` when you
   finish or pause, and always bump `lastUpdated` to the current ISO timestamp. This is the
   dashboard's main "what are my agents doing right now" signal — stale status is worse than no
   status.
3. **Append flow run events, don't rewrite history.** If you're executing (or simulating) a flow
   described in `flows/<slug>.json`, add events to that flow's `runs[].events` array as they
   happen (`{stepId, status, at}`) rather than replacing prior runs. The Flows panel's playback
   view depends on runs being a genuine append-only timeline.
4. **Pull sprint tasks by editing `status`, not by asking anyone.** `sprints.json`'s `tasks` array
   is the literal kanban board — moving a task from `todo` to `doing` (and eventually `done`) is
   just editing that task's `status` field (and `order`, if you care where it lands in the
   column) directly in the file. Set `assigneeId` to your own agent id in `agents.json` if you're
   the one picking it up.
5. **Never touch `~/.agent-dashboard/`.** That directory (or wherever `AGENT_DASHBOARD_HOME` points)
   holds the dashboard _application's_ own data — encrypted provider credentials, app settings,
   and chat history — not workspace data. It is not part of the file-first contract described
   above, agents have no reason to read or write anything there, and doing so risks corrupting
   credentials or leaking secrets into your own context. If a task seems to require it, stop and
   ask a human instead.
6. **Stay inside the workspace root.** The server rejects any path that escapes `./workspace/`
   (absolute paths, `..` traversal, symlink escapes) — don't try to work around this from the
   filesystem side either; treat the workspace root as your entire writable surface for dashboard
   state.
7. **If a file fails to parse or validate, don't silently drop data trying to "fix" it.** Report
   the issue (the zod issue list, if you have it) rather than guessing at a shape and overwriting
   good data with a malformed patch.

## Assistant tool-calling (if you're driving the dashboard's own chat)

The built-in Assistant panel (`POST /api/chat` with `workspaceTools: true`) exposes five
workspace tools to a connected LLM: `read_workspace_file`, `write_workspace_file`,
`list_workspace`, `update_sprint_task`, `update_agent_status`. These wrap the exact same guarded,
schema-validating `workspace.ts` every other write path uses — the same rules above apply whether
you're an external coding agent editing files on disk or a model calling these tools through the
dashboard's own chat.
