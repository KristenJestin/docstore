# AGENTS.md: docstore v2

## Project overview

Self-hosted document management for a personal or family archive. Read
[`README.md`](README.md) for what the product does; this file is the working
agreement for coding agents.

Functional spec: `../docs/SPEC.md` (outside the repository, in French). Read the
sections you are about to touch before writing code.

Stack: Bun · Turborepo · Hono + oRPC (`packages/api`) · Drizzle + PostgreSQL
(`packages/db`) · Better Auth (`packages/auth`) · TanStack Start + React
(`apps/web`) · shadcn on Base UI (`packages/ui`) · Tailwind v4 · Biome (tabs,
double quotes).

## Tickets and Git workflow

Work starts from a GitHub issue. The full method (roles, framing, phases,
evidence) is [`docs/METHOD.md`](docs/METHOD.md); this is the summary.

- **Before touching code, read the issue with all its comments,
  `docs/METHOD.md` and this file.** On a pull request that already exists,
  also read its comments since your last run and answer a review point by
  point.
- Roles: Kris (the maintainer) decides and merges; the framing assistant writes
  the Proposal, Design, Spec and Tasks in the issue and reviews the pull
  request against the Spec; the developer agent (`hermes-krisnet[bot]` or a
  Claude Code agent) implements framed issues.
- `../docs/SPEC.md` is not available to every agent: a framed issue quotes, in
  English, the rules of the spec it needs. Work from the issue.
- **Main only. Every merge into `main` deploys production.** One issue = one
  branch = one worktree: `feat/<n>-<topic>`, `fix/<n>-<topic>` or
  `explore/<n>-<topic>` from `main`, created with `bun run wt <branch>`.
  Housekeeping without an issue uses `chore/<topic>`, `docs/<topic>`,
  `ci/<topic>` or `build/<topic>`.
- **Never commit or push on `main`, never merge a pull request.** Only Kris
  merges, by squash only. The Lefthook `pre-commit` hook refuses a commit on
  `main` (`scripts/branch-guard.ts`).
- One pull request per issue, into `main`, opened once (as a draft when a UI
  gate or an exploration comes first), with `Closes #<n>` in its description.
  The `pull-request` check requires it (except `ci`, `docs`, `chore`, `build`
  titles) and copies the issue's labels and milestone. Exploration issues are
  delivered as draft pull requests with screenshots or measurements.
- Verification before every push:
  `bun run check && bun run check-types && bun run test`. Paste what ran in the
  pull request; a verification not run is "not verified", never green.
- Tests are named after the Spec scenarios they cover.
- At most three issues in progress; one agent run at a time per repository.
- Git identity for every commit, including sub-agents and worktrees:
  `kris <kristen.jestin@pm.me>`.
- Issues, pull requests and commits are in English.
- Releases stay manual: no semantic-release, the version in `package.json` is
  bumped by hand.

## Setup commands

- `bun install` installs the workspace.
- `bun run db:start` starts a local PostgreSQL in Docker on `127.0.0.1:5434`.
- `bun run dev` runs the whole stack (`scripts/dev.ts`): the database is
  created, migrated and seeded, the API takes a free port, and portless serves
  the web app on `https://docstore.localhost`. The dev server proxies `/rpc`,
  `/api`, `/files`, `/d/`, `/health`, `/mcp` and `/api-reference`, so
  everything sits on a single origin exactly like production.
  `--no-portless` falls back to `http://localhost:3001`.
- `bun run dev:server` / `bun run dev:web` start the raw servers (`:3000` /
  `:3001`), without the proxy.
- `bun run db:reset --yes` drops, recreates, migrates and seeds the database of
  the current checkout.
- `bun run db:demo [--reset]` fills that database with the generated demo
  library (parties, document types, ~50 PDFs ingested through the real
  pipeline). Login: `camille@example.com`.
- Schema push: `cd packages/db && bunx drizzle-kit push`. Do not go through
  `bun run db:push`, because Turbo swallows the interactive prompt.

## Worktrees

A worktree is a fully isolated environment: its own URL, database, storage
folder and API port. `bun run wt <branch>` creates it
(`../docstore-v2.worktrees/<branch>`, copies `apps/server/.env`, runs
`bun install`); `bun run wt:remove <branch> --yes` deletes it and drops its
database.

An agent working in a worktree runs `bun run dev` from that worktree. It gets
`https://<branch>.docstore.localhost` and the `docstore_wt_<slug>` database. It
never touches the main checkout's servers (ports 3000/3001) or the `docstore`
database.

## Code style

