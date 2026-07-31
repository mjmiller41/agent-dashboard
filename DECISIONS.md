# Decisions log

Running log of deviations from PLAN.md and other implementation choices, per
PLAN.md §12 guardrail 11. Newest entries at the bottom of each phase's section.

## Phase 0 — Scaffolding

### Deviations

- **`typescript` pinned to `6.0.3`, not the current `latest` (`7.0.2`).**
  TypeScript 7 (the native/Go-based compiler) is the registry `latest` tag at
  the time of scaffolding, but `typescript-eslint@8.65.0` (latest stable)
  declares a peer dependency of `typescript >=4.8.4 <6.1.0` and does not yet
  support TS 7. Since PLAN.md §11 Phase 0 requires ESLint working across all
  workspaces, and TS 7 support in typescript-eslint isn't out yet, the
  smallest deviation preserving both "TypeScript strict" and "eslint working"
  is to pin `typescript` to the newest available `6.x` release. Revisit once
  typescript-eslint ships TS7 support.

- **`@vitejs/plugin-react` pinned to `5.0.4`, not `latest` (`6.0.5`).**
  `@vitejs/plugin-react@6.x` requires `vite ^8.0.0`, but PLAN.md §2 pins the
  frontend to **Vite 6** explicitly ("do not substitute"). `5.0.4` is the
  newest `@vitejs/plugin-react` release whose peer range includes
  `vite ^6.0.0`, so that's what's installed alongside `vite@6.4.3`.

- **ESLint uses `typescript-eslint`'s non-type-checked `recommended` config,
  not `recommendedTypeChecked`.** Type-aware linting requires every linted
  file to fall inside a workspace `tsconfig.json`'s `include` globs via
  `projectService`, which breaks on the various root-level `*.config.{js,ts}`
  files (`eslint.config.js`, `vitest.config.ts`, `vite.config.ts`) that
  intentionally sit outside `src/`. Real type safety is still fully enforced
  by each workspace's `typecheck` script (`tsc --noEmit`), which `npm run
check` always runs before `lint`. This is pure lint-rule scope, not a
  reduction in type safety.

- **`npm run dev` is hand-rolled (`scripts/dev.mjs`), not a `concurrently`
  (or similar) dependency.** PLAN.md §12 guardrail 6 requires a written note
  for any dependency outside the §2 table; concurrently running two
  `npm run dev -w <workspace>` processes doesn't need a library — a ~25 line
  `node:child_process` script that forwards stdio and propagates
  SIGINT/SIGTERM to both children does the job with zero new dependencies.

- **Server source uses explicit `.ts` extensions in relative imports**
  (e.g. `import { app } from './app.ts'`), plus
  `compilerOptions.rewriteRelativeImportExtensions: true` in
  `tsconfig.base.json`. Node 24 runs `.ts` files directly via built-in type
  stripping (no `tsx`/`ts-node` dependency needed for `server`'s `dev`
  script, `node --watch src/index.ts`), but type-stripping is purely
  syntactic — it does **not** rewrite `./app.js` import specifiers to
  `./app.ts` the way `tsc`'s NodeNext resolution does at compile time. So
  the source must import with the extension that actually exists on disk
  (`.ts`) for `node --watch` to resolve it at dev time.
  `rewriteRelativeImportExtensions` (stable since TS 5.7, present in the
  pinned TS 6.0.3) then rewrites those same `.ts` specifiers to `.js` when
  `tsc` builds `server/dist/` for production, so `node dist/index.js` still
  works unchanged. `shared`'s one test file follows the same convention for
  consistency, though `shared` isn't consumed by anything yet at Phase 0.

- **`shared` is a standalone workspace with a placeholder export + one
  vitest test, not wired into `server` or `web` yet.** PLAN.md §11 Phase 0
  explicitly scopes shared's harness only ("it likely doesn't need real
  schemas yet, just the harness"); the zod schemas and actual cross-package
  consumption land in Phase 1 (§4/§11).

### Deferred (explicitly out of Phase 0 scope per PLAN.md §11)

zod schemas, `workspace.ts`, chokidar/SSE, the shell (router/store/theme),
providers, assistant, all 10 panels, PWA config. Not started.

### Notes (not deviations, just choices made where PLAN.md left room)

- Root `tsconfig.json` is a solution-style file referencing only `shared`
  and `server` (both `composite: true`, Node/NodeNext resolution). `web`
  intentionally keeps its own self-contained `tsconfig.json` using
  `moduleResolution: "Bundler"` (the correct mode for a Vite app) rather
  than joining the Node-oriented project-reference graph; it's still fully
  covered by `npm run typecheck` via its own workspace script.
- `npm run dev` starts both the Hono server (`127.0.0.1:4680`) and the Vite
  dev server together. Vite picks the first free port starting at `5173`;
  `/api` is proxied to `http://127.0.0.1:4680` in dev (`web/vite.config.ts`).
