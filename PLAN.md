# Agent Dashboard — Implementation Plan

> **Audience:** This plan is written for a `claude-sonnet-5` implementation agent.
> Follow it phase by phase. Each phase has explicit deliverables and acceptance
> criteria — do not start a later phase until the current phase's acceptance
> criteria pass. Guardrails for staying on track are in §12; read them first.

## 1. What we are building

A self-hosted, installable-PWA "command centre for AI agents" — feature parity with
[getrubric.app](https://www.getrubric.app/), plus a provider-connection system Rubric
doesn't have. Two big ideas:

1. **File-first workspace.** All dashboard state (agents, flows, sprints, docs, …)
   lives as JSON/Markdown files in a `workspace/` directory. Coding agents (Claude
   Code, etc.) edit those files directly; the dashboard watches the directory and
   re-renders live. The UI can also edit everything, writing back to the same files.
2. **Bring-your-own agent provider.** A user-friendly setup wizard connects any LLM
   provider via OAuth (where the provider supports it) or API key, stored locally.
   Connected providers power a built-in Assistant panel that can read/write the
   workspace through tool calls.

Ten Rubric-parity panels + two new ones:
**Scaffold** (shell), **Icons**, **Flows**, **Skill Trees**, **Agents**, **Crons**,
**Generations**, **Docs**, **Links**, **Sprints**, plus **Providers** (setup UI) and
**Assistant** (chat that uses a connected provider).

Non-goals (do not build): multi-user auth, cloud sync, running/scheduling actual
cron jobs, remote deployment. This is a local, single-user tool bound to localhost.

## 2. Tech stack (decided — do not substitute)

Open-source libraries where they save real work; hand-roll only what's listed.

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript everywhere (strict) | |
| Server | **Hono** on Node 22+ (`@hono/node-server`) | Tiny, typed routes |
| File watching | **chokidar** | Reliable cross-platform `fs.watch` |
| Schema validation | **zod** (shared package, used by server + web) | One source of truth for workspace file shapes |
| LLM access | **Vercel AI SDK** (`ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`, `@ai-sdk/openai-compatible`) | Uniform streaming + tool-calling across providers |
| Frontend | **React 18 + Vite 6** | Most reliable path for the implementer; bundle stays small |
| PWA | **vite-plugin-pwa** (Workbox, `registerType: 'autoUpdate'`) | Manifest + SW generation |
| State | **zustand** | Minimal global store for workspace data + SSE updates |
| Routing | Hand-rolled hash router (~40 lines) | Not worth a dependency |
| Flows graph | **@xyflow/react** (React Flow) + **@dagrejs/dagre** for auto-layout | DAG rendering, pan/zoom, node interaction |
| Skill graph | **d3-force** + **d3-zoom** (individual d3 modules only, rendered to SVG via React) | Force-directed layout |
| Markdown | **marked** + **DOMPurify** | Docs panel rendering |
| Cron parsing | **cron-parser** | Next-occurrence computation for calendar |
| Kanban DnD | **@dnd-kit/core** + `@dnd-kit/sortable` | Sprints board |
| Dates | **date-fns** | Calendar math |
| Server tests | **vitest** + `supertest`-style via Hono's `app.request()` | |
| E2E | **Playwright** (chromium only) | Panel smoke tests + PWA installability check |

Hand-rolled (deliberately): hash router, SSE client, theme system (CSS custom
properties), OAuth PKCE loopback flow (small, and provider-specific), credential
store. **Do not** add libraries beyond this table without a written note in
`DECISIONS.md` explaining why.

Lightweight budget: production JS ≤ 350 KB gzipped total, code-split so each panel
lazy-loads (`React.lazy`). Vite build must show per-chunk sizes; check at each phase.

## 3. Repository layout

```
agent-dashboard/
├── PLAN.md                  # this file
├── DECISIONS.md             # running log of deviations/choices (implementer maintains)
├── AGENTS.md                # instructions for *external* coding agents using the workspace
├── SCHEMAS.md               # human-readable workspace file contracts (generated from zod)
├── package.json             # npm workspaces: server, web, shared
├── shared/                  # zod schemas + TS types for workspace files
│   └── src/schemas/*.ts     # one file per workspace document type
├── server/
│   └── src/
│       ├── index.ts         # entry: starts Hono on 127.0.0.1:4680
│       ├── workspace.ts     # safe read/write/list inside workspace root (path-traversal guarded)
│       ├── watch.ts         # chokidar → SSE broadcast
│       ├── routes/
│       │   ├── ws.ts        # /api/ws/* CRUD over workspace files
│       │   ├── events.ts    # /api/events SSE
│       │   ├── providers.ts # /api/providers/* (list, connect, oauth callbacks, test)
│       │   ├── chat.ts      # /api/chat streaming assistant endpoint
│       │   ├── media.ts     # /api/media passthrough for generations thumbnails
│       │   └── scan.ts      # /api/scan/skills skill-directory scanner
│       └── providers/
│           ├── registry.ts  # provider descriptors (see §6)
│           ├── credentials.ts # encrypted store in ~/.agent-dashboard/
│           └── oauth.ts     # generic PKCE loopback helper
├── web/
│   ├── vite.config.ts       # proxy /api → :4680, vite-plugin-pwa config
│   └── src/
│       ├── main.tsx  App.tsx  router.ts  store.ts  sse.ts  theme.css
│       ├── components/      # shared UI primitives (Card, Modal, EmptyState, StatusDot…)
│       └── panels/
│           ├── agents/  flows/  skills/  crons/  generations/
│           ├── docs/  links/  sprints/  icons/
│           ├── providers/   # setup wizard
│           └── assistant/   # chat UI
├── workspace.example/       # complete example workspace (copied to ./workspace on first run)
└── e2e/                     # playwright tests
```

Server owns two directories at runtime:
- `./workspace/` (configurable via `WORKSPACE_DIR` env) — the shared agent/UI data.
- `~/.agent-dashboard/` — provider credentials + app settings. **Never** put
  credentials in the workspace; agents read the workspace and secrets must not leak
  into agent context.

## 4. Workspace data model (zod schemas in `shared/`)

Every schema gets: a zod definition, an exported TS type, and an example document in
`workspace.example/`. Parse failures must never crash a panel — surface a per-panel
error card showing the zod issue list and the file path.

- `config.json` — `{ title, theme: {preset, accent}, tabs: [{id, panel, label, icon}] }`.
  Tab order/visibility is user-editable; unknown panel ids render an error tab.
- `agents.json` — `{ agents: [{ id, name, role, iconId, status: 'active'|'idle'|'blocked'|'offline', currentTask?, lastUpdated (ISO), provider?, notes? }] }`
- `flows/<slug>.json` — `{ id, name, description?, steps: [{ id, label, agentId?, status: 'pending'|'running'|'done'|'failed'|'skipped', startedAt?, finishedAt?, notes? }], edges: [{from, to}], runs?: [{ startedAt, events: [{stepId, status, at}] }] }`
  (`runs` powers playback: a recorded timeline that the UI can scrub through.)
- `skills.json` — `{ nodes: [{ id, label, category, description?, source? }], edges: [{from, to}] , scannedAt? }`
- `crons.json` — `{ jobs: [{ id, name, schedule (5-field cron), command?, agentId?, enabled, lastRun?, notes? }] }`
- `generations.json` — `{ items: [{ id, createdAt, kind: 'image'|'video', prompt?, model?, path?, url?, tags: [] }] }` (`path` is workspace-relative, served via `/api/media`)
- `docs/**/*.md` — free Markdown; the panel lists the tree.
- `links.json` — `{ groups: [{ id, title, links: [{ title, url, note? }] }] }`
- `sprints.json` — `{ current: { name, startsOn, endsOn }, tasks: [{ id, title, status: 'backlog'|'todo'|'doing'|'done', assigneeId?, notes?, order }] }`
- `icons/*.svg` — avatar gallery; ship ≥ 24 pixel-art style SVGs in `workspace.example/icons/`
  (generate simple 16×16 grid `<rect>` art in code — do not fetch external assets).

After schemas exist, generate `SCHEMAS.md` from them (a small script that prints each
schema's shape + the example file) so external agents have a stable contract doc.

## 5. Server API

All routes JSON unless noted. Bind `127.0.0.1` only. CORS: same-origin (Vite proxies
in dev).

```
GET    /api/ws/tree                → recursive listing of workspace (paths, mtimes)
GET    /api/ws/file?path=…         → file contents (JSON parsed if .json, raw for .md)
PUT    /api/ws/file?path=…         → write (validates against schema by filename convention)
DELETE /api/ws/file?path=…
GET    /api/events                 → SSE: {type:'ws-change', path} debounced 100ms;
                                     also 'provider-change' events
GET    /api/media?path=…           → streams files under workspace/ only (images/video)
POST   /api/scan/skills           → walks configured skill roots, regenerates skills.json
GET    /api/providers              → registry + connection status (NO secrets in response)
POST   /api/providers/:id/apikey   → save API key {key, baseUrl?}; runs a live test call
POST   /api/providers/:id/oauth/start → begins PKCE flow, returns {authUrl}
GET    /api/providers/oauth/callback  → loopback redirect target
POST   /api/providers/:id/test     → cheap live call ("say ok"), returns latency/model list
DELETE /api/providers/:id          → disconnect + delete stored credential
GET    /api/providers/:id/models   → model list for the picker
POST   /api/chat                   → streaming chat (AI SDK streamText → SSE/data stream),
                                     body: {providerId, model, messages, workspaceTools: bool}
```

`workspace.ts` must resolve every requested path with `path.resolve` and reject
anything escaping the workspace root. Writes are atomic (write temp file, rename).
Echo suppression: when the server itself writes a file, tag the next watcher event so
the originating UI doesn't redundantly refetch (include a `rev` hash in SSE payload).

## 6. Provider system (the new capability — build carefully)

### Registry

`server/src/providers/registry.ts` exports a typed list; the web wizard renders from
it. Each descriptor:

```ts
type ProviderDescriptor = {
  id: string; name: string; logoId: string;
  auth: Array<'oauth-pkce' | 'oauth-device' | 'api-key'>;   // ordered by preference
  apiKey?: { placeholder: string; helpUrl: string; baseUrlConfigurable?: boolean };
  oauth?: OAuthSpec;                        // see §6a — flow variant + endpoints
  firstParty?: boolean;                     // true = reuses a vendor CLI's OAuth client (consent gate, §6a)
  aiSdkFactory: (cred: StoredCredential) => /* AI SDK provider instance or custom adapter */;
  listModels: (cred: StoredCredential) => Promise<ModelInfo[]>;
};
```

Ship these providers in v1 (every provider that has a working OAuth path gets one):

| Provider | Auth | Notes for implementation |
|---|---|---|
| **OpenRouter** | **OAuth PKCE** (official) + API key | The only *officially sanctioned* third-party OAuth: redirect to `https://openrouter.ai/auth?callback_url=<loopback>&code_challenge=…&code_challenge_method=S256`, then POST `https://openrouter.ai/api/v1/auth/keys` with `{code, code_verifier}` → returns a user-scoped API key. Use `@ai-sdk/openai-compatible` with base URL `https://openrouter.ai/api/v1`. Models from `GET /api/v1/models`. Mark "Recommended" in the wizard. |
| **Anthropic (Claude)** | **OAuth — Claude Pro/Max sign-in** + API key | First-party Claude Code flow, code-paste variant. See §6a. Tokens work against the normal Anthropic API via `@ai-sdk/anthropic` with custom headers. |
| **OpenAI (ChatGPT)** | **OAuth — ChatGPT sign-in** + API key | First-party Codex CLI flow (PKCE, fixed loopback port 1455). See §6a. API-key mode uses `@ai-sdk/openai` unchanged. |
| **Google (Gemini)** | **OAuth — Google sign-in** + API key | First-party Gemini CLI flow → Code Assist API. See §6a. API-key mode uses `@ai-sdk/google` (AI Studio key). |
| **GitHub Copilot** | **OAuth — device flow** | Device-code flow; supports the user's own GitHub OAuth App client id (sanctioned) with the known VS Code client id as fallback. See §6a. |
| **Ollama (local)** | none (URL only) | `@ai-sdk/openai-compatible` at `http://localhost:11434/v1`; "connect" = reachability check + model list from `/api/tags`. |
| **Custom OpenAI-compatible** | API key + base URL | Covers Groq, Together, Mistral, LM Studio, etc. |

### 6a. First-party OAuth flows — subscription sign-in (build with care)

**Reality check (verified against current docs/source, 2026):** Anthropic, OpenAI,
and Google do **not** offer public third-party OAuth client registration for their
consumer AI subscriptions. The working flows below reuse each vendor's *first-party
CLI* OAuth client (Claude Code, Codex CLI, Gemini CLI) — the same technique used by
opencode and similar open-source tools. This can violate provider ToS and Google in
particular has stated it detects and restricts third-party use of the Gemini CLI
flow. We ship them anyway (user's explicit requirement) with these mandatory
mitigations:

- `firstParty: true` providers show a **one-time consent modal** before the flow
  starts, stating plainly: "This signs in using <vendor CLI>'s credentials. It is
  not an officially supported integration and could stop working or affect your
  account. API-key setup is the supported alternative." Persist acceptance in
  `~/.agent-dashboard/settings.json`.
- All client ids / endpoints / scopes live in **one file**:
  `server/src/providers/firstparty.ts`, so drift is a one-file fix.
- Every flow stores `{ accessToken, refreshToken?, expiresAt? }` and the credential
  layer auto-refreshes: proactively when `expiresAt` is near, and reactively on a
  401 (single retry). Refresh failures flip the provider card to "Reconnect".

**Implementer instruction:** these constants and request shapes change. Before
coding each flow, fetch the current reference implementation listed below and port
from it — do not code purely from this table. The values here are correct starting
points as of writing.

| Provider | Flow details | Reference to port from |
|---|---|---|
| **Anthropic** | PKCE S256 against `https://claude.ai/oauth/authorize` with client id `9d1c250a-e61b-44d9-88ed-5944d1962f5e`, scopes `org:create_api_key user:profile user:inference`, redirect `https://console.anthropic.com/oauth/code/callback` → **code-paste variant**: the browser shows a `code#state` string the user pastes into the wizard (no loopback listener). Exchange at `https://console.anthropic.com/v1/oauth/token` (`grant_type=authorization_code`, include `state`); refresh with `grant_type=refresh_token`. Use tokens with `@ai-sdk/anthropic`: send `Authorization: Bearer <access>` + `anthropic-beta: oauth-2025-04-20`, and ensure no `x-api-key` header is sent. | opencode's Anthropic auth plugin; ben-vargas OAuth gist (cited in DECISIONS.md) |
| **OpenAI** | PKCE S256 against `https://auth.openai.com/oauth/authorize`, client id `app_EMoamEEZ73f0CkXaXp7hrann`, redirect `http://localhost:1455/auth/callback` — the redirect URI is registered for **port 1455 exactly**, so the server must temporarily bind a one-shot listener on 1455 for the duration of the flow (fail with a clear message if the port is busy). Scopes `openid profile email offline_access`. Exchange at `https://auth.openai.com/oauth/token`. Then two usage modes, try in order: (a) **token-exchange for a standard API key** (`grant_type=urn:ietf:params:oauth:grant-type:token-exchange` with the `id_token`) → plain `@ai-sdk/openai`; (b) if unavailable on the account, use the **ChatGPT Codex backend** (`https://chatgpt.com/backend-api/codex/responses`, Responses-API shape, `chatgpt-account-id` header from the id_token claims) via a thin custom adapter implementing the AI SDK provider interface. | `openai/codex` repo, `codex-rs/login/src/{server,pkce}.rs` (open source, authoritative); opencode's openai auth plugin for mode (b) |
| **Google** | Standard Google OAuth PKCE: `https://accounts.google.com/o/oauth2/v2/auth` → `https://oauth2.googleapis.com/token`, loopback redirect on an ephemeral port, using the **Gemini CLI's public client id + secret** (both published in the `google-gemini/gemini-cli` repo — copy current values from there), scopes `https://www.googleapis.com/auth/cloud-platform userinfo.email userinfo.profile`. Tokens call the **Code Assist API** at `https://cloudcode-pa.googleapis.com` (`loadCodeAssist` / `onboardUser` handshake, then `:generateContent` / `:streamGenerateContent`) — not the public Gemini API — so this needs a thin custom adapter. Free-tier accounts are auto-onboarded to a managed project; Workspace accounts must supply `GOOGLE_CLOUD_PROJECT` (wizard field). **Highest policy risk — consent modal must say so explicitly.** | `jenslys/opencode-gemini-auth` plugin + `google-gemini/gemini-cli` source (`packages/core/src/code_assist/`) |
| **GitHub Copilot** | **Device flow** (no loopback): POST `https://github.com/login/device/code` → show `user_code` + verification URL in the wizard with a copy button → poll `https://github.com/login/oauth/access_token` (`grant_type=urn:ietf:params:oauth:grant-type:device_code`, respect `interval`/`slow_down`). Wizard offers a text field for the user's **own GitHub OAuth App client id** (the sanctioned route — link GitHub's "enable device flow" docs) prefilled with the known VS Code client id `Iv1.b507a08c87ecfe98` as fallback. With the resulting `gho_` token, exchange at `https://api.github.com/copilot_internal/v2/token` for a short-lived Copilot token (cache + re-exchange on expiry), then chat via `https://api.githubcopilot.com` (OpenAI chat-completions compatible → `@ai-sdk/openai-compatible`) with headers `Editor-Version: vscode/1.99` and `Copilot-Integration-Id: vscode-chat`. Models from `https://api.githubcopilot.com/models`. | opencode's copilot auth plugin; GitHub device-flow docs (official) |

### OAuth helper architecture (`oauth.ts` + `firstparty.ts`)

One generic engine, four flow variants selected by the descriptor's `OAuthSpec.kind`:

1. `pkce-loopback` — verifier/S256 challenge, one-shot callback on the app's own
   `/api/providers/oauth/callback` (OpenRouter, Google), `state` matched, 5-min timeout.
2. `pkce-fixed-port` — same, but binds a dedicated one-shot `node:http` listener on a
   registered port (OpenAI:1455) and releases it immediately after the callback.
3. `pkce-code-paste` — no listener; wizard shows a "paste the code" input and POSTs
   it to `/api/providers/:id/oauth/paste` (Anthropic).
4. `device-code` — start + poll endpoints, wizard renders the user code (Copilot).

The browser is opened by returning `authUrl` to the web app (`window.open`), never by
shelling out. Each variant gets unit tests with mocked HTTP (challenge generation,
state mismatch rejection, poll backoff, refresh rotation); live flows are verified
manually once each and recorded in DECISIONS.md with the date.

### Credential store

`~/.agent-dashboard/credentials.json`, mode `0600`. Encrypt values at rest with
AES-256-GCM using a key derived (scrypt) from a machine-local secret file
`~/.agent-dashboard/keyfile` (random 32 bytes, `0600`, created on first run). This is
obfuscation-plus-file-permissions, not perfect secrecy — document that honestly in
README. **Never** log secrets; never return them in any API response (`GET
/api/providers` returns `{ connected: true, method: 'oauth', maskedKey: 'sk-…abc' }`).

### Provider setup UX (wizard panel)

1. Grid of provider cards (logo, name, "OAuth" / "API key" badges, connected state).
2. Click → drawer: for OAuth, one "Connect with <provider>" button → opens auth URL →
   on callback success the drawer live-updates via SSE `provider-change`.
   For API key: masked input, paste, "Test & Save" (runs the live test; show the
   round-trip latency and the fetched model count as success feedback; show the
   provider's error body verbatim on failure).
3. Per connected provider: default-model picker (from `listModels`), "Test", "Disconnect".
4. Empty state on Assistant panel deep-links here ("Connect a provider to start").

### Assistant panel

Chat UI (own scrollback, streaming tokens, markdown rendering, stop button) backed by
`POST /api/chat` using AI SDK `streamText`. Give it these server-side tools
(AI SDK tool-calling), each just wrapping `workspace.ts`:
`read_workspace_file`, `write_workspace_file`, `list_workspace`,
`update_sprint_task`, `update_agent_status`. System prompt: embed a compact version
of SCHEMAS.md and the rule "you are operating on the user's live dashboard files."
This makes provider setup immediately useful: "move all doing tasks assigned to
researcher back to todo" works end-to-end. Chat history: keep in memory + persist
last 20 conversations to `~/.agent-dashboard/chats/` (NOT the workspace).

## 7. Frontend shell (Scaffold)

- `App.tsx`: sidebar-or-topbar tab strip built from `config.json` tabs, hash router
  (`#/<panelId>/<subpath?>`), lazy panel loading, theme application, global SSE hookup.
- Store (`zustand`): `{ files: Map<path, {data, rev, error?}>, subscribe(path) }`.
  Panels declare the paths they need; the store fetches on demand and refetches on
  matching SSE events. One generic `useWorkspaceFile(path, schema)` hook does
  fetch + parse + subscribe + expose `{ data, error, save(mutator) }`. **All panels
  must use this hook** — no bespoke fetching per panel.
- Theme: 4 presets (dark default, light, midnight, terminal-green) as CSS custom
  property sets + user accent color; picker in a settings modal; persisted to
  `config.json` so agents can theme the dashboard too.
- Keyboard: `1..9` switch tabs, `Ctrl+K` quick-switcher (panels + docs + links).
- Every panel needs a designed empty state ("No flows yet — agents create files in
  workspace/flows/. Copy example?" with a button that writes the example file).

## 8. Panel implementation notes (parity details)

Ordered easy → hard; implement in this order within Phase 4–5.

1. **Links** — card grid by group; add/edit/delete inline; favicons from
   `https://icons.duckduckgo.com/ip3/<host>.ico` with `onerror` fallback glyph.
2. **Icons** — gallery of workspace `icons/*.svg`; click an icon → "assign to agent"
   popover listing agents; writes `iconId` into `agents.json`.
3. **Agents** — roster cards: icon, name, role, status dot (pulse animation when
   `active`), current task line, relative `lastUpdated`. Inline edit drawer. Live
   updates via SSE are the demo moment — make sure changing `agents.json` on disk
   visibly updates within ~200 ms.
4. **Generations** — filterable CSS-grid gallery, lightbox (hand-rolled, `<dialog>`),
   video via `<video controls>`. Thumbnails through `/api/media`.
5. **Docs** — left file tree, marked+DOMPurify rendering with the app theme, edit
   mode (plain `<textarea>` with save — no code-editor dependency), create/rename/
   delete files.
6. **Sprints** — @dnd-kit kanban: 4 columns + collapsible backlog rail; drag writes
   `status` + `order` back to `sprints.json`; assignee picker from agents; sprint
   header with dates + done-count progress bar.
7. **Crons** — list view (name, human-readable schedule via hand-rolled describe fn,
   next 3 occurrences from cron-parser, lastRun, enabled toggle) + month calendar
   plotting occurrences (date-fns grid, dots + hover popover). Invalid expressions:
   render the row with a warning badge, exclude from calendar.
8. **Skill Trees** — d3-force simulation in a `useEffect`, nodes as SVG circles
   colored by category, d3-zoom pan/zoom, drag pinning, click → detail card.
   "Scan" button → `POST /api/scan/skills`: walks roots configured in `config.json`
   (default `~/.claude/skills`, `~/.pi/agent/skills`, `~/.agents/skills`), reads each
   `SKILL.md` frontmatter `name`/`description`, groups by parent dir, writes
   `skills.json` (edges: root → category → skill). Merge, don't clobber, any
   hand-added nodes (`source: 'manual'`).
9. **Flows** — React Flow canvas; on load run dagre layout (left→right) for any nodes
   without stored positions; node card shows label, agent chip, status color;
   **playback**: if the flow has `runs`, show a transport bar (play/pause/scrub/speed)
   that replays `events` by timestamp — animate the active node (React Flow node
   class toggling) and mark edges traversed. Flow list page → canvas per flow.

## 9. PWA requirements

- vite-plugin-pwa: `display: 'standalone'`, theme/background color from default
  theme, generated maskable icons (512/192) from a source SVG logo (design a simple
  geometric logo in SVG — do not fetch external art).
- Precache the app shell + all lazy chunks. Runtime caching: `NetworkFirst` for
  `/api/ws/*` and `/api/providers` (so a relaunch with the server down shows the last
  snapshot), `NetworkOnly` for `/api/chat`, `/api/events`, OAuth routes.
- Offline/server-down banner: SSE `onerror` → show persistent "Disconnected — data
  may be stale" bar; auto-retry with backoff; clear on reconnect.
- Verify installability in Playwright (manifest present, SW registered, no console
  errors) and manually in Chrome (`chrome://apps`).
- Production mode: server statically serves `web/dist` so the whole app is
  `npm run build && npm start` → `http://localhost:4680`, installable from there.

## 10. External-agent onboarding (Rubric's "copy-paste install")

- `AGENTS.md` (repo root): where the workspace is, file contracts summary (link to
  SCHEMAS.md), behavioral rules for agents (update your `agents.json` status when
  starting/finishing; append flow run events; pull sprint tasks by editing status;
  never touch `~/.agent-dashboard/`).
- `README.md`: quickstart (`npm install && npm run build && npm start`), the
  copy-paste install prompt block for users to give their coding agent, provider
  setup screenshots section (placeholder), security notes (localhost-only, credential
  storage caveats).
- First-run: if `./workspace` missing, server copies `workspace.example/` and logs
  a welcome message with the URL.

## 11. Phases, order of work, acceptance criteria

Work strictly in this order. Commit at least once per phase with a conventional
message (`feat(server): …`). Keep `DECISIONS.md` updated whenever you deviate.

**Phase 0 — Scaffolding**
npm workspaces, TS configs (strict), eslint + prettier, vitest wired, empty Hono
server responding on 4680, Vite React app with proxy, CI-style script `npm run check`
(typecheck + lint + test) that passes.
✓ `npm run check` green; `npm run dev` serves a hello page with `/api/health` proxied.

**Phase 1 — Shared schemas + workspace engine**
All zod schemas + `workspace.example/` fully populated (realistic demo data: 4 agents,
2 flows with runs, 12 skills, 5 crons, 8 generations, 6 docs, 3 link groups, a sprint
with 14 tasks). `workspace.ts` (guarded paths, atomic writes), `/api/ws/*`, chokidar
→ SSE. Unit tests: path traversal rejected, schema validation on PUT, SSE emits on
external file change.
✓ vitest green incl. traversal + watch tests; `curl` the tree/file routes works.

**Phase 2 — Shell**
Store + `useWorkspaceFile` hook, hash router, tab strip from config, theming, SSE
client with reconnect, quick-switcher, empty-state component, error-card component.
✓ Editing `workspace/config.json` on disk live-updates tabs/theme without reload.

**Phase 3 — Provider system**
Registry, credential store (+ unit tests for encrypt/decrypt roundtrip, file perms,
and refresh-token rotation), the four-variant OAuth engine (§6a) with mocked-HTTP
unit tests per variant, `firstparty.ts` constants ported from the current reference
implementations, all seven descriptors incl. the two custom adapters (ChatGPT Codex
backend, Google Code Assist), `/api/providers/*`, wizard UI with the first-party
consent modal, live "Test" flow.
✓ Mock-based tests green for all four OAuth variants + API-key path; masked key
display; model list renders; disconnect deletes the credential entry; each live
OAuth flow manually verified once with a real account where available and the
result (or "not testable — no account") recorded per provider in DECISIONS.md.

**Phase 4 — Assistant**
`/api/chat` with AI SDK streaming + the five workspace tools, chat UI with streaming
and tool-call visibility (collapsible "used write_workspace_file: sprints.json" rows).
✓ With a connected provider (or mocked in tests): "mark task X done" round-trips —
file changes on disk and the Sprints data refetches via SSE.

**Phase 5 — Panels**
In §8 order. After each panel: a Playwright smoke test (loads with example data, one
core interaction), and update the example workspace if the panel revealed schema gaps.
✓ All 10 panels render example data with zero console errors; Playwright suite green;
Sprints drag-drop, Flows playback, Skills scan, Crons calendar all demonstrated in tests.

**Phase 6 — PWA + polish**
vite-plugin-pwa config, offline banner, production static serving, logo + icons,
bundle-size audit against the 350 KB budget (code-split fixes if over), keyboard nav,
`AGENTS.md`/`SCHEMAS.md` generation, README.
✓ `npm run build && npm start` → installable in Chrome; kill server → reopened
installed app shows cached shell + stale-data banner; Lighthouse PWA pass noted.

## 12. Guardrails for the implementing model — read before coding

1. **Do not expand scope.** No auth systems, no databases, no Docker, no cloud
   deploy, no extra providers, no websockets (SSE is chosen), no CSS frameworks
   (hand-written CSS with custom properties). If tempted, write the idea in
   `DECISIONS.md` under "Deferred" and move on.
2. **File-first is sacred.** Panels never keep authoritative state in memory or
   localStorage; the workspace files are the database. Any feature that needs
   persistence gets a schema + file, or (secrets/chat history only) `~/.agent-dashboard/`.
3. **One data hook.** Every panel reads/writes through `useWorkspaceFile`. If a panel
   seems to need something the hook can't do, extend the hook, don't bypass it.
4. **Never render unvalidated data.** All JSON goes through zod; all markdown/HTML
   through DOMPurify; all workspace paths through the guard in `workspace.ts`.
5. **Secrets discipline.** No secret in: API responses, logs, SSE payloads, the
   workspace dir, client-side state beyond masked display, or error messages.
6. **Stay within the dependency table** (§2). Adding a dependency requires a
   DECISIONS.md entry with the alternative considered.
7. **Verify each phase's acceptance criteria by actually running them** (tests,
   curl, browser) before declaring the phase done. If something can't be verified
   (e.g. live OpenRouter OAuth without user interaction), say so explicitly in the
   phase report rather than claiming it works.
8. **When a provider API detail is uncertain** (endpoint shapes, OAuth params,
   client ids), check the provider's current docs — or for the first-party flows in
   §6a, fetch the named reference implementation — before coding it. Do not guess
   from memory, and do not skip the port-from-reference step: those constants drift.
9. **First-party OAuth is consent-gated.** Never silently default a user into a
   `firstParty` flow; the consent modal (§6a) is required UI, and API-key setup must
   remain equally prominent in the wizard for those providers.
10. **Keep chunks small.** Prefer many small, typed modules over few large files;
   panels must not import from each other (shared code goes to `web/src/components`
   or `shared/`).
11. **If the plan conflicts with reality** (library API changed, approach infeasible),
   choose the smallest deviation that preserves the phase's acceptance criteria,
   record it in `DECISIONS.md`, and continue — don't stall, and don't silently
   redesign the architecture.
