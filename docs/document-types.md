# Document types

A document type is the object for "the same document we keep receiving":
*Payslips from Atelier Bellecombe*, *EDF electricity bills*, *Car insurance
certificate*. It replaced and absorbed the former Series (iteration 8, SPEC §9).

A category says what kind of document it is (`Payslip`) and carries the
expected fields. A type says *whose* it is: the issuer, the tags, the title
template, the page layouts and their extraction rules.

## 1. What a type carries

| Part | Columns | Applied to a document as |
| ---- | ------- | ------------------------ |
| Identity | `name`, `description`, `icon`, `color` | — |
| Classification | `category_id` | `document.category_id` + `category_source`/`category_confidence` |
| Parties | `issuer_party_id`, `subject_party_id` | a `document_party` row per role |
| Tags | `tag_ids[]` | one `document_tag` row per tag |
| Sensitivity | `sensitive_default` | raises `document.sensitive` (never lowers it) |
| Paper original | `paper_original` | hands out an archive number (see "Archive numbers") |
| Title | `title_template` | rewrites the title **while it still is the one derived from the filename** (see §3) |
| Detection | `detection`, `detection_confidence` | see §5 |
| Recurrence | `periodicity`, `start_period`, `end_period`, `expected_day`, `grace_days` | see §2 |
| Order | `priority`, `enabled` | detection order (ascending) |

The assignment itself is stored on the document: `document_type_id`,
`document_type_source` (`manual` / `rule` / `mcp`), `document_type_confidence`
and `layout_id`, exactly like the category and the Party links.

An automatic application (`source` other than `manual`) never overwrites a
category set by hand, and never clears an existing Party link.

### Archive numbers

An ASN (archive serial number) ties a document to the sheet filed under the
same number in the binder. It is usually handed out by hand, with **Assign
next** on the document; two things can hand it out on their own.

- The **Paper original** switch of a type (`paper_original`). Whichever path
  applies the type — automatic detection, a rule, a manual assignment, a bulk
  action or MCP — the document gets the next free number.
- The **Automatic ASN** setting (`asn.autoAssign`, Settings → General):
  `Never` (default), `Always`, or `Scans only` — the documents whose text had
  to be recognised, that is those arriving as a scan or a photograph rather
  than with a PDF text layer.

The two combine with an `or`, and both stop short of the same three cases: a
document that already carries a number keeps it, and a document in the trash or
one the pipeline gave up on is never numbered. `document.asn_source` records
who handed the number out (`manual` or `auto`); the interface shows an *auto*
badge next to the number, and `get_document` reports it over MCP.

## 2. Recurrence

Filling in the recurrence block turns the type into what a Series used to be.

- `periodicity`: `weekly`, `monthly`, `quarterly`, `semiannual` or
  `yearly`. A half-year runs from 1 January to 30 June, then from 1 July to 31
  December.
- `start_period` is snapped to the first day of its period (Monday for a week).
- `end_period` is optional: an open recurrence keeps looking for the next
  period.
- `expected_day` is the expected day of arrival: a day of the month, or an ISO
  weekday (1 = Monday) for `weekly`. Without it, the last day of the period is
  used.
- `grace_days` (15 by default) absorbs the usual lateness before a period is
  declared missing.

Period keys read as `2026-W09`, `2026-03`, `2026-Q1`, `2026-H1`, `2026`.

Members are never stored. They are recomputed from:

1. the documents carrying the type (`document.document_type_id`);
2. the documents matching both the issuer and the category of the type (subtree
   included), which is what keeps the migrated Series working without touching
   their documents. A type with neither issuer nor category only collects the
   documents explicitly assigned to it;
3. minus/plus the `document_type_override` rows (`included` = `false` excludes,
   `true` forces).

The period of a document is its `period_start`, falling back to its
`document_date`. One document per period: the oldest wins. A period is
`present`, `missing` (its due date, expected date + `grace_days`, has passed)
or `pending`.

Missing periods produce `period_gap` reminders (`reminder.generate`), and feed
`documentType.get().timeline` and `documentType.list().stats`.

A member older than `start_period` belongs to the type but falls outside the
window the timeline enumerates, so nothing would ever show it.
`documentType.get().outOfRange` lists those documents (`{ documentId, title,
period, periodStart }`, oldest first), so the interface can offer to widen
`start_period` or to exclude them.

