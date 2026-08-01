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

## Phase 2 — Shell

### Deviations

- **`happy-dom` was added as a `web` devDependency; `@testing-library/react`
  was deliberately not added.** PLAN.md §2's dependency table doesn't list a
  DOM-testing library. Router/store/hook unit tests need a DOM environment
  for vitest (`window`, `location.hash`, `fetch`/`EventSource` mocks), which
  `happy-dom` provides without pulling in a component-testing framework —
  narrower than the alternative considered (`@testing-library/react` +
  `jsdom`), and component behavior is exercised instead via the real
  Playwright browser check described below, not through component-test
  mocks. No UI framework or component-testing library was added.
- **`web/tsconfig.json` picked up a small change** (test-env types wiring
  for `happy-dom`/vitest globals) alongside the above — not a scope change,
  just what's needed for `vitest.config.ts` to typecheck.

### Bug found and fixed during verification (not part of the original build)

- The Phase 2 build (done by an earlier session/subagent run) shipped
  `useRoute()` backed by `useSyncExternalStore(onRouteChange, getCurrentRoute,
getCurrentRoute)`, where `getCurrentRoute()` parsed `location.hash` fresh
  on every call and returned a brand-new object literal each time — even
  when the hash hadn't changed. `useSyncExternalStore` requires `getSnapshot`
  to return a referentially stable value between renders when nothing
  changed; violating that crashes the whole app with "Maximum update depth
  exceeded" the moment a hash-driven re-render feeds back into another
  `getSnapshot` call (reproduced live via Playwright: clicking a tab crashed
  `<App>` entirely, verified by the crash disappearing after the fix).
  Fixed in `web/src/router.ts` by memoizing the parsed `Route` against the
  raw hash string it was parsed from (`getCurrentRoute` now only re-parses
  when `window.location.hash` actually differs from the last-seen value).
  This is the kind of defect §11's "verify by actually running it, not by
  inspection" guardrail exists to catch — it passed typecheck/lint/unit
  tests cleanly and only showed up under a real live click-through.

### Deferred

- Quick-switcher (`Ctrl+K`) currently searches tab labels only, not "panels
  - docs + links" as PLAN.md §7 describes — docs/links panels don't exist
    until Phase 5, so there's nothing to search yet. Revisit once those panels
    exist and have real content to index.

### Notes (not deviations, just choices made where PLAN.md left room)

- Tab strip is a top bar (not a sidebar) — either is sanctioned by §7's
  "sidebar-or-topbar"; topbar keeps more horizontal room for panel content
  at small viewport widths.
- Settings/theme picker is a simple modal (opened via a "Theme" button in
  the tab strip), not a dedicated settings panel — matches §7's "picker in a
  settings modal" literally.
- `useWorkspaceFile`'s `save(mutator)` PUTs optimistically (updates the local
  store immediately, then confirms/corrects via the server response and any
  follow-on SSE event) rather than waiting for a round trip before updating
  the UI — chosen for the ~200ms-perceived-latency feel implied by §8's
  agents-panel SSE demo note, and safe because the server is still the
  schema-validating source of truth (a rejected PUT rolls the optimistic
  update back).
- Real, live proof of the Phase 2 acceptance criterion ("editing
  `workspace/config.json` on disk live-updates tabs/theme without a page
  reload") was captured with a one-off Playwright script (run against the
  real dev server, not committed to the repo — per the build brief's
  instruction to keep it a throwaway verification aid) that: loaded the app,
  mutated `config.json` on disk to add a tab and change the theme
  preset/accent, asserted the DOM updated within 5s with zero reload and zero
  console errors, then separately added a tab with an unknown `panel` id and
  confirmed the error-card path renders instead of crashing. All five
  assertions passed after the router fix above.

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

## Phase 3 — Provider system

### Deviations

