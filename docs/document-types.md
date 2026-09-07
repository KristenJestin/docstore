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
| Title | `title_template` | rewrites the title **while it still is the one derived from the filename** |
| Detection | `detection`, `detection_confidence` | see §4 |
| Recurrence | `periodicity`, `start_period`, `end_period`, `expected_day`, `grace_days` | see §2 |
| Order | `priority`, `enabled` | detection order (ascending) |

The assignment itself is stored on the document: `document_type_id`,
`document_type_source` (`manual` / `rule` / `mcp`), `document_type_confidence`
and `layout_id`, exactly like the category and the Party links.

An automatic application (`source` other than `manual`) never overwrites a
category set by hand, and never clears an existing Party link.

## 2. Recurrence

Filling in the recurrence block turns the type into what a Series used to be.

- `periodicity`: `weekly`, `monthly`, `quarterly` or `yearly`.
- `start_period` is snapped to the first day of its period (Monday for a week).
- `end_period` is optional: an open recurrence keeps looking for the next
  period.
- `expected_day` is the expected day of arrival: a day of the month, or an ISO
  weekday (1 = Monday) for `weekly`. Without it, the last day of the period is
  used.
- `grace_days` (15 by default) absorbs the usual lateness before a period is
  declared missing.

Period keys read as `2026-W09`, `2026-03`, `2026-Q1`, `2026`.

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

## 3. Layouts

Every type always has at least one layout. `documentType.create` opens one
named "Default" (`is_default = true`, no signature, no date range), and
`removeLayout` refuses to delete the last one (`BAD_REQUEST`). Deleting the
default one while others remain promotes the next layout to default.

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
- `extractionRule.applicable({ documentId })` returns the rules of the layout
  the document currently carries (empty without a type), which is what the
  "Extract" action of a field offers;
- `extractionRule.test` / `preview` are unchanged, and write nothing.
  `document.setFieldValue` accepts `{ source: "rule", confidence }` when the
  caller applies the result of such a test; without it the value is manual.

Deleting a layout deletes its extraction rules with it (cascade).

## 4. Detection and rules

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

## 5. Creating a type

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

## 6. Migration from Series

`0011_document-types` converts the existing data in place:

- each `series` row becomes a `document_type` (`ser_x` → `dty_x`) keeping its
  name, party (as issuer), category, periodicity, bounds, expected day, grace
  days and `enabled` flag. `match_rule_id` is dropped: `detection` replaces it;
- `document_series_override` rows move to `document_type_override`;
- `reminder.series_id` becomes `reminder.document_type_id`, and the reminder
  kind `series_gap` becomes `period_gap`;
- `series` and `document_series_override` are dropped;
- the `series_periodicity` enum keeps its name and gains `weekly`.

## 7. Migration of the extraction rules

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

## 8. Types vs automations

A type is the entry point for classification: "the same document we keep
receiving" gets its category, its parties, its tags, its title and its layout
in one shot, through `detection` or the explicit action `set_document_type`.
The rule action `set_category` is gone, so a type is now the only way to set
the category.

An automation (the `rule` table, `rule.*` procedures) is deliberately kept to
what stays cross-cutting, orthogonal to any one type: tagging a document from
the mail sender it arrived from, flagging it sensitive because its text carries
an IBAN, firing a webhook, or running on a `scheduled`/`update` trigger instead
of at intake. Anything that reads as "classify this kind of document"
(category, issuer, tags, title, layout, extraction) belongs in a type.

The two engines share the same condition tree (`detection` is a `RuleCondition`,
SPEC §3) and the same action vocabulary where it overlaps (`set_document_type`,
`add_tag`, `remove_tag`, `link_party`, `set_sensitive`, `set_title`,
`set_document_date`, `set_period`, `set_valid_until`, `set_field`, `webhook`),
so choosing between them is a question of scope.