- TypeScript strict, no `any`. Zod schemas shared between the API and the front
  end live in `packages/shared`.
- One oRPC router per domain in `packages/api/src/routers/<domain>.ts`,
  `protectedProcedure` by default.
- Business logic goes into pure services (`packages/api/src/services/`),
  testable without HTTP.
- Never put logic in the UI components of `packages/ui`: they are reusable
  primitives. Application components belong in `apps/web/src/components/`.
- Tailwind: theme values only (spacing, colours through the shadcn CSS
  variables). No arbitrary values such as `[123px]`. If a pattern shows up more
  than twice, turn it into a component or a `cva` variant.
- Before creating a shared component (list, page header, empty state,
  confirmation dialog, form), look for an existing one in
  `apps/web/src/components/`.
- Paths to external tools come from environment variables (`TESSERACT_PATH`,
  `POPPLER_PATH`) and are never hardcoded.
- Every user-visible string is in English: UI, API error messages, MCP
  descriptions and messages, and the docs in `docstore-v2/docs`. So are the
  code, the comments and the commit messages. Only `../docs/*.md` and
  `../JOURNAL.md`, both outside the project, are in French.
- `bun run check` (Biome, lint + format with auto-fix) must be clean before any
  commit; a Lefthook pre-commit hook enforces it.

## Testing instructions

- Unit tests: `*.test.ts` next to the code, `bun:test`. Run `bun test` in a
  package, or `bun run test` at the root to go through Turbo (it also runs
  the tests of `scripts/`).
- API integration tests use one test database per package. `createTestDb()`
  derives the name from `TEST_DB_SUFFIX`, or from the current package name
  (`docstore_test_api`, `docstore_test_server`…), and creates it on the fly
  through a maintenance connection on `postgres` before migrating. Only the
  database name changes: host and credentials come from `DATABASE_URL_TEST`.
  Tables are truncated between tests.
- That isolation is what makes `bunx turbo run test --filter='!web'` work in
  parallel: with a shared database, concurrent `truncate … cascade` statements
  blocked each other.
- E2E: Playwright in `apps/web/e2e/`, critical paths only. Every run carries a
  unique prefix (`e2e-<runId>-`, helpers `runName` / `runSlug` in
  `e2e/helpers/cleanup.ts`): `globalSetup` creates an admin API key and
  `globalTeardown` deletes, through `/rpc`, everything carrying that prefix
  (documents, dossiers, types, tags, categories, parties, automations, links).
  From a worktree, run them with
  `E2E_BASE_URL=https://<branch>.docstore.localhost`.
- `bun run check-types` runs `tsc` across every package. It must be green.
- Visual drives: the `agent-browser` CLI with a named session
  (`agent-browser --session <name> …`), never an embedded browser.
- Fix every test and type error before handing work over, and add or update the
  tests covering what you changed.

## Commit and PR conventions

- Angular commits: `type(scope): subject`, in English, imperative, lower case
  (`feat(api): add the dossier share link`). The **scope is required**: the
  package or domain (`api`, `web`, `db`, `ingestion`, `mcp`, `rules`…). Types:
  feat, fix, refactor, test, docs, chore, build, ci, perf (no `style`). The
  subject line is 72 characters at most (a trailing ` (#n)` from a squash is
  not counted) and has no trailing period. The Lefthook `commit-msg` hook runs
  `scripts/commit-message.ts`; `bun scripts/commit-message.ts --range
  origin/main..HEAD` checks a branch before a push, and the `commit-messages`
  CI job runs the same tool.
- One commit per coherent unit of work.
- The pull request title is a plain Angular subject: it becomes the squash
  commit on `main`. Fill in the pull request template (what ran, what did not).
- `bun run check`, `bun run check-types` and the affected tests must pass before
  committing.
- Never bypass the hooks (`--no-verify`) and never disable signing.

## Security notes

- Sensitive documents are encrypted at rest (AES-256-GCM, per-object derived
  key) and hidden from MCP unless the key carries the `sensitive` scope.
- Stored secrets (IMAP passwords, share tokens) are encrypted with a key derived
  from `APP_SECRET`, which cannot be rotated. Never log a decrypted secret, an
  API key (`dsk_…`) or a share token.
- `.env` files are never committed; only `apps/server/.env.example` and
  `docker/.env.example` are versioned.
- API keys are scoped (`read`, `write`, `sensitive`, `admin`). Keep
  `protectedProcedure` as the default and justify every public procedure.
- Threat model and what it does not cover:
  [`docs/security.md`](docs/security.md).
