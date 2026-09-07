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

## Setup commands

- `bun install` installs the workspace.
- `bun run db:start` starts a local PostgreSQL in Docker on `127.0.0.1:5434`.
- `bun run dev` runs the whole stack (`scripts/dev.ts`): the database is
  created, migrated and seeded, the API takes a free port, and portless serves
  the web app on `https://docstore.localhost`. The dev server proxies `/rpc`,
  `/api`, `/files`, `/health`, `/mcp` and `/api-reference`, so everything sits
  on a single origin exactly like production.
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
  package, or `bun run test` at the root to go through Turbo.
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

- Angular commits: `type(scope): message`, in English, imperative, lower case
  (`feat(api): add the dossier share link`). Scope is the package or domain.
- One commit per coherent unit of work.
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
