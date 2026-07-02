# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**karrierenmin.no** — a Norwegian career/job-search platform. Users upload a CV, get AI-extracted
"career atoms" (skills/experience evidence), match against job opportunities (NAV, Careerjet),
generate cover letters, and research employers (company financials, reviews, AI-generated reports).
There's also a public-facing "arbeidsgiveranalyse" (employer analysis) product with its own PDF
report pipeline, and a standalone Claude Skill (`employer-analysis`) built from the same domain logic.

Most UI copy, routes, and domain content are in **Norwegian (Bokmål)**. Keep new user-facing strings
and Norwegian doc files in Norwegian; code identifiers/comments are in English.

## Tech stack

- **TanStack Start** (React 19 + TanStack Router, file-based routing) as the full-stack framework
- **Vite 7** build, config wrapped by `@lovable.dev/vite-tanstack-config` (see note in `vite.config.ts` —
  do not re-add plugins it already provides: tanstackStart, viteReact, tailwindcss, tsConfigPaths,
  cloudflare, componentTagger, env injection, `@` alias, etc.)
- **Cloudflare Workers** deployment target (`wrangler.jsonc`), entry at `src/server.ts` which wraps the
  TanStack server entry to catch h3's swallowed SSR errors and render a branded 500 page
- **Supabase** (Postgres + Auth + Storage + Edge Functions) as the backend, via `@supabase/supabase-js`
- **Tailwind CSS v4** + shadcn/ui (`components.json`, style "new-york") for UI, Radix primitives
- **Bun** is the package manager (`bun.lock`, `bunfig.toml`); a `package-lock.json` also exists but bun
  is canonical
- **Vitest** for TS unit tests, **Deno** tests (`_test.ts` files) for Supabase Edge Functions

## Commands

```bash
bun install          # install deps
bun run dev           # vite dev server
bun run build         # production build
bun run build:dev     # dev-mode build
bun run preview       # preview a build
bun run lint           # eslint .
bun run format          # prettier --write .
```

There is no `test` script in `package.json`. Run Vitest directly:

```bash
bunx vitest run                              # all TS unit tests (*.test.mts under src/)
bunx vitest run src/lib/__tests__/score-parser.test.mts   # single file
bunx vitest run -t "clamps 101"              # single test by name
```

Supabase Edge Function tests (`supabase/functions/**/*_test.ts`) are Deno tests, run from the
function's own runtime — not part of the Vitest suite:

```bash
deno test supabase/functions/analyze-company/analysis-v2_test.ts
```

No CI workflow is configured in this repo (`.github/` has no workflow files) — linting/tests are run
locally / by the agent before pushing.

### Building the Claude Skill