`documentCount` counts what the type page lists: the documents carrying the
type, plus the ones forced in by an override, minus the excluded ones and the
ones sitting in the trash.

## 3. Titles

A type owns the name of its documents. `title_template` is rendered by the same
engine as the `set_title` rule action, with two tokens only a type can fill:

| Token | Renders |
| ----- | ------- |
| `{type}` | Name of the document type |
| `{period}` | Period key of the recurrence: `2026-03`, `2026-Q1`, `2026-H1`, `2026`. Without a recurrence, the covered range |
| `{period:MMMM yyyy}` | First day of the period, month spelled out: "March 2026", "mars 2026" |
| `{period:MMMM}`, `{period:MMM}` | Month alone, spelled out or shortened: "March" / "Mar", "mars" / "mars" |
| `{period:MMMM yyyy|fr-FR}` | Same, in a language chosen for this token alone: "mars 2026" |
| `{period:yyyy-MM}` | Same, as `2026-03` |
| `{date}`, `{date:YYYY-MM}`, `{date:YYYY}`, `{date:MMMM yyyy}` | Document date |
| `{issuer}`, `{subject}`, `{category}`, `{title}`, `{filename}`, `{ext}` | As in the rules |

A placeholder with nothing to fill it becomes an empty string, and the orphaned
separators are cleaned up afterwards. The period comes from the anchor date of
the document — `period_start` falling back to `document_date` — snapped to the
period of the recurrence, so a payslip dated 17 March 2026 renders
`March 2026` on a monthly type and `January 2026` on a half-yearly one.

Month names are written in the **content language** (`content.locale`,
Settings → General): `en-GB` by default, `fr-FR` for a French household, which
names the same payslip "mars 2026". The setting covers everything the
application generates — titles, exported file names, the dates in
`manifest.csv` and in a `reminder.due` payload — and nothing the interface
itself says, which stays in English.

A single token can override it, with the language after a pipe:
`{period:MMMM yyyy|fr-FR}` always reads "mars 2026" and `{date:MMMM|en-GB}`
always reads "March", whatever the setting says. An unrecognised language is
ignored and the token falls back to the setting.

A **new recurring** type starts with `{type} {period:MMMM yyyy}`, so its
documents come out named after the period they cover ("EDF invoice March 2026").
A one-off type keeps an empty template and never touches a title. Passing
`titleTemplate` explicitly — `null` included — always wins over that default.

Applying a type only rewrites the title **while it still is the one derived from
the filename**, and never when `title` sits in `manual_fields`.

### Rewriting titles after the fact

Changing a template does not rename anything on its own:

- `documentType.previewTitles({ id, limit })` renders the titles the template
  would give the members of the type, most recent period first, without writing:
  `{ documentId, currentTitle, title, manual }`. `title: null` means the
  template renders nothing for that document. The interface shows five of them
  in the confirmation of "Regenerate titles";
- `documentType.regenerateTitles({ id, overwriteManual? })` writes them and
  returns `{ updated, skipped }`. `skipped` covers three cases: a title in
  `manual_fields` (unless `overwriteManual` is set), a template that renders
  nothing, and a title already equal to what the template produces. The rewrite
  never marks the title manual, so running it again stays idempotent;
- `document.bulk({ action: { type: "regenerateTitle" } })` does the same for an
  arbitrary selection, each document using the template of the type **it**
  carries. A document without a type, or whose type has no template, is skipped.

Both procedures answer `BAD_REQUEST` on a type without a template. The MCP tool
`regenerate_titles` exposes the same thing, with `dryRun` for the preview.

## 4. Layouts

Every type always has at least one layout. `documentType.create` opens one
named "Default" (`is_default = true`, no signature, no date range), and
`removeLayout` refuses to delete the last one (`BAD_REQUEST`). Deleting the
default one while others remain promotes the next layout to default.

The flag moves: `documentType.setDefaultLayout({ id })` hands it to another
layout of the same type and demotes the current one, so the fallback can be
chosen without deleting the layout that holds it (and its extraction rules).
The default layout is also an ordinary member of the evaluation order —
`reorderLayouts` moves it up and down like any other.

