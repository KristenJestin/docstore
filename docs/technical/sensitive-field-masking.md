# Masking the fields of a sensitive document

Research for issue #13: should the custom field values of a sensitive document
be hidden from an API key that has `read` but not `sensitive`, the way the OCR
text has been since #6?

**Recommendation:** yes. For a caller without `sensitive`, mask **every**
custom field value and the free-text notes of a sensitive document. Close the
three side channels that would still leak the same data: activity summaries,
field-value filters and full-text search. Do not add a per-field `sensitive`
flag for now. The details are in section 5.

## 1. What `sensitive` protects today

One decision, `mayReadSensitive` (`packages/shared/src/api-key.ts`), is used
by oRPC, MCP and `/files`. A browser session keeps every right, so all of what
follows is about API keys.

| Protected for a key without `sensitive` | How |
| --- | --- |
| File bytes, thumbnails (`/files/:id/*`, `/d/:docId`, `file.download`, `file.thumbnail`) | `403` before storage is read |
| OCR text (`document.get` and every write that returns the document, MCP `get_document_text`) | `content` replaced by a placeholder, `masked: true` (`maskSensitiveContent`) |
| OCR layout, dry runs over the OCR layer (`extractionRule.test/preview`, `documentType.preview/testLayout`, `rule.test`, MCP `test_rule`) | `403` / tool error |
| Export (`POST /api/export`, `export.preview`, MCP `export_documents`) | `includeSensitive` refused; without it, sensitive documents are absent from the archive, manifest included |

docs/security.md section 4 already says what is left open: "the metadata of a
sensitive document (title, dates, category, tags, Parties, custom field
values)". AGENTS.md goes further than the code when it says sensitive documents
are "hidden from MCP unless the key carries the `sensitive` scope". Only their
content is hidden: `search_documents` lists them, and `get_document` returns
their metadata.

## 2. Inventory: what a `read` key sees of a sensitive document

| Surface | What is returned for a sensitive document | Protected data it can hold |
| --- | --- | --- |
| MCP `search_documents`, oRPC `document.list` (and its OpenAPI twin) | List items: id, title, status, dates, category, tags, Parties, document type, `sensitive`. No field values, no notes, no snippet | Title only (see below) |
| MCP `get_document`, resource `docstore://document/{id}`, oRPC `document.get` / `byAsn` and the writes returning the document | Full metadata: title, dates, period, validity, category, tags, Parties with role, **`fieldValues` (value, source, confidence)**, **`notes`**, ASN, physical location, review reasons, relations, dossiers, files list (names, sizes), URLs | **Field values, notes** |
| MCP resource list | The 50 most recent documents, sensitive ones included, by title | Title |
| `/files/:id/*`, `/d/:docId` | `403` | None |
| Export | Sensitive documents left out entirely (`export.service.ts`, `sensitive: input.includeSensitive ? … : false`) | None |
| Webhooks | `document.*` body is `webhookDocumentSummary` (`packages/ingestion/src/webhook.ts`): id, title, status, source, `sourceRef`, date, category, `sensitive`, review reason **codes**, timestamps. No field values, no notes. Webhooks are configured by `admin`; `webhook.deliveries` (with the stored payloads) needs only `read` | Title, `sourceRef` |
| Activity log (`activity.list`, MCP activity tool, both `read`) | `document.update` summaries hold before/after of title, dates, period, validity, ASN, physical location; notes only as `{ changed: true }`. **`document.field_set` / field clear summaries hold the before/after field value** (`document.service.ts`, `summaryFieldValue`). Entries carry the `sensitive` flag but are not masked | **Field values** set or cleared by hand or through the "Extract" action (values written by the pipeline are not logged value by value) |
| Full-text search (`query` on `search_documents` / `document.list`) | `search_vector` is `title + content + notes` for every document (`packages/db/src/schema/document.ts`), with no caller condition in `listDocuments`. A key cannot read the OCR text of a sensitive document, but it can **test whether it contains a given string** (an IBAN, a tax number, an amount) | **OCR text and notes, as an oracle** |
| Field-value filters (`fieldFilters` on oRPC `document.list`: `eq`, `gt`, `lt`, `contains`; not exposed by MCP) | Same oracle on field values: a few `gt`/`lt` calls narrow a salary down to the cent, even if the values themselves were masked | **Field values, as an oracle** |
| Review queue (`review.list`) | Documents with their review reasons. Reason messages and `meta` name the field or the rule but never carry the extracted value | None |
| Parties (`party.get`, MCP party tools) | Party identifiers (`siren`, `siret`, `vat`, `iban`, `email`, `domain`, `phone`, `customerRef`) and notes. A Party is not a document and has no `sensitive` flag; a household member's IBAN is readable with `read` | Out of scope of this issue (see section 6) |
| Reminders | Kind, due date, period, status, document id. No text of their own | None |
| Titles generated from templates | `title_template` and `set_title` only know `{type}`, `{period}`, `{date}`, `{issuer}`, `{subject}`, `{category}`, `{title}`, `{filename}`, `{ext}` (`packages/rules/src/title.ts`). **No custom field can enter a title** | Only what the filename or mail subject already said |