`skill-src/employer-analysis/` is the source for a standalone Claude Skill. It is packaged into a
`.skill` zip and base64-embedded into `src/server/skill-bundle.ts` (a generated file — don't hand-edit):

```bash
node scripts/build-skill.mjs   # also runs skill-src/employer-analysis/tests/test_language_consistency.py if python3 is available
```

Bump the `version:` in `skill-src/employer-analysis/SKILL.md` frontmatter before rebuilding, and record
the change in `skill-src/employer-analysis/CHANGELOG.md`.

## Architecture

### Routing

File-based routes live in `src/routes/`, compiled by the TanStack Router Vite plugin into
`routeTree.gen.ts` (generated — don't edit, don't hand-format, it's gitignored from prettier).

- `src/routes/_authenticated.tsx` — layout + `beforeLoad` auth guard (redirects to `/login` if no
  Supabase session) wrapping everything under `src/routes/_authenticated/**`. This is the logged-in
  app shell (dashboard, career, applications, admin, etc.), rendered inside `AppSidebar`.
- Top-level routes (`index.tsx`, `login.tsx`, `signup.tsx`, `markedsinnsikt.tsx`,
  `selskapsanalyse.*`, `arbeidsgivere.*`, `rekruttererundersokelse.*`) are public/marketing/SEO pages —
  they carry their own `head()` metadata (canonical/OG tags) and must stay reachable without login.
  Note the deliberate split: `markedsinnsikt.tsx` (public) vs. `_authenticated/marked.tsx` (logged-in,
  renders the same `CareerExplorer` component) — don't merge these, they have different auth/SEO needs.
- `admin.*.tsx` routes are gated further by `requireAdmin()` (`src/lib/admin-guard.ts`), which checks
  the `has_role` RPC with a direct `user_roles` table fallback.
- `src/routes/api/**` are server-only API routes (e.g. `api/public/ingest-report.ts` for the Skill's
  report submission, `selskapsanalyse/preview-email.ts`, `selskapsanalyse/download.ts`).

### Server functions vs. client/server Supabase clients

- `src/lib/*.functions.ts` — TanStack Start `createServerFn` server functions (e.g.
  `leads.functions.ts`, `admin.functions.ts`, `nav-sync.functions.ts`, `careerjet-sync.functions.ts`,
  `recruiter-survey.functions.ts`). These run server-side only, validate input with `zod`, and are the
  place for privileged operations (using `supabaseAdmin`, sending email, calling RPCs with the service
  role).
- `src/integrations/supabase/client.ts` — browser/SSR client using the **anon/publishable key**,
  subject to RLS. Import as `supabase`.
- `src/integrations/supabase/client.server.ts` — **service-role** client that bypasses RLS. Import as
  `supabaseAdmin`. Server-only — never expose to client bundles.
- `src/integrations/supabase/auth-middleware.ts` and `src/integrations/supabase/types.ts` are
  **auto-generated** ("This file is automatically generated. Do not edit it directly.") — regenerate
  via Supabase tooling rather than hand-editing.
- `src/integrations/market-supabase/client.ts` — a **second, separate Supabase project** (ESCO
  labor-market data, project ref `wcaqfupjatnjwbgatzjv`) used only for market/career-explorer data. Its
  anon key is intentionally public (publishable JWT). Don't confuse this with the main app's Supabase
  project (`SUPABASE_PROJECT_ID` / `miwzhbludgwvskmsfqnq`).
- ESLint enforces the `*.server.ts` (or `@tanstack/react-start/server-only`) convention — importing the
  `server-only` npm package is a lint error; rename the module instead.

### Supabase backend

- `supabase/migrations/` — plain numbered SQL migrations (timestamp-prefixed). Recent ones favor
  hand-named files (e.g. `20260630_admin_ingestion_status_fast_path.sql`) over UUID-suffixed
  autogenerated names from the Supabase UI.
- `supabase/functions/` — Deno Edge Functions, one directory per function, each with `index.ts`.
  `supabase/functions/_shared/` holds cross-function code, notably `cv-evidence-graph/` (CV parsing →
  evidence graph types/crud/validators/converters used by multiple functions).
  `supabase/config.toml` sets `verify_jwt` per function — functions handling cron/webhook calls (e.g.
  `sync-nav-opportunities`, `sync-careerjet-opportunities`, `regnskap-sync`) disable JWT verification
  and do their own auth in code (caller JWT check, `has_role`, or a shared cron secret header).
- `scripts/canary/*.sql` — read-only-safe verification scripts (wrapped in `BEGIN;`/rollback, using
  `pg_temp.must()` assertions) used to sanity-check a migration/RPC contract after deploying — not part
  of an automated test runner, run manually against the target DB.
- `scripts/*-cron.sql` — cron job definitions for the sync functions (regnskap-sync, careerjet-sync).
- `supabase-setup.sql` at the repo root is a one-off/bootstrap script, separate from `supabase/migrations/`.

### Career atoms / documents / matching domain

Core domain concepts live mostly under `src/lib/`:
- **Career atoms** (`career-atoms.ts`, `career-atom-refresh.ts`, `target-atoms.ts`,
  `target-atom-extraction.ts`, `target-atom-refresh.ts`, `atom-explicit-writes.ts`,
  `atom-review-proposal-copy.ts`) — structured evidence extracted from a user's CV/profile, matched
  against job/company "target atoms".
- **Match assessment** (`match-assessment-model.ts`, `should-apply.ts`, `career-match-dimensions.ts`) —
  scoring a user against an opportunity.
- **Employers** (`src/lib/employers/`, `src/components/employers/`, `src/components/selskapsanalyse/`) —
  company research, ratings, the "selskapsanalyse" (company analysis) report product.
- `src/lib/queries/` — TanStack Query hooks/helpers, one file per domain area (companies, applications,
  cv-imports, employer-analysis-view, match-assessments, user-career-profile, etc.) — the standard place
  to add a new data-fetching hook.
- `src/lib/email/`, `src/lib/email-templates/` — transactional email (React Email components +
  server-side send via `send-internal.server.ts`).

### UI components

- `src/components/ui/` — shadcn/ui primitives (generated via the shadcn CLI per `components.json`;
  treat as vendored, prefer composing over heavily editing).
- Feature folders under `src/components/`: `admin/`, `career/`, `cv-upload/`, `documentation/`,
  `employers/`, `landing/`, `market/` (incl. `market/career/`), `recruiter-survey/`, `selskapsanalyse/`.
- Path alias `@/*` → `src/*` (see `tsconfig.json` and `components.json` aliases).

### Error handling

`src/server.ts` wraps every request: if TanStack's h3-based server entry throws inside a handler, h3
often swallows it into a generic 500 with body `{"unhandled":true,"message":"HTTPError"}` instead of
propagating the real error. `normalizeCatastrophicSsrResponse` detects that exact shape and replaces it
with a branded error page (`src/lib/error-page.ts`), while `src/lib/error-capture.ts` captures the last
real error for logging. Don't "fix" this by removing the wrapper — it's compensating for a known h3
behavior, not incidental complexity.

## Conventions

- **Two-track development**: frontend/UI work is largely done through **Lovable** (commits authored by
  `gpt-engineer-app[bot]`, typically terse messages like "Changes"); backend/Supabase work (migrations,
  Edge Functions, RPC contracts, cron) is done on `codex/*` branches and merged via PR. `docs/lovable-*.md`
  files are **handoff specs written for Lovable** describing a backend contract already shipped — treat
  them as historical context for what the frontend should call, not as instructions to re-implement
  the backend.
- Norwegian-language SQL comments and doc files are normal in this codebase (e.g. canary scripts,
  `docs/lovable-*.md`) — keep new ones consistent with that register when they concern
  Norwegian-specific domain logic (BRREG, NAV, regnskap).
- `.lovable/plan.md` and `.lovable/project.json` are Lovable's own planning/scaffolding metadata, not
  something to hand-maintain.
- Prettier: 100 col width, double quotes off (`singleQuote: false` → actually uses double quotes),
  trailing commas everywhere, semicolons on. Run `bun run format` rather than hand-formatting.
- `bunfig.toml` enforces a 24h supply-chain guard on new package versions
  (`minimumReleaseAge`); only `@lovable.dev/vite-tanstack-config` is excluded. Adding another exclusion
  needs explicit user confirmation.
- Auto-generated files — do not hand-edit: `routeTree.gen.ts`, `src/integrations/supabase/types.ts`,
  `src/integrations/supabase/auth-middleware.ts`, `src/server/skill-bundle.ts`.
