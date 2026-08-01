# Agent Dashboard

A self-hosted, installable **command centre for AI agents** — feature parity with
[getrubric.app](https://www.getrubric.app/), plus a provider-connection system Rubric doesn't
have.

Two ideas drive the whole design:

1. **File-first workspace.** Every piece of dashboard state (agents, flows, sprints, docs, links,
   crons, generations, a skill graph) lives as plain JSON/Markdown files in a `workspace/`
   directory. Coding agents (Claude Code, Codex, Gemini CLI, etc.) edit those files directly —
   the dashboard watches the directory and updates live. The UI can edit everything too, writing
   back to the same files. There's no database.
2. **Bring-your-own agent provider.** A setup wizard connects Anthropic, OpenAI, Google, GitHub
   Copilot, OpenRouter, Ollama, or any OpenAI-compatible endpoint, via OAuth where supported or an
   API key, and powers a built-in Assistant chat panel that can read and write your workspace
   through tool calls ("mark task X done" actually edits `sprints.json`).

**Non-goals:** multi-user auth, cloud sync, actually running/scheduling cron jobs, remote
deployment. This is a local, single-user tool bound to `127.0.0.1`. See `PLAN.md` §1 for the full
scope statement.

## Quickstart

```bash
npm install
npm run build
npm start
```

Then open **http://localhost:4680**. Chrome (and most Chromium-based browsers) will offer to
install it as an app — it's a full PWA: offline-capable app shell, installable icon, works from a
desktop/dock shortcut like a native app.

On first run, the server copies `workspace.example/` (realistic demo data — a few agents, flows
with recorded runs, a sprint board, etc.) to `./workspace/` and prints a welcome message with the
URL. Everything after that reads/writes `./workspace/` directly — point your coding agent's
working directory there (or hand it the install prompt below) and it can start editing the same
files the dashboard is watching.

### Local development

```bash
npm install
npm run dev      # Hono server on :4680 + Vite dev server on :5173, proxying /api
```

```bash
npm run check    # typecheck + lint + format check + unit tests, all workspaces
npm run e2e      # Playwright suite (chromium)
```

## Give your coding agent this

Copy-paste this into your coding agent's system prompt, project instructions, or first message to
wire it into this dashboard's workspace conventions:

> This project has an Agent Dashboard running at `http://localhost:4680`, backed by a file-first
> workspace at `./workspace/` (or wherever `WORKSPACE_DIR` points). Read `AGENTS.md` at the repo
> root for the full workspace file layout, schema contracts (`SCHEMAS.md`), and behavioral rules.
> In short: update your entry in `agents.json` (`status`, `currentTask`, `lastUpdated`) when you
> start and finish work, append events to a flow's `runs` array rather than rewriting history,
> move sprint tasks by editing their `status`/`order` in `sprints.json`, validate any JSON you
> write against the schema described in `SCHEMAS.md`, and never read or write
> `~/.agent-dashboard/` — that directory is the dashboard application's own credentials/settings/
> chat-history store, not workspace data.

(This block is deliberately just the `AGENTS.md` summary in prose form — the source of truth for
the rules is `AGENTS.md` itself; keep both in sync if you change one.)

## Connecting a provider

Open the **Providers** tab and pick a card. Each provider supports API-key setup (paste a key,
"Test & Save") and, where available, one-click OAuth sign-in. First-party OAuth flows (Anthropic,
OpenAI, Google) reuse each vendor's own CLI tool's OAuth client rather than an officially
sanctioned third-party integration — the wizard shows a one-time consent screen explaining exactly
that before you connect one, and API-key setup is always available as the supported alternative.

> **Screenshots:** _placeholder — add a screenshot of the Providers grid and a connected-provider
> drawer here once the UI is stable enough to be worth capturing. Not fabricated for this
> README; genuinely still to do._

Once a provider is connected, open the **Assistant** tab, pick it and a model, and start chatting.
With workspace tools enabled, the assistant can read and write your workspace files directly —
"move all doing tasks assigned to researcher back to todo" round-trips through the same
`sprints.json` file an external coding agent or the Sprints panel's drag-and-drop would touch.

## Security notes

- The server binds **`127.0.0.1` only** — nothing here is exposed to your network, and there's no
  authentication layer because there's nothing to authenticate against beyond your own machine.
  This is explicitly a single-user local tool (PLAN.md §1's non-goals) — do not put it behind a
  reverse proxy and expose it to the internet without adding your own auth in front of it first.
- Provider credentials (API keys, OAuth tokens) are stored in `~/.agent-dashboard/credentials.json`
  (or `$AGENT_DASHBOARD_HOME/credentials.json`), encrypted at rest with AES-256-GCM using a key
  derived from a machine-local secret file (`~/.agent-dashboard/keyfile`, mode `0600`, generated on
  first run). Both files are also mode `0600`. This is **obfuscation plus file permissions, not
  perfect secrecy** — anyone with read access to your user account (or root) can decrypt these
  credentials; it protects against casual disk/backup exposure, not a compromised local account.
  If that's not an acceptable threat model for a given provider, don't connect it here.
- No credential or secret is ever written into `./workspace/`, returned in an API response, logged,
  or sent over SSE — `GET /api/providers` only ever exposes a masked key (`sk-…abc`) and connection
  metadata. Chat history is persisted to `~/.agent-dashboard/chats/` (last 20 conversations), also
  outside the workspace, since it can contain whatever the model and you discussed.
- First-party OAuth flows (Anthropic/OpenAI/Google) reuse each vendor's own CLI's OAuth client
  rather than a first-class sanctioned integration; this can violate a provider's terms of service
  and, per Google's own public statements, Google in particular may detect and restrict this
  pattern. The consent modal shown before connecting any of these three says so explicitly. If
  you'd rather not take that risk, use API-key setup instead — it's equally supported for every
  provider.

## Repository layout

See `PLAN.md` §3 for the full annotated layout; the short version:

- `shared/` — zod schemas + TS types for every workspace document type (source of truth for
  `SCHEMAS.md`).
- `server/` — Hono server (`127.0.0.1:4680`): workspace file API, SSE change feed, provider/OAuth
  system, streaming chat, and (in production) static serving of `web/dist`.
- `web/` — React + Vite frontend: the panel shell, all 11 panels, the PWA manifest/service worker.
- `workspace.example/` — the demo workspace copied to `./workspace/` on first run.
- `e2e/` — Playwright specs (dev-mode panel smoke tests + a production-build PWA spec).

## Further reading

- `PLAN.md` — the original implementation plan (tech stack, API surface, phase-by-phase
  acceptance criteria).
- `DECISIONS.md` — a running log of every deviation from the plan and implementation choice made
  along the way, organized by phase.
- `AGENTS.md` — workspace conventions for coding agents (see above).
- `SCHEMAS.md` — generated field-by-field reference for every workspace file type.
