# Framing skeleton

What the framing assistant appends to an issue when it is retained for framing ([`docs/METHOD.md`](../METHOD.md), section 2): exactly these headings, in this order, under the intention that is already there. Nothing is coded before the maintainer has decided the open points and the `## Decided` section is filled.

```markdown
## Proposal

### Why
<!-- What is missing today and why this issue, now. 3-8 sentences. -->

### What changes
<!-- Bullets: what the user gets, surface by surface (web, API, MCP, ingestion). Outcomes, not implementation. -->

### Capabilities
<!-- New: `<capability>`. Modified: `<capability>`. Unchanged but touched: `<capability>`. -->

### Impact
<!-- Packages, migrations, tests, documents to edit. One line each. -->

### Spec references
<!-- The rules of ../docs/SPEC.md this change relies on, quoted in English. Agents do not have that file. -->

### Points to decide
<!-- One bullet per point: the options (a), (b), (c) and a recommendation. The maintainer answers in a comment. -->

## Design

- **D<n>-01 · <title>.** <the decision, its reason, and the alternative set aside>
- **D<n>-02 · <title>.** …

## Spec · <capability>

### Requirement: <name>
<!-- "Docstore SHALL …" sentences. -->

#### Scenario: <name>
- **WHEN** …
- **THEN** …

<!-- One `## Spec · <capability>` section per capability. Every scenario becomes a test named after it. -->

## Decided
<!-- Filled after the maintainer's comment: one bullet per point, what was decided, on which date. -->
```

Then the **task lists**, one per phase, as GitHub task lists in the issue body (or one comment per phase), each item naming its verification:

```markdown
## Tasks

### Phase 0 · UI first (only when the change has a UI)
- [ ] <screen or component in apps/web>: every state (empty, loading, error, filled), both themes; check `bun run check-types` green
- [ ] Branch pushed, **draft pull request** into `main` with `Closes #<n>`, screenshots of `https://<branch>.docstore.localhost` attached, comment mentioning the maintainer
- [ ] UI gate: the maintainer validates the screenshots (or the running worktree) and says so in a comment

### Phase 1 · Services, database, API
- [ ] <schema, migration, service, router>; one test named per scenario of the Spec; check `bun run test` green

### Phase 2 · Wiring, MCP, end-to-end
- [ ] <web on the real API, MCP tools, pipeline>; Playwright for the critical paths; check `bun run test:e2e` green from the worktree

### Phase 3 · Acceptance and delivery
- [ ] `bun run check && bun run check-types && bun run test` green, output pasted in the pull request
- [ ] Docs updated (`README.md`, `docs/*.md`) where a documented behaviour changed
- [ ] Pull request ready (Angular title, `Closes #<n>`), what was not verified said as such
```

Rules that do not bend: a task is ticked only after its verification ran and its output was seen; a verification not run is "not verified"; a scenario without a test is a defect; if a section is wrong, say it in a comment instead of deviating; the maintainer merges, the agent never does.