- `npm run check` = `typecheck` → `lint` → `format:check` → `test`, run via
  `npm run <script> --workspaces --if-present` for each, so any workspace
  missing a given script (e.g. `web` has no `test` script yet at Phase 0) is
  skipped rather than failing.

## Phase 1 — Shared schemas + workspace engine

### Deviations

- **`zod` is declared as a direct dependency in both `shared` and `server`
  `package.json`, not only in `shared`.** PLAN.md §2's table lists zod as
  "shared package, used by server + web", which could be read as "only
  `shared` needs it in its manifest". In practice `server`'s route/workspace
  code does its own `schema.safeParse()` calls and needs zod's types
  resolvable without relying on npm's hoisting behavior being stable across
  installs. Declaring it explicitly in both manifests (same version) is the
  standard fix for phantom-dependency risk in npm workspaces and does not
  add a new library — zod itself is explicitly sanctioned by §2. `web`
  doesn't need it yet (no schema-consuming code lands there until Phase 2+).

- **`shared/src/schemas/registry.ts` (`schemaForPath` / `isUnvalidatedWorkspacePath`)
  is a new, PLAN-unlisted module.** PLAN.md §5 requires `workspace.ts` to
  "validate against the right zod schema by filename convention", and §11's
  acceptance test needs to walk `workspace.example/` and validate every JSON
  file "against its corresponding schema by filename convention" — both need
  the _same_ filename→schema mapping. Centralizing it in `shared` (rather
  than duplicating the convention in `server/src/workspace.ts` and in the
  test) is a one-file-fix-drift choice in the spirit of §6a's
  `firstparty.ts` rationale, not scope creep — no new dependency, no new
  document type.

- **`skills.json`'s example data has 12 total nodes, not 12 "skill" nodes
  plus separate category/root scaffolding nodes.** The brief's line item
  said "12 skill nodes (some edges between them)"; my first draft had 4
  structural nodes (1 root + 3 categories) plus 9 actual skill leaf nodes
  (13 total), which reads naturally as "9 skills" not "12 skills" and also
  didn't match the acceptance test's literal node count. I removed the
  `root` node (categories now roots of their own subtrees) to land exactly
  on 12 total nodes: 3 categories + 9 skills. Logged here since "12 skill
  nodes" is genuinely ambiguous between "12 nodes representing skills" and
  "12 nodes total in the skills graph" — went with the literal total-count
  reading since that's what a walking test can assert unambiguously.

- **`server/src/workspace.ts`'s symlink-escape guard is a nearest-existing-
  ancestor `realpath` walk-up, not a full per-segment canonicalization.**
  The brief explicitly scoped this as "if easy to check" — full protection
  against e.g. a symlink several segments deep in a not-yet-existing path
  would need per-component realpath resolution as each segment is created,
  which is meaningfully more code for a threat model (a hostile symlink
  planted by something with write access to the workspace) that's out of
  scope for a localhost single-user tool. The implemented check does catch
  the realistic case (a symlink directly under `workspace/` pointing
  outside it) and is covered by a test.

- **`GET /api/ws/file` and `PUT /api/ws/file` bodies are the file content
  directly** (JSON body for `.json` paths, raw text body otherwise), not
  wrapped in an envelope like `{content: ...}`. PLAN.md §5 doesn't specify a
  body shape; sending the content directly is what a `curl -d @file.json`
  verification naturally does and keeps the route trivial.

