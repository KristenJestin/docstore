# Method: from an issue to shipped code

How a need becomes code in this repository. An issue says what is wanted; a framed issue adds the Proposal, Design, Spec and Tasks; tasks are ticked only after their verification ran; the evidence goes on the pull request. Everything lives in the issues and pull requests of this repository; the code holds only code, its documentation and its `AGENTS.md`. Everything is in English.

Every merge into `main` deploys production (the home-infra deploy hook watches `main`). There is no integration branch: the pull request and its checks are the last gate before the server.

## 0. Who does what

- **The maintainer** (Kris, `@KristenJestin`) decides: which issue is retained, the open points, the UI gate, the merge. **Only the maintainer merges.**
- **The framing assistant** (a coding assistant on the maintainer's machine, in conversation with them) writes the Proposal, Design, Spec and Tasks sections with the maintainer, and later reviews the pull request against the Spec.
- **The developer agent** (the Hermes bot `hermes-krisnet[bot]`, or a Claude Code agent) implements a framed issue: branch, commits under the maintainer's identity, pull request, tasks ticked after their verification. It never frames, never merges, never pushes to `main`.

## 1. The issue: the intention

An issue says **what is wanted, where it applies, how we will know it is done**, and what triggered it, with the headings of the issue templates (`.github/ISSUE_TEMPLATE/`). It contains no solution. Its labels say its type (`type:idea`, `type:bug`, `type:debt`, `type:research`) and its area (`area:ingestion`, `area:ocr`, `area:extraction`, `area:rules`, `area:review`, `area:library`, `area:search`, `area:storage`, `area:mcp`, `area:api`, `area:web`, `area:security`, `area:sharing`, `area:deploy`); its milestone says the version that will ship it.

Most issues stay light, in the maintainer's own words: **What I want**, **Where**, **How to work** (the branch, the tests to write first, the verification to run). That is enough for a small, clear change. Full framing (section 2) is for a change that touches several capabilities, a migration, or a rule of the product.

An **exploration** issue asks for options before a decision (two or three layouts, a measurement, a prototype). It is delivered as a **draft** pull request from an `explore/<n>-<topic>` branch, with screenshots or measurements, and it does not change the real behaviour until a variant is chosen. The chosen variant is then built in a normal issue, or on the same branch once the maintainer says so.

### The state of an issue

There is no project board for now (one may be added later). The state is read from the issue itself:

| State | How it reads | Who acts |
|---|---|---|
| Received | open, no `## Proposal` section and no "How to work" section | the maintainer |
| To frame | open, `## Proposal` present, `## Decided` still empty | framing assistant, then maintainer |
| Framed | open, `## Decided` filled (or a light issue with its "How to work"), no linked pull request: the queue the developer agent picks from | developer agent |
| In progress | a linked pull request exists (draft, then ready); **at most three at a time** | developer agent, then the maintainer on the pull request |
| Done | pull request merged (`Closes #<n>` closes the issue), or abandonment said in a comment | |

## 2. Proposal, Design, Spec: three sections of the issue

At framing time, the framing assistant adds **three sections** to the issue, under the intention, with the exact headings of [`docs/templates/framing.md`](templates/framing.md):

- **Proposal**: Why, What changes, Capabilities touched, Impact (packages, migrations, tests), and the points to decide with one recommendation each. The maintainer decides; the assistant records the decision in a "Decided" section.
- **Design**: the numbered decisions `D<n>-01`, `D<n>-02`… (`<n>` is the issue number) with their reason and the alternative set aside. This is what the code cites in comments.
- **Spec · <capability>** (one per capability): requirements `Docstore SHALL …` with their scenarios `WHEN … THEN …`. **Every scenario becomes a test named after it.** A scenario without a test is a defect.

These sections are the truth of the change; the code conforms to them, and if a section is wrong it is said in a comment instead of silently deviating.

**The issue carries the spec it needs.** The functional spec of the product lives outside the repository (`../docs/SPEC.md`, in French, on the maintainer's machine). Agents running elsewhere (Hermes on the server) do not have that file. A framed issue therefore quotes, in English, every rule of `SPEC.md` it relies on; "see SPEC.md" alone is not enough.

## 3. The tasks: checklists in the issue

One task list per phase, as laid out in [`docs/templates/framing.md`](templates/framing.md), one item per task, each item naming its **verification** ("…; check `bun run test` green and scenario X"). **An item is ticked only after its verification ran and its output was seen.**

- **Phase 0 · UI first** (only when the change has a UI): the screens and states in `apps/web`, on fixtures or the demo library, before any new service. The developer agent pushes the branch, opens a **draft pull request** into `main` whose description already says `Closes #<n>`, attaches screenshots of `https://<branch>.docstore.localhost` (both themes, the empty, loading and error states), and mentions the maintainer. The maintainer validates in a comment; phase 1 waits for that validation.
- **Phase 1 · Services, database, API**: schema and migration (`packages/db`), pure services (`packages/api/src/services`, `packages/rules`, `packages/ingestion`), routers and Zod schemas (`packages/shared`). One test per Spec scenario.
- **Phase 2 · Wiring, MCP, end-to-end**: the web app on the real API, the MCP tools (`packages/mcp`, `docs/mcp.md`), the ingestion pipeline and workers, Playwright for the critical paths.
- **Phase 3 · Acceptance**: the full verification, the docs updated, the pull request ready.

The verification of every phase is at least:

```sh
bun run check && bun run check-types && bun run test
```

`bun run test` needs PostgreSQL (`bun run db:start`) and a filled `apps/server/.env`.

## 4. The evidence: on the pull request

The real outputs (the verification command, end-to-end, screenshots) are **pasted or attached to the pull request**; a comment sums up what ran and what did not. What was not run is said, never assumed. **A verification not run is "not verified"**, not green.

## 5. Delivery

- **One issue, one branch, one worktree.** A framed issue gets `feat/<n>-<topic>`, `fix/<n>-<topic>` or `explore/<n>-<topic>`, from `main`, in a worktree of its own: `bun run wt <branch>` (its own URL `https://<branch>.docstore.localhost`, database, storage and port). Housekeeping without an issue (`chore/…`, `docs/…`, `ci/…`, `build/…`) follows the same rule.
- **Commits**: Angular `type(scope): subject`, scope required, types `feat fix refactor test docs chore build ci perf`, subject at most 72 characters, lowercase, no trailing period. Lefthook checks each commit (`commit-msg`) and refuses any commit on `main` (`pre-commit`); CI checks the whole range.
- **The pull request is opened once**, into `main`, with `Closes #<n>` in its description; it is the only pull request of the issue. The `pull-request` check is red without `Closes #<n>` (except `ci`, `docs`, `chore` and `build` titles), and it copies the issue's labels and milestone onto the pull request and asks the maintainer for a review. Its title is a plain Angular subject: it becomes the squash commit on `main`.
- **Every push leaves the checks green** (`commit-messages`, `check`, `pull-request`). A push that does not is followed by the push that fixes it, before anything else.
- **Squash merge only, by the maintainer only.** The branch is deleted on merge; `bun run wt:remove <branch> --yes` removes the worktree and its database.
- **Releases stay manual.** There is no semantic-release: the version in `package.json` is bumped by hand (`bun run sync-version` propagates it), and a milestone groups what a version ships.

## 6. How the developer agent works

- **At the start of every run**, the agent reads the issue with all its comments, this file and `AGENTS.md`, and the comments of the pull request since its last run; a review is answered point by point, in the order given.
- **Nothing is done outside the issue's worktree**, and nothing of that issue is done elsewhere.
- **One run at a time per repository.** A second request on this repository waits until the current run has ended; it is never started beside it. Two runs on one branch is a defect.
- **At most three issues in progress.** A fourth waits.
- **Sub-agents inherit the identity.** Every worktree, every sub-agent, commits as the maintainer: `kris <kristen.jestin@pm.me>`, author and committer. A commit under any other identity is rewritten before it is pushed.
- **A branch is rewritten only while the pull request is a draft**, and the rewrite is said in a comment. Once the pull request is ready, the branch only grows.
- **Never** push to `main`, merge a pull request, bypass the hooks (`--no-verify`), or disable signing.

## 7. The documents

- [`README.md`](../README.md) describes the product; [`docs/`](.) holds the technical references (`ingestion.md`, `document-types.md`, `mcp.md`, `security.md`); `AGENTS.md` is the working agreement for agents.
- A change that alters a documented behaviour edits the document in the same pull request and says so in the issue.
- An issue names in "References" the documents it needs, and quotes what it needs from `../docs/SPEC.md`.
