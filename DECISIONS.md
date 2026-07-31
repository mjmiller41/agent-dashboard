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

## OAuth research findings (§6a pre-flight, Phase 3 blockers)

Five research tickets (issues #9–#13) verified PLAN.md §6a's first-party OAuth details against current sources. Full request/response shapes are in each closed issue's comments — this is a summary of what changed.

### OpenRouter (#9) — one correction
Key-exchange body must include `code_challenge_method` alongside `code`/`code_verifier` (PLAN.md's table omitted it); omitting it 400s. Authorize URL and base/models endpoints otherwise confirmed correct. Source: openrouter.ai/docs/use-cases/oauth-pkce.

### Anthropic (#10) — two corrections
1. Redirect URI has moved: `https://platform.claude.com/oauth/code/callback` (not `console.anthropic.com`).
2. Scopes expanded from 3 to 6: `org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload`.
Client id (`9d1c250a-e61b-44d9-88ed-5944d1962f5e`) and code-paste/token-exchange mechanics confirmed unchanged. Sources: vendored Claude Code CLI constants files (cross-checked across two independent repos).

### OpenAI (#11) — several corrections
1. Authorize URL needs extra params PLAN.md omitted: `response_type`, `id_token_add_organizations`, `codex_cli_simplified_flow`, `state`, `originator`.
2. `chatgpt-account-id` lives at JWT claim path `payload["https://api.openai.com/auth"]["chatgpt_account_id"]`, not top-level.
3. Mode (a) token-exchange-for-API-key is best-effort and often unavailable — implement mode (b), the Codex backend adapter, as the reliable path, not a rare fallback.
4. Refresh token request is JSON body, not form-urlencoded.
Client id, fixed port 1455, and the two-mode approach otherwise confirmed. Source: `openai/codex` `codex-rs/login/src/{server,pkce}.rs`.

### Google (#12) — one correction, one flag
1. PLAN.md's "PKCE + ephemeral loopback port" describes only one of two flows in gemini-cli source; confirm which flow to implement before coding (see issue #12 for the second flow's details).
Client id/secret (intentionally public, installed-app pattern) and scopes confirmed unchanged. Source: `google-gemini/gemini-cli` `packages/core/src/code_assist/*`, cross-checked against `jenslys/opencode-gemini-auth`.
Still flagged as PLAN.md's highest policy-risk flow — consent modal copy must say so explicitly.

### GitHub Copilot (#13) — several corrections
1. `copilot_internal/v2/token` exchange is `GET` with `Authorization: token <gho_>` (not `POST`/`Bearer`), and also requires `Copilot-Integration-Id`.
2. Response includes `endpoints.api` — use this rather than hardcoding `api.githubcopilot.com`.
3. Token lifetime ~25 min (`refresh_in`/`expires_at`).
4. Chat needs a fuller header set: `Editor-Plugin-Version`, `X-GitHub-Api-Version`, `X-Initiator`, alongside `Editor-Version`/`Copilot-Integration-Id`.
5. Current OSS implementations (opencode, Zed) actually skip the internal-token exchange entirely and send the raw `gho_` token straight to `api.githubcopilot.com` — a viable, simpler fallback worth considering.
Device-flow mechanics and VS Code client id otherwise confirmed against GitHub's official docs (doc path moved to `building-oauth-apps`, not `building-github-apps`).