- **SSE `rev` is `sha1(path:mtimeMs:size).slice(0,12)` (or
  `sha1(path:deleted:hrtime)` for a since-deleted path), not a monotonic
  counter.** PLAN.md §5's echo-suppression note offers either "a hash of
  path+mtime, or a monotonic counter keyed by path" as equally acceptable.
  The hash approach needs no shared mutable state between `workspace.ts`
  (which returns a rev from `writeFile`) and `watch.ts` (which computes a
  rev when chokidar fires) — both independently derive the same rev from
  the same on-disk stat, so a server-initiated write and the resulting
  watch event naturally agree without explicit coordination.

- **`server/src/routes/events.ts` sends a periodic `ping` SSE event every
  20s** in addition to `ws-change`/`provider-change`. Not requested by the
  brief, but without it a client behind a proxy that times out idle
  connections (or a browser `EventSource` reconnect heuristic) has no signal
  the connection is still alive between real changes. Small, contained, easy
  to remove if Phase 2's SSE client design wants it gone.

- **`scripts/generate-example-icons.mjs` is kept as a checked-in script**
  (not run-once-and-discard) so the `workspace.example/icons/*.svg` set is
  reproducible (seeded PRNG) if regenerated later. Lives in the existing
  `scripts/` dir alongside `dev.mjs`, no new dependency.

### Deferred

- No new deferrals this phase. Providers/assistant/panels/PWA work remains
  as scoped to Phases 3–6 in PLAN.md §11; nothing new was tempting enough
  to write down.

### Notes (not deviations, just choices made where PLAN.md left room)

- `Workspace.listTree()` returns files only (no directory entries); panels
  needing a tree UI (Docs) can derive folder structure client-side by
  splitting each `path` on `/`. Each entry also carries `size` in addition
  to the required `path`/`mtimeMs` (harmless extra field).
- `./workspace`'s default location resolves relative to the **repo root**
  (computed from `import.meta.url`, not `process.cwd()`), because running a
  workspace script changes cwd to `server/` first — a cwd-relative default
  would put `./workspace` at `server/workspace` instead of matching
  `workspace.example/`'s sibling position in the repo layout (PLAN.md §3).
  `WORKSPACE_DIR` overrides are still resolved against `process.cwd()` when
  given as a relative path, since that's the intuitive behavior for someone
  setting the env var by hand.

- `docs/**/*.md` and `icons/*.svg` are recognized as valid-but-unvalidated
  workspace paths via `isUnvalidatedWorkspacePath` (used by the
  `workspace.example/` walking test); `workspace.ts` doesn't need this
  distinction at runtime — it already treats any non-`.json` path as raw
  text and any `.json` path with no registered schema as pass-through JSON.

## OAuth research findings (§6a pre-flight, Phase 3 blockers)