Summary: the custom field values (detail and activity log) and the notes are
the only places where protected data leaks in clear. Full-text search and field
filters leak the same data (and the OCR text) as an oracle.

### Field types and extraction results

`CUSTOM_FIELD_TYPES`: `text`, `number`, `money`, `date`, `boolean`, `select`,
`url`, `party_ref`. The ones that can hold protected data are `money`
(salaries, tax), `text` (tax numbers, contract numbers, references, IBAN-like
strings) and `number` (meter readings, incomes). `date`, `boolean`, `select`,
`url` and `party_ref` are rarely secret on their own, but nothing stops a user
from storing something private in them.

Extraction results end up in the same `document_field_value` rows
(`source: "rule"` with a confidence, or `manual`). There is no separate store
of extraction candidates that a key could read. Document-level period and date
columns (`periodStart`, `periodEnd`, `documentDate`, `validFrom`,
`validUntil`) are organisation metadata: masking them would break sync,
reminders and the time line, and they say little on their own.

## 3. Real usage in production

This is from a read-only survey of `documents.krisnet.work` on 2026-09-29,
through MCP. The key used has the `sensitive` scope (`get_document_text`
answered `masked: false`), so what a `read`-only key sees comes from the code,
not from this survey. The survey recorded field names, types and counts, never
values. It did write activity entries, because every read by a key is logged.