Beyond that, a type may have several layouts: the same payslip, reworked in
2024. A layout carries a name, an optional date range (`valid_from`,
`valid_until`), an optional signature (a rule condition tree) and its own
extraction rules (`extraction_rule.layout_id`).

Selection order, when a type is applied:

1. `forced`: the caller passed a `layoutId`;
2. `only`: the type has a single layout, used as is;
3. `signature`: the first layout (by `sort_order`) whose condition matches;
4. `dateRange`: the first layout whose bounds cover the document date;
5. `bestConfidence`: every layout is tried, and the one with the best average
   extraction confidence wins, provided it reaches `LAYOUT_TRIAL_THRESHOLD`
   (0.5);
6. `default`: nothing decided, so the default layout takes over and its
   extraction rules run all the same.

Only that last case, and only when the type has two layouts or more, gives the
document the blocking review reason `unknownLayout` ("Create a layout from this
document?"). The reason disappears as soon as a layout other than the default
one is set.

The opposite case has its own reason. When several layouts match at the same
step — two signatures that both fire, two date ranges covering the same day —
`sort_order` breaks the tie, and nobody chose that. The document then carries
the informational `ambiguousLayout`, naming the layouts that also matched: the
extraction did run, so the document is not held back, but the type needs
narrower signatures or ranges. Forcing a layout, or narrowing until one layout
answers, clears it on the next application of the type.

`addLayout` and `updateLayout` see the same collision earlier, and return it as
`overlaps`: the sibling layouts whose validity window meets the one just saved,
with the shared window. The save always goes through — bounds are typed in one
at a time, and a passing overlap is normal — and the interface warns. A layout
with no bound at all is not in the date-range race and never appears there.

`documentType.createLayoutFromDocument` seeds a signature from the first five
rare words of the OCR text, as a starting point to edit.
`documentType.testLayout` runs the rules of a layout on a document and returns
the per-field results with their average confidence, writing nothing.

### Extraction rules

An extraction rule only exists inside a document type: `layout_id` is required,
and the rule runs when its layout is selected. There is no global rule and no
`category_ids` any more, since the type carries the category.

- `extractionRule.list` takes a `layoutId` or a `documentTypeId`;
- `extractionRule.create` requires a `layoutId`;
- `extraction_rule.required` says the document is unusable without the value.
  A required rule that finds nothing raises the blocking `extractionFailed`;
  an optional one — the default — leaves the field empty and raises the
  informational `extractionMissed`, which names the rule so the switch is one
  click away;
- `extractionRule.applicable({ documentId })` returns the rules of the layout
  the document currently carries (empty without a type), which is what the
  "Extract" action of a field offers;
- `extractionRule.test` / `preview` are unchanged, and write nothing.
  `document.setFieldValue` accepts `{ source: "rule", confidence }` when the
  caller applies the result of such a test; without it the value is manual.

Deleting a layout deletes its extraction rules with it (cascade).

## 5. Detection and rules

`detection` is the very same condition tree as the rule engine (SPEC §3), so it
sees `content`, `filename`, `mail.from`, `detected_identifiers.*`, `category`,
`tags`… Types are evaluated in `priority` order during the `analyze` step of the
pipeline, right after the identifier and date pre-pass:

- the best match whose `detection_confidence` reaches
  `review.confidenceThreshold` is applied with `source: "rule"`;
- a weaker match only produces the informational review reason `typeCandidate`
  (meta: `documentTypeId`, `confidence`), and writes nothing;
- a document that already carries a type is left alone.

Applying a type rewrites the category, the parties and the tags, so the rule
subject is rebuilt before the `ingest` rules run.

Automations can also apply a type explicitly through the action
`set_document_type { documentTypeId }`, which takes the same code path with the
same layout selection and extraction. That action is now the only way an
automation triggers an extraction: `run_extraction` is gone, and `set_field`
only carries a literal `value`.

`documentType.detect({ documentId })` runs the detection as a dry run and
returns the candidates with the layout each of them would select.

A disabled type is out of the flow. Detection ignores it, and
`documentType.apply` refuses it with `BAD_REQUEST` unless the caller passes
`force: true`, so applying it by hand stays possible on purpose. The same rule
applies to `rule.run({ ruleId, force? })` for a disabled automation;
`rule.test` stays allowed on both and reports `enabled: false`.

`documentType.list({ includeDisabled: false })` filters them out, and the MCP
`list_document_types` defaults to the enabled ones only.

## 6. Creating a type

- `documentType.create` creates one from scratch.
- `documentType.createFromDocument({ documentId, name?, recurrence? })` is
  prefilled with the category, the issuer, the subject, the tags and the
  sensitivity of the document, then applied to it: the document becomes the
  first sample of the type.
- `documentType.createFromSuggestion` turns a `documentType.suggest()` entry
  (or a `recurringCandidate` review reason) into a recurring type. Both come
  from the same heuristic: an issuer + category pair covering at least two
  distinct periods, with the periodicity inferred from the median gap. Nothing
  is ever created automatically.
- `documentType.preview({ id | draft, documentId })` reports what applying
  would do, without writing a single row.

Every one of these refuses a document sitting in the trash (`CONFLICT`,
"Document is in the trash; restore it first."), as does
`documentType.setDocumentOverride`.

## 7. Migration from Series

`0011_document-types` converts the existing data in place:

- each `series` row becomes a `document_type` (`ser_x` → `dty_x`) keeping its
  name, party (as issuer), category, periodicity, bounds, expected day, grace
  days and `enabled` flag. `match_rule_id` is dropped: `detection` replaces it;
- `document_series_override` rows move to `document_type_override`;
- `reminder.series_id` becomes `reminder.document_type_id`, and the reminder
  kind `series_gap` becomes `period_gap`;
- `series` and `document_series_override` are dropped;
- the `series_periodicity` enum keeps its name and gains `weekly`.

## 8. Migration of the extraction rules

`0012_extraction-in-types` moves the extraction rules inside the types:

- `document_type_layout` gains `is_default`; every type without a layout gets a
  "Default" one, and every type that already had layouts marks its first one
  (by `sort_order`) as the default;
- every extraction rule without a layout joins the Default layout of a generic
  type `Any <Category>`: one per category, created disabled, without issuer and
  without detection. A rule without category lands in `Any document`;
- `extraction_rule.layout_id` becomes `NOT NULL` and cascades on delete;
  `extraction_rule.category_ids` is dropped;
- the `run_extraction` actions, and the `set_field` ones carrying an
  `extractionRuleId`, are stripped from the existing rules.

## 9. Types vs automations

A type is the entry point for classification: "the same document we keep
receiving" gets its category, its parties, its tags, its title and its layout
in one shot, through `detection` or the explicit action `set_document_type`.

An automation (the `rule` table, `rule.*` procedures) is deliberately kept to
what stays cross-cutting, orthogonal to any one type: tagging a document from
the mail sender it arrived from, flagging it sensitive because its text carries
an IBAN, filing it into a dossier, firing a webhook, or running on a
`scheduled`/`update` trigger instead of at intake.

The nuance is the **one-off family**. `set_category` is an automation action
again, because filing a handful of documents that will never come back does not
deserve a whole type: no issuer, no recurrence, no detection to maintain.
`add_to_dossier` is the same idea for a collection. Both write with the source
`rule`, so a category someone set by hand is never taken away from them. The
moment the family repeats — a monthly bill, a payslip, anything with a period
and an issuer — it belongs in a type, which is the only thing that brings a
layout and its extraction rules along.

For a category that has no type at all, "Extraction rules" on the category row
in Settings → Categories opens (creating it on first use) the generic type
`Any <Category>`: category set, no issuer, no recurrence, detection disabled.
Nothing detects it, nothing is assigned by it — the pipeline simply runs the
extraction rules of its default layout on any document filed under that
category and without a type of its own, writing the values with the source
`rule` (see [`ingestion.md`](ingestion.md)).

The two engines share the same condition tree (`detection` is a `RuleCondition`,
SPEC §3) and the same action vocabulary where it overlaps (`set_document_type`,
`set_category`, `add_tag`, `remove_tag`, `add_to_dossier`, `link_party`,
`set_sensitive`, `set_title`, `set_document_date`, `set_period`,
`set_valid_until`, `set_field`, `webhook`), so choosing between them is a
question of scope.