- **`aiSdkFactory` (PLAN.md §6's `ProviderDescriptor` field) was not implemented; descriptors
  expose `test`/`listModels` instead.** Wiring a real AI SDK `LanguageModel` for the two custom
  adapters (Google Code Assist, OpenAI Codex backend) means satisfying the full `LanguageModelV2`
  interface (`doGenerate`/`doStream`/`supportedUrls`/etc.) — real value only once `/api/chat`
  (Phase 4, streaming chat) exists to call it. The build brief explicitly scoped Phase 3 to "a live
  Test call and model listing... not full streaming chat," so `registry.ts`'s `ProviderDescriptor`
  has `test(cred, store)` and `listModels(cred, store)` instead. `aiSdkFactory` lands in Phase 4.
- **Two extra routes not in PLAN.md's §5 list**: `GET /api/providers/settings` and
  `POST /api/providers/settings/consent`. §6a requires persisting first-party consent-modal
  acceptance in `~/.agent-dashboard/settings.json`, but the browser has no filesystem access to
  that path — a server route is the only way to fulfill the requirement. Smallest addition that
  satisfies it (guardrail #11).
- **GitHub Copilot is not marked `firstParty: true`**, unlike Anthropic/OpenAI/Google. PLAN.md's
  §6 provider table explicitly labels only those three as "First-party ... sign-in" flows; Copilot's
  row describes device flow with a _sanctioned_ bring-your-own-client-id path as primary and the
  well-known VS Code client id as a documented fallback (not a vendor-CLI-credential-reuse pattern
  the same way as the other three). The wizard still surfaces attribution info for the fallback
  client id (issue #13's UX note) but doesn't gate it behind the full consent modal. Logged as a
  judgment call per guardrail #11 — reasonable readers could argue either way.
- **The `pkce-loopback` variant (OpenRouter, Google) uses a `flow` query param embedded in the
  redirect URI we control, not the OAuth `state` param, to correlate a callback with its pending
  flow.** OpenRouter's redirect never echoes `state` back (confirmed in issue #9's research), so
  keying the shared `/api/providers/oauth/callback` route purely on `state` would break that
  provider. `state` is still generated, sent, and validated when a provider _does_ echo it back
  (Google) for defense-in-depth; the flow id in the callback path is the actual correlation key for
  all pkce-loopback providers uniformly. Found and fixed via live testing (the first version only
  added `?flow=` to Google's redirect_uri, not OpenRouter's callback_url — an unnecessary asymmetry
  that meant OpenRouter would 404 on every real callback until fixed).
- **`server/src/providers/oauth.ts` error classes use explicit field assignment in the constructor
  body instead of TypeScript parameter-property shorthand** (`constructor(x: T) { this.x = x; }`
  rather than `constructor(readonly x: T)`). Node's built-in type-stripping (used by `node
server/src/index.ts` / `node --watch`, per the Phase 0 convention already established) doesn't
  support parameter properties — `tsc --noEmit` accepted the shorthand silently, but the app crashed
  at actual runtime with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`. Caught by live-booting the server
  (guardrail #7), not by typecheck/lint/tests, which all passed first. Fixed in both occurrences
  (`OAuthPortInUseError`, `GoogleValidationRequiredError`).
- **Codex backend (OpenAI oauth mode b) and Google Code Assist (oauth) model lists are curated
  static lists, not fetched from a live endpoint.** Neither the ChatGPT Codex backend nor the Code
  Assist API has a documented model-listing endpoint (confirmed absent in issues #11/#12's
  research); OpenRouter/Anthropic/OpenAI(api-key)/Google(api-key)/Copilot/Ollama/Custom all use
  their real listing endpoints.

### Deferred (explicitly out of Phase 3 scope, or pushed to Phase 4)

- Full AI SDK `LanguageModelV2` wiring for the two custom adapters (see deviation above) — Phase 4.
- Anthropic's undocumented `x-anthropic-billing-header` workaround (issue #10's research note) —
  only worth adding if a real OAuth-authenticated `/v1/messages` call is seen to 400 with a spurious
  "out of usage" error in practice; not implemented speculatively.
- OpenAI's 1457 fallback port if 1455 is busy (codex-rs has it; opencode's simpler fixed-1455
  approach was chosen per issue #11's explicit recommendation) — a clear `OAuthPortInUseError` is
  surfaced instead, per PLAN.md §6a's own instruction ("fail with a clear message if the port is
  busy").
- Zed/opencode's "skip the token exchange, send the raw `gho_` token directly" Copilot shortcut
  (issue #13, item 5) — the two-step exchange (the more standard, entitlement-aware path) is what's
  implemented; the shortcut is noted as a fallback worth knowing about, not built.

### Notes (not deviations, just choices made where PLAN.md left room)

- Ollama's `apiKey` spec is marked `optional: true` — `POST /api/providers/ollama/apikey` accepts an
  empty `key` and stores just `{baseUrl}` (or no baseUrl, defaulting to `localhost:11434`), matching
  §6's "none (URL only)" auth description while reusing the same api-key credential-store/route
  machinery as every other provider rather than a bespoke no-auth code path.
- `GET /api/providers` decrypts and re-masks each connected credential per request (`store.get`)
  rather than reading `store.list()`'s metadata-only summary. Caught this the hard way: an initial
  version used `list()`, which meant `maskedKey` was silently always `undefined` for every connected
  provider — passed the API-key round-trip test until a `maskedKey`-specific assertion was added.
- `generateText` calls used for the API-key "Test" path are all invoked with `maxRetries: 0`. The AI
  SDK's default retry/backoff (built for real chat calls) made a live test against an unreachable
  endpoint take 5+ seconds and blew past the test suite's default timeout — a live "Test" click
  should fail fast, not silently retry for several seconds first.
- The consent modal's vendor-CLI name ("Claude Code" / "Codex CLI" / "Gemini CLI") is a small
  hardcoded lookup in `web/src/panels/providers/ConsentModal.tsx`, not sent by the server — it's
  presentation-only copy, not connection state.
- Model picker in the connected-provider drawer view is a plain `<select>` populated from
  `listModels`; nothing yet persists the chosen default model anywhere (Phase 4's chat endpoint is
  what will need a "default model" concept to consume).

### Live verification results (guardrail #7)

Ran with real network access; results below are from actually executing each flow/route, not
inspection. Server booted via `node server/src/index.ts` against a temp `AGENT_DASHBOARD_HOME` /
`WORKSPACE_DIR`; web verified via a throwaway Playwright script against the Vite dev server
(deleted before the final commit, per the build brief).

- **Server boot + registry**: `GET /api/providers` returns all 7 descriptors, `connected: false`,
  no secret fields in the JSON — verified.
- **Credential store**: fake-key round trip (`POST /api/providers/custom/apikey` with
  `baseUrl: http://localhost:11434/v1`) → encrypted correctly on disk (`credentials.json`/`keyfile`
  both mode `0600`, ciphertext contains no plaintext secret), `DELETE` removes it, `GET
/api/providers` masks the key — verified.
- **Ollama (local, no account needed)**: `ollama serve` was already installed
  (`~/.local/bin/ollama`) but not running; started it for the duration of testing (stopped
  afterward). Fully live-verified end-to-end: reachability test against the real local daemon
  (`GET /api/tags`, 3 real models: `qwen3:4b`, `qwen3:14b`, `nomic-embed-text:latest`), real model
  list returned through the route, and a real `generateText` call through
  `@ai-sdk/openai-compatible` against Ollama's OpenAI-compatible endpoint via the **Custom
  OpenAI-compatible** descriptor (proves the "Test" call path works end-to-end against a live
  model, not just reachability).
- **Anthropic (API-key path)**: `POST /api/providers/anthropic/apikey` with a syntactically-valid
  but fake key hit the real `api.anthropic.com` and correctly reported the real API's error
  (`"invalid x-api-key"`) — the connect/test/report-failure/disconnect round trip is fully verified;
  the _OAuth_ flow itself is **not testable — no Claude Pro/Max account available in this
  environment.** `POST /api/providers/anthropic/oauth/start` was verified to build a well-formed
  authorize URL (correct client id, all 6 scopes, PKCE challenge, state) and register a pending
  code-paste flow, but nothing beyond that could be exercised live.
- **OpenAI (OAuth)**: **not testable — no ChatGPT account available.** `oauth/start` was verified to
  really bind the fixed port 1455 listener (confirmed via `ss -ltnp`), build a correct authorize URL
  matching issue #11's full param set, and correctly reject a second concurrent start attempt with
  `OAuthPortInUseError` (409) while the first listener was still bound — the plumbing works; the
  actual sign-in and token exchange could not be exercised.
- **Google (OAuth)**: **not testable — no Google account exercised through this flow (policy risk
  noted in PLAN.md/DECISIONS.md's research section discouraged testing this live without a
  disposable account).** `oauth/start` verified to build a correct authorize URL (client id, scopes,
  PKCE, `access_type=offline`, embedded `flow` id) and register a pending flow; a deliberately wrong
  `state` on the callback was verified to be rejected with a 400 `OAuthStateMismatchError`.
- **GitHub Copilot (device flow)**: **partially live-tested against the real GitHub API** — `POST
/api/providers/github-copilot/oauth/start` (using the fallback VS Code-family client id) made a
  real call to `https://github.com/login/device/code` and got back a real device code, user code,
  and verification URL. The remaining step (actually visiting `github.com/login/device`, entering
  the code, and completing the poll-to-token exchange) needs interactive browser login and was
  **not completed** — recorded as "start verified live, completion not testable without interactive
  sign-in."
- **OpenRouter (OAuth)**: **not completed end-to-end** — same reasoning as Google/Anthropic/OpenAI,
  completing the flow needs a real account with interactive browser consent. `oauth/start` was
  verified to build a correct authorize URL (no client id/scope per issue #9's confirmed spec, PKCE
  challenge, `flow` id embedded in `callback_url`) and register the pending flow correctly.
- **Callback error paths** (all via real HTTP requests against the running server, not mocked):
  unknown/expired flow id → clean 400 with a readable message (not a crash); state mismatch on a
  real pending flow → 400 `OAuthStateMismatchError`; port already in use → 409
  `OAuthPortInUseError`. All three behave identically to their mocked-HTTP unit test counterparts.
- **Web UI** (Playwright, throwaway script, deleted before commit): Providers tab reachable from the
  tab strip; grid renders all 7 cards with correct name/badges; clicking a first-party provider and
  clicking "Connect" shows the consent modal with the exact required copy from §6a bullet 1; Cancel
  correctly aborts without starting an OAuth flow; a fake API key for OpenRouter round-trips through
  the real credential store and the drawer shows the real API's failure message (`"User not found."`)
  cleanly; the provider card updates to "Connected" live after save; zero browser console errors
  across the whole run.

### Testing

- `server/src/providers/credentials.test.ts` — encrypt/decrypt roundtrip, file permissions (0600,
  both `credentials.json` and `keyfile`), keyfile reuse across store instances (restart-safe),
  refresh-token rotation via `update()`, concurrent-update serialization, delete/list, masking.
- `server/src/providers/oauth.test.ts` — PKCE challenge/verifier generation and determinism,
  `completePkceFlow`'s state-mismatch rejection and one-shot consumption (mocked HTTP throughout),
  `startFixedPortListener`'s real (non-mocked, localhost-only) socket bind/callback/port-in-use
  behavior, `pollDeviceCode`'s RFC 8628 backoff (mocked poll function, injectable sleep), and
  `coalescedRefresh`'s single-in-flight-call guarantee plus per-provider isolation.
- `server/src/routes/providers.test.ts` — full route-level integration tests (real Hono app, temp
  credential/settings dirs, mocked-`fetch` device-code start, real `ollama`-shaped api-key round
  trip against a deliberately-unreachable port): registry listing, API-key connect/test/disconnect,
  masked-key display, OAuth start for all 4 variants, callback error paths, settings persistence.
- `npm run check` (typecheck + lint + format + all vitest suites across `shared`/`server`/`web`):
  **green** — 152 tests total (45 shared + 84 server + 23 web), 0 lint errors, 0 format issues.

## Phase 4 — Assistant

### Deviations

- **`aiSdkFactory` takes `(cred, model, store)`, not just `(cred)` as PLAN.md §6's abstract type
  sketch shows.** A concrete AI SDK `LanguageModel` instance needs both the credential AND the
  model id the user picked in the Assistant panel's picker — PLAN.md's sketch (`(cred) => ...`)
  doesn't have anywhere to pass the model id in. Added `model: string` as the factory's second
  parameter (and `store`, third, only actually used by Copilot's short-lived-token cache, matching
  `test`/`listModels`'s existing `(cred, store)` shape from Phase 3). Implemented in
  `server/src/providers/registry.ts`, reusing the exact client-construction call each provider's
  `test()` already uses (createAnthropic/createOpenAI/createGoogleGenerativeAI/
  createOpenAICompatible) per the build brief's explicit "don't reinvent it" instruction.
- **The two custom adapters (Google Code Assist, OpenAI Codex backend) implement AI SDK's
  `LanguageModelV4` interface, not `LanguageModelV2` as PLAN.md/DECISIONS.md's Phase 3 entry
  assumed.** The installed `ai`/`@ai-sdk/*` versions (checked `node_modules/ai/package.json`:
  `7.0.47`; `@ai-sdk/provider`: `4.0.4`) have moved the custom-provider spec to `v4`
  (`specificationVersion: 'v4'`, `doGenerate`/`doStream`/`supportedUrls`) since PLAN.md §6a was
  written — exactly the kind of drift PLAN.md §12 guardrail 8 warns about ("check the provider's
  current docs... before coding it"). Added `@ai-sdk/provider` as an explicit direct dependency of
  `server` (was only a transitive dep via `ai`) so the two adapter files can import its types
  directly, without relying on npm hoisting — same phantom-dependency fix as Phase 1's zod
  declaration. New file `server/src/providers/adapters/text-prompt.ts` holds the logic shared by
  both adapters (flattening an AI SDK prompt to plain system+turns text, a null-usage helper, and a
  small `data: {...}` SSE-frame parser used by both `doStream` implementations).
- **Both custom adapters are text-only — they do not wire AI SDK tool-calling through to the
  underlying Code Assist / Codex backend APIs**, even though `workspaceTools: true` still attaches
  tool definitions to the `streamText` call regardless of which provider is selected. The build
  brief explicitly scoped these two adapters to "they need to support streamText, nothing more,"
  and neither OAuth account is available to test against in this environment (per Phase 3's
  DECISIONS.md: "not testable — no account"), so there's no way to verify a tool-calling
  implementation against the real APIs even if built. If a user connects Google or OpenAI via
  OAuth and enables workspace tools, the model simply won't be offered/able to call them — a known,
  documented limitation, not a silent failure (the model just answers in prose). The Ollama/Custom
  path (used for all live verification below) exercises the real tool-calling loop end-to-end
  through the standard `@ai-sdk/openai-compatible` provider, which already supports it natively.
- **`server/src/providers/credential-refresh.ts` is a new file, extracted from
  `routes/providers.ts`'s previously-inline `ensureFreshCredential`.** `routes/chat.ts` needs the
  exact same "refresh an OAuth credential if it's near expiry, persist the rotation" logic
  `routes/providers.ts`'s `/test` and `/models` routes already had inline — duplicating it would
  create two copies that could drift (the build brief explicitly says to reuse, not duplicate,
  provider-construction logic elsewhere in this phase, and the same reasoning applies here).
  `routes/providers.ts` now imports the extracted function; its behavior is unchanged and its
  existing tests still pass unmodified.
- **`conversationId` is an additive, optional field in `POST /api/chat`'s request body**, not part
  of PLAN.md §5's literal `{providerId, model, messages, workspaceTools}` list. PLAN.md §6 requires
  persisting "last 20 conversations" to `~/.agent-dashboard/chats/`, but nothing in §5's route
  signature identifies _which_ conversation a given turn belongs to. The client (`useChat.ts`)
  generates one UUID per chat session and sends it on every turn; the server upserts that
  conversation's full transcript to disk in `streamText`'s `onFinish` callback. Omitting it is
  fully backwards compatible (the request is still valid, the turn just isn't persisted to history).
- **Chat history has no "browse past conversations" UI.** PLAN.md §6 only requires the _data_ be
  persisted ("keep in memory + persist last 20 conversations"), not a history-browsing feature in
  the Assistant panel, and §11 Phase 4's acceptance criterion is specifically the tool-call round
  trip, not a history browser. `server/src/chat/history.ts`'s `ChatHistoryStore` fully implements
  and unit-tests `save`/`get`/`list`/pruning; only `list`/`get` have no caller yet on the web side.
  Logged as a deliberate scope cut rather than an oversight — easy to wire a "recent chats" dropdown
  onto the existing store later without touching its interface.
- **The system prompt's workspace-schema summary is a new hand-maintained constant
  (`server/src/chat/system-prompt.ts`), not generated from `shared/src/schemas`.** PLAN.md §6 says
  "embed a compact version of SCHEMAS.md" — SCHEMAS.md itself doesn't exist yet (its generation
  pipeline is explicitly Phase 6 scope per §11). The brief for this phase confirmed this reading
  ("do NOT invent a SCHEMAS.md generation pipeline, that's Phase 6's job"), so this is a deliberate,
  pre-authorized deviation rather than a judgment call.

### Deferred

- Tool-calling through the two custom (Google Code Assist / OpenAI Codex backend) adapters — see
  the deviation above. Revisit if/when a real OAuth account for either becomes available to test
  against, since the request/response shapes for tool calls in the Code Assist and Responses APIs
  are genuinely different from the OpenAI-chat-completions shape the rest of the system uses.
- A "recent chats" browsing UI in the Assistant panel (see the chat-history deviation above).
- Anthropic's undocumented `x-anthropic-billing-header` OAuth workaround (carried over from Phase
  3's deferred list — still not needed; not revisited this phase).

### Notes (not deviations, just choices made where PLAN.md left room)

- `workspace.example/config.json` gained an `assistant` tab (`{id: 'assistant', panel: 'assistant',
label: 'Assistant', icon: 'icon-02.svg'}`). Without it, the shipped example workspace has no way
  to reach the new panel through the tab strip at all — `KNOWN_PANEL_IDS` already listed `assistant`
  since Phase 2, but no tab in the example data pointed at it. Small, obviously-correct fix rather
  than a redesign; noted per guardrail 11 since it touches a file from an earlier phase.
- The five workspace tools (`read_workspace_file`, `write_workspace_file`, `list_workspace`,
  `update_sprint_task`, `update_agent_status`) all wrap the _same_ `Workspace` singleton instance
  `routes/ws.ts` uses (`server/src/workspace-instance.ts`), not a second instance — so a tool-driven
  write gets identical path guarding, schema validation, atomic-write behavior, and (since the
  shared chokidar watcher watches the same on-disk root) the same debounced SSE `ws-change`
  broadcast as a UI-driven edit, with zero extra plumbing. Tool errors (unknown path, schema
  validation failure, missing file) are caught and returned as a small `{error, issues?}` JSON
  object instead of thrown, so one bad tool call doesn't abort the whole chat turn — the model can
  read the error and retry with corrected input.
- `update_sprint_task`/`update_agent_status` are read-modify-write wrappers implemented directly in
  `chat/tools.ts` (read the file, validate against the shared zod schema, mutate one field, write
  back) rather than new `Workspace` methods — keeps `workspace.ts` itself unchanged (still just
  generic read/write/list/delete) while giving the model single-field-edit tools that can't
  accidentally drop other fields the way a naive `write_workspace_file` patch could.
- `POST /api/chat` uses `stepCountIs(8)` (AI SDK's multi-step tool-loop stop condition) only when
  `workspaceTools: true`; a plain text-only conversation has no `stopWhen`/`tools` at all, which
  keeps the non-tool path's request shape (and its unit tests) simple.
- The web client (`web/src/panels/assistant/useChat.ts`) hand-parses the `data: {...}\n\n`
  UI-message SSE protocol directly off the `fetch` response body, rather than depending on
  `ai`'s React bindings (`ai/react`'s `useChat`). Matches this repo's existing hand-rolled-SSE-client
  convention (`web/src/sse.ts`) and keeps the panel's rendering (markdown, tool-call rows, its own
  scrollback) fully custom rather than shaped around a hook designed for a more generic chat UI.
- `marked` (`^18.0.7`) and `dompurify` (`^3.4.12`) — both already sanctioned by PLAN.md §2's
  dependency table ("Markdown: marked + DOMPurify") — were not yet installed in `web/package.json`
  (only referenced in the table, no panel had used them before this phase). Added now; no
  `@types/dompurify` needed since `dompurify@3.x` ships its own type declarations.
- `panels/assistant/useConnectedProviders.ts` deliberately duplicates a small slice of
  `panels/providers/useProviders.ts`'s fetch-`/api/providers`-and-listen-for-`provider-change`
  logic instead of importing it, per PLAN.md §12 guardrail 10 ("panels must not import from each
  other"). The duplicated logic is ~30 lines and the two hooks return different shapes (all
  providers with full connection metadata vs. just the connected ones' id/name for a picker), so
  there's little to actually share even setting the guardrail aside.
- The Assistant panel's empty state ("Connect a provider to start") deep-links to the Providers tab
  by reading `config.json` (via the standard `useWorkspaceFile` hook, per guardrail 3) and finding
  the tab whose `panel === 'providers'`, falling back to navigating to the literal id `"providers"`
  if no such tab exists — correct even if a user has renamed/reordered their tabs, since the hash
  router navigates by tab id, not panel type.

### Live verification results (guardrail #7)

Ran with real network access; results below are from actually executing the server, Ollama, and
the web app together — not from inspection or mocks. Server booted via `node server/src/index.ts`
against a temp `WORKSPACE_DIR` (seeded from `workspace.example/`) / `AGENT_DASHBOARD_HOME`; web
verified via a throwaway Playwright script against the Vite dev server (both deleted before the
final commit, along with the temp workspace dir, per the build brief).

- **Ollama**: `ollama serve` (`~/.local/bin/ollama`, same binary Phase 3 used) was not running;
  started it for the duration of testing, confirmed 3 real local models (`qwen3:4b`, `qwen3:14b`,
  `nomic-embed-text:latest`), stopped it afterward (`pkill -f "ollama serve"`, verified no
  `ollama`/`llama-server` process or `:11434`/`:4680`/`:5173` listener remained).
- **Connected via the Custom OpenAI-compatible provider** (`baseUrl: http://localhost:11434/v1`) —
  chosen over the dedicated Ollama descriptor because both share the identical
  `createOpenAICompatible(...).chatModel()` `aiSdkFactory` code path, and Custom's `/apikey` route
  round-trip was already the more direct one to drive from `curl`. `POST
/api/providers/custom/apikey` returned `connected: true`, a real `test.ok: true` against the live
  daemon, `modelCount: 3`.
- **Real tool-call round trip #1 (`update_sprint_task`) — the literal Phase 4 acceptance scenario**:
  asked `qwen3:4b` (via `POST /api/chat`, `workspaceTools: true`) to "call the update_sprint_task
  tool right now with taskId 't05' and status 'done'". Observed real `tool-input-available` /
  `tool-output-available` chunks in the response stream naming `update_sprint_task` with the
  correct arguments, **and independently confirmed by reading `sprints.json` off disk myself**
  afterward: task `t05` ("workspace.ts safe read/write") shows `"status": "done"`, all other fields
  (title, assigneeId, order) unchanged — proving the read-modify-write path preserved the rest of
  the document.
- **Real tool-call round trip #2 (`update_agent_status`), with an explicit SSE proof**: with a
  second `GET /api/events` connection open throughout, asked the model to call
  `update_agent_status` for `agentId: "researcher"`, `status: "active"`. Observed a real
  `{"type":"ws-change","path":"agents.json","rev":"8e6b5b31ea7f"}` SSE event fire, **and
  independently confirmed by reading `agents.json` off disk myself**: the researcher agent's
  `status` field is now `"active"`. This directly proves the acceptance criterion's second half
  ("the Sprints data refetches via SSE" — generalized here to whichever workspace file actually
  changed, since Sprints itself has no rendered panel yet per guardrail scope, Phase 5).
- **Streaming is genuinely incremental, not one final blob**: a direct (non-UI) fetch against
  `POST /api/chat` for a short reply captured over 100 individual SSE chunks (reasoning-delta plus
  text-delta) with real, increasing timestamps spread across ~9 seconds of wall-clock time; the
  final answer text alone arrived as 5 separate `text-delta` chunks. In the browser (Playwright),
  the Stop button visibly appeared for the duration of generation and the rendered message updated
  from the empty-state placeholder to the final text once streaming finished, with zero console
  errors. **Honest caveat**: `qwen3:4b` spends nearly all of a short reply's generation time in a
  "thinking"/reasoning phase before emitting any answer text (even with a `/no_think` prompt hint,
  which only partially suppressed it) — our UI intentionally does not render `reasoning-delta`
  chunks (out of this phase's scope), so for this specific small local model the _visible_ text in
  the panel appears in one late, quick burst rather than a slow visible "typewriter" effect, even
  though the underlying protocol delivery is genuinely incremental (proven directly, above). A
  larger/faster or non-reasoning model would visibly "type" in the UI; this is a property of the
  test model, not of the streaming implementation.
- **Stop button/abort actually cancels generation server-side, not just the UI**: started a
  deliberately long generation ("write a very long, 2000 word essay..."), read a few streamed
  chunks, then aborted the client `fetch`'s `AbortController`. Confirmed via `ps -o pid,%cpu,time`
  on the underlying `ollama` `llama-server` subprocess that its cumulative CPU `TIME` stopped
  advancing within a few seconds of the client abort (checked twice, 5s apart, with `TIME`
  unchanged both times while `ELAPSED` kept growing) — i.e. the model genuinely stopped generating,
  not just stopped being read from. This confirms `POST /api/chat`'s `abortSignal: c.req.raw.signal`
  wiring (`@hono/node-server` ties the Fetch `Request.signal` to the real HTTP request's
  abort/close event) does propagate all the way through `streamText` to the underlying provider
  call.
- **Web UI** (Playwright, throwaway script, deleted before commit): Assistant tab reachable from the
  tab strip once `workspace.example/config.json` gained the `assistant` tab entry (see Notes
  above); provider/model pickers populated with the real connected provider and its 3 real Ollama
  models; typing a message and clicking Send started real streaming (Stop button appeared, then
  disappeared once the model finished); the final rendered assistant bubble showed the model's
  actual reply; zero browser console errors across the whole run.

### Testing

- `server/src/chat/tools.test.ts` — all five tools individually, against a temp `Workspace` (Phase
  1's `workspace.test.ts` conventions): read/write/list happy paths, the literal "mark task done"
  scenario with a field-preservation assertion, and structured (non-throwing) errors for unknown
  paths/task ids/agent ids and schema-invalid writes.
- `server/src/chat/history.test.ts` — persistence location (`<appDataDir>/chats`, never the
  workspace), round-trip via `get`/`list`, most-recently-updated-first ordering, the 20-conversation
  cap pruning the oldest by mtime, and conversation-id filename-safety validation.
- `server/src/routes/chat.test.ts` — full route-level integration tests (real Hono app, real
  `Workspace`/`CredentialStore`/`ChatHistoryStore` against temp dirs) with a **local `http` server
  standing in for an OpenAI-compatible endpoint** (real SSE chunks in the exact shape
  `@ai-sdk/openai-compatible` expects, read from its own source before writing the mock) driven
  through the real "custom" provider descriptor's real `aiSdkFactory` — no AI SDK internals are
  mocked, no real paid API is called. Covers: validation (404 unknown provider, 400 not connected,
  400 malformed body), incremental streaming (asserts 2 distinct `text-delta` chunks), chat-history
  persistence on finish, and the full `update_sprint_task` tool-call round trip asserting both the
  SSE-stream-visible tool-call chunks _and_ the resulting on-disk file change.
- `server/src/providers/adapters/google-code-assist.test.ts` /
  `openai-codex.test.ts` — the two custom `LanguageModelV4` adapters' `doGenerate`/`doStream`
  request-building and response-parsing, with a mocked `fetch` (neither OAuth account is available
  to test against for real, per Phase 3's DECISIONS.md — explicitly noted, not silently skipped).
- `npm run check` (typecheck + lint + format + all vitest suites across `shared`/`server`/`web`):
  **green** — 179 tests total (45 shared + 111 server + 23 web), 0 lint errors, 0 format issues.