- 17 custom fields: 9 `money` (Montant TTC, Total amount, Net pay, Salaire
  net, Salaire brut, Net imposable, Chiffre d'affaires déclaré, Montant à
  payer, Revenu fiscal de référence), 4 `text` (Invoice number, Référence,
  Numéro de contrat, Année d'imposition), 2 `date` (due dates), 2 `number`
  (Index du compteur, Consommation).
- 116 sensitive documents: 79 payslips, 8 income tax notices, 5 employment
  contracts, 3 identity cards, 3 driving licences, 3 property tax notices,
  2 insurance contracts, 13 others (bank, health, energy, claims…).
- 33 of them read with `get_document` (up to three per category):
  - 17 carry field values. Uses: Référence 10, Montant à payer 3, Revenu
    fiscal de référence 3, Année d'imposition 3, Numéro de contrat 3, Montant
    TTC 3, Date d'échéance 5, Salaire net 3, Salaire brut 3, Net imposable 3.
    That is 39 values: 18 `money`, 16 `text`, 5 `date`. 25 came from
    extraction rules and 14 were typed by hand (and are
    therefore also in the activity log).
  - On income tax notices, `Référence` is a 13-digit number, the shape of the
    French personal tax number. On property tax notices it is a 16-digit
    reference. No text value has the shape of an IBAN.
  - 6 carry free-text notes (33 to 211 characters): identity card, driving
    licence, bank, claim, employment contract, administrative document.
  - None has a title holding an amount or a long number.

The fields that matter most (salaries, taxable net, reference tax income, tax
number) only appear on documents that are already flagged sensitive. The
generic ones (Montant TTC, Référence) appear on both sensitive and ordinary
documents.

## 4. Options

### A. Mask every field value and the notes of a sensitive document

For a caller where `document.sensitive && !mayReadSensitive(caller)`: return
`fieldValues: []` and `notes: null`, next to the `content` placeholder, under
the same `masked: true`. One helper replaces `maskSensitiveContent`
(`maskSensitiveDocument`), so the three surfaces keep one decision.

| Where | Cost |
| --- | --- |
| Shared schema | None. `fieldValues` is already an array and `notes` is already nullable. `masked` gets a wider meaning (content, fields, notes), documented in its comment |
| oRPC / OpenAPI | Swap `withMaskedContent` for the wider helper at the same call sites in `routers/document.ts` and `routers/review.ts`. Small |
| MCP | `get_document`, `docstore://document/{id}` and every write tool that returns the document go through `toDocumentGet` without any masking today; apply the helper in `serialize.ts` so no tool is missed. Text output says the fields are masked. Update `docs/mcp.md`. Small to medium |
| Web | None in behaviour: a session always passes. No type change |
| Export | None: sensitive documents are already absent without the scope |
| Webhooks | None: no field values or notes in the payload |
| Activity | Mask `summary.value` of `document.field_set` / clear entries (and any `notes` payload) when the entry is `sensitive` and the caller lacks the scope, at read time in `activity.list` and the MCP tool. Small |
| Search | Without the scope, a `query` should match a sensitive document on its title only (for example `sensitive = false OR to_tsvector(title) @@ q`), and `fieldFilters` should skip sensitive documents. Medium: it touches `listConditions` and ranking and needs the caller passed to `listDocuments` |
| Tests | One per surface, named after the scenarios, next to `sensitive-scope.test.ts` and the MCP server tests |

Agents lose the amounts of payslips and tax notices unless their key carries
`sensitive`. That is the intended trade: the flag already means "this is for
keys I trust with the content".

### B. A `sensitive` flag on the custom field

A column `custom_field.sensitive`, set in the field editor. Its value is
masked, on every document or only on sensitive ones, for keys without the
scope.

| Where | Cost |
| --- | --- |
| Database | Migration, default `false` |
| Web | New toggle in the custom field form and a badge; defaults to decide for existing fields |
| oRPC / MCP | Filter the value list field by field; `list_custom_fields` exposes the flag |
| Activity, search | Same side channels as option A, now per field (`field_set` summaries, `fieldFilters` on those fields) |
| Export | If it applies to ordinary documents too, the export needs a field-level exclusion, which the export format does not have today |

Problems: it adds a second knob that answers the same question as the
document flag, and it gets the common case wrong. `Référence` is harmless on an
energy bill and is a tax number on a tax notice, so one field needs two
answers. Notes are not covered, and neither is the OCR-text oracle. The
production data does not call for it: the protected fields only live on
documents that are already sensitive.

### C. Leave it as it is

Document the gap and give agents `read` keys as planned. No cost, but a key for
the life wiki or Hermes would read net salaries, reference tax income and tax
numbers from 116 documents the owner deliberately flagged, and could probe the
OCR text of any of them through search. That goes against what the scope table
promises in spirit, just as `read` keys are about to become common.

## 5. Recommendation

Option A, in one framed issue, in this order:

1. `maskSensitiveDocument` in `@docstore/shared/api-key`: `content`,
   `fieldValues`, `notes` under `masked: true`. Applied by oRPC (all call
   sites of `withMaskedContent`) and by MCP in `serialize.ts`, including the
   document resource.
2. Activity: mask the value of field entries (and notes) on `sensitive`
   entries for keys without the scope.
3. Search: without the scope, `query` matches sensitive documents on the title
   only, and `fieldFilters` ignore them. This also closes the OCR-text oracle
   that #6 left open.
4. Docs: update the `sensitive` table of `docs/security.md` and the sentence in
   `AGENTS.md`, and document `masked` in `docs/mcp.md`.

Title, dates, period, category, tags, Parties and the document type stay
visible: they are what an agent needs to know a document exists and to sync.
Titles cannot carry field values (the templates do not know them). Webhooks and
export need no change.

A per-field flag (option B) can come later if an ordinary document ever needs
a protected field. It would then combine with A (masked if the document is
sensitive **or** the field is), rather than replace it.

## 6. Out of scope, noted

- **Party identifiers.** A household member's IBAN, phone or email on a Party
  is readable with `read`. That is a question about Parties, not about
  sensitive documents, and deserves its own issue if keys for third-party
  agents become common.
- **`webhook.deliveries` needs only `read`** and returns stored payloads
  (titles, `sourceRef`). This is consistent with the metadata rule above, but
  worth a look alongside the Party question.
- The database stays in clear (docs/security.md section 2). Masking is about
  API keys, not about a stolen database.