Five research tickets (issues #9–#13) verified PLAN.md §6a's first-party OAuth details against current sources. Full request/response shapes are in each closed issue's comments — this is a summary of what changed.

### OpenRouter (#9) — one correction

Key-exchange body must include `code_challenge_method` alongside `code`/`code_verifier` (PLAN.md's table omitted it); omitting it 400s. Authorize URL and base/models endpoints otherwise confirmed correct. Source: openrouter.ai/docs/use-cases/oauth-pkce.

### Anthropic (#10) — three corrections, two implementation notes worth keeping

1. Redirect URI has moved: `https://platform.claude.com/oauth/code/callback` (not `console.anthropic.com`).
2. **Token/refresh endpoint has also moved**: `https://platform.claude.com/v1/oauth/token` (not `console.anthropic.com/v1/oauth/token`) — same host as the redirect, easy to miss since PLAN.md only flagged the redirect.
3. Scopes expanded from 3 to 6: `org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload`.
   Client id (`9d1c250a-e61b-44d9-88ed-5944d1962f5e`) and code-paste/token-exchange mechanics confirmed unchanged. Authorize URL (`claude.ai/oauth/authorize`) confirmed still valid.
   **Worth implementing:** Anthropic rotates the refresh token on every refresh call — always persist the new one, and coalesce concurrent refresh attempts into a single in-flight promise (two simultaneous refreshes with the same stale token can wipe out freshly-stored tokens per multiple reference implementations).
   **Fallback to know about, not required for v1:** if OAuth-authenticated `/v1/messages` calls 400 with a spurious "out of usage" error, at least one reference implementation works around it with an undocumented `x-anthropic-billing-header`-style text block prepended to the system prompt — reverse-engineered and fragile, only reach for it if the plain `Authorization: Bearer` + `anthropic-beta: oauth-2025-04-20` path actually fails in testing.
   Sources: vendored Claude Code CLI constants files plus ccflare, sitegeist, magenta.nvim, opencode-anthropic-oauth, agentty, speca (cross-checked across 8 independent repos).

### OpenAI (#11) — several corrections

1. Authorize URL needs extra params PLAN.md omitted: `response_type`, `id_token_add_organizations`, `codex_cli_simplified_flow`, `state`, `originator`.
2. `chatgpt-account-id` lives at JWT claim path `payload["https://api.openai.com/auth"]["chatgpt_account_id"]`, not top-level.
3. Mode (a) token-exchange-for-API-key is best-effort and often unavailable — implement mode (b), the Codex backend adapter, as the reliable path, not a rare fallback.
4. Refresh token request is JSON body, not form-urlencoded.
   Client id, fixed port 1455, and the two-mode approach otherwise confirmed. Source: `openai/codex` `codex-rs/login/src/{server,pkce}.rs`.

### Google (#12) — client id/secret/scopes/endpoints confirmed; PKCE source corrected; two new implementation requirements

1. **PKCE clarification:** gemini-cli's own loopback browser flow (`authWithWeb`) does _not_ use PKCE — it's a confidential-client `client_secret` + `state` exchange. Only its separate no-browser/manual flow uses PKCE, and that one redirects to Google's hosted `codeassist.google.com/authcode` page, not a loopback. **Decision: keep PLAN.md's PKCE-loopback design anyway** (more secure, confirmed working against Google's endpoint) — but port the actual PKCE mechanics from `jenslys/opencode-gemini-auth/src/gemini/oauth.ts`, not from gemini-cli's browser flow (there's nothing there to port).
2. Exact `loadCodeAssist`/`onboardUser`/`:generateContent` JSON envelopes now fully specified in issue #12 (endpoint base is `cloudcode-pa.googleapis.com/v1internal`, note `v1internal` not `v1`/`v1beta`; free-tier onboarding must omit `cloudaicompanionProject` entirely or it 412s; `:generateContent` wraps the public API's body one level deeper under `request`/`response` keys with `project`/`user_prompt_id` routing fields).
3. **New:** reject purely-numeric input in the wizard's `GOOGLE_CLOUD_PROJECT` field — Google requires the string Project ID, not the numeric Project Number (gemini-cli validates this explicitly).
4. **New:** surface `ineligibleTiers[].reasonCode === 'VALIDATION_REQUIRED'` (with its `validationUrl`) as a distinct wizard state — "needs verification, click here" — not a generic failure.
   Client id/secret (intentionally public, installed-app pattern per Google's own OAuth docs) and scopes confirmed unchanged. Source: `google-gemini/gemini-cli` `packages/core/src/code_assist/*`, cross-checked against `jenslys/opencode-gemini-auth`.
   Still flagged as PLAN.md's highest policy-risk flow — gemini-cli's own source has dedicated `SECURITY_POLICY_VIOLATED`/VPC-SC handling, reinforcing that Google actively gates this API. Consent modal copy must say so explicitly; no additional mitigation beyond §6a's existing plan identified.

### GitHub Copilot (#13) — several corrections

1. `copilot_internal/v2/token` exchange is `GET` with `Authorization: token <gho_>` (not `POST`/`Bearer`), and also requires `Copilot-Integration-Id`.
2. Response includes `endpoints.api` — use this rather than hardcoding `api.githubcopilot.com`.
3. Token lifetime ~25 min (`refresh_in`/`expires_at`).
4. Chat needs a fuller header set: `Editor-Plugin-Version`, `X-GitHub-Api-Version`, `X-Initiator`, alongside `Editor-Version`/`Copilot-Integration-Id`.
5. Current OSS implementations (opencode, Zed) actually skip the internal-token exchange entirely and send the raw `gho_` token straight to `api.githubcopilot.com` — a viable, simpler fallback worth considering.
   Device-flow mechanics and VS Code client id otherwise confirmed against GitHub's official docs (doc path moved to `building-oauth-apps`, not `building-github-apps`).
