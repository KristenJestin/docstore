# docstore MCP server

The server exposes the document store to an agent (Claude Desktop, Claude Code,
any MCP client) through the Model Context Protocol, Streamable HTTP transport,
on `POST/GET/DELETE /mcp`.

The endpoint is reserved for API keys and ignores session cookies, since an
agent is not a browser. Without a valid key, `/mcp` responds `401`.

## 1. Create an API key

Keys live in the `api_key` table; only the sha256 of the secret is stored. The
plaintext secret (`dsk_` + 40 characters) is returned only on creation.

Through the typed oRPC client (or the generated REST API, `POST /api-reference/api-keys`):

```ts
const { key, secret } = await client.apiKey.create({
  name: "Claude Desktop",
  scopes: ["read", "write"],
  // expiresAt: "2027-01-01T00:00:00Z",  // optional
});
console.log(secret); // dsk_… — copy it right away, it cannot be read again
```

Available procedures:

| Procedure           | Role                                                    |
| ------------------- | ------------------------------------------------------- |
| `apiKey.list`       | List your keys (prefix, scopes, last use)                |
| `apiKey.create`     | Create a key — returns `{ key, secret }`                 |
| `apiKey.revoke`     | Revoke: the key stays visible but no longer authenticates |
| `apiKey.delete`     | Delete permanently                                       |

`apiKey.create`, `revoke` and `delete` require the `admin` scope when the caller
is itself an API key (a browser session keeps every right): a `write` key
therefore cannot mint itself an `admin` key.

## 2. Scopes

| Scope       | What it opens                                                     |
| ----------- | ----------------------------------------------------------------- |
| `read`      | Search, reading documents, Party, taxonomy, statistics             |
| `write`     | Every mutation (edit, link, upload, rules)                         |
| `sensitive` | OCR text of documents marked "sensitive"                           |
| `admin`     | API key administration; implies every other scope                  |

A `sensitive` document returns ``[sensitive document: `sensitive` scope required]``
instead of its text when the key does not carry `sensitive`; `search_documents`
never returns content snippets, whatever the scopes. Any mutation without
`write` fails with an MCP result `isError: true` and an English message.

Sensitive documents are also encrypted at rest and can never be shared through a
public link. See `docs/security.md`.

The same keys also authenticate the HTTP routes `/rpc*`, `/api-reference/*`,
`/files/:id/download`, `/files/:id/thumbnail`, `/api/parties/:id/logo` and
`POST /api/export`, through `Authorization: Bearer dsk_…` or `X-API-Key: dsk_…`.

## 3. Connect a client

### Claude Code

```bash
claude mcp add --transport http docstore https://docstore.exemple.fr/mcp \
  --header "Authorization: Bearer dsk_…"
```

In development the origin is `http://127.0.0.1:3000/mcp` (port 3000 may be
shared on `::1` by another project: use `127.0.0.1`, not `localhost`).

### Claude Desktop

In `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "docstore": {
      "type": "http",
      "url": "https://docstore.exemple.fr/mcp",
      "headers": {
        "Authorization": "Bearer dsk_…"
      }
    }
  }
}
```

### Check by hand

```bash
curl -s -X POST http://127.0.0.1:3000/mcp \
  -H "Authorization: Bearer dsk_…" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
```

## 4. Tools

Every mutation requires the `write` scope.

| Tool                       | What it does                                                         |
| -------------------------- | -------------------------------------------------------------------- |
| `search_documents`         | Full-text search + category, tag, Party, status, date filters         |
| `get_document`             | Full detail of a document (Dossiers and document type included), without the OCR text |
| `get_document_text`        | OCR text; hidden if sensitive and the key lacks `sensitive`           |
| `list_review_queue`        | Documents "to review" with their reasons                              |
| `approve_review`           | Approves a document (optional correction) and sets it back to `active` |
| `reject_assignment`        | Rejects an automatic assignment (Party, tag, category, field)          |
| `update_document`          | Title, dates and precision, period, validity, sensitive, ASN, place    |
| `set_document_category`    | Assigns or removes the category                                        |
| `set_document_tags`        | Replaces the whole set of tags                                         |
| `link_party`               | Links a Party with a role (issuer, recipient, subject, mentioned)       |
| `unlink_party`             | Detaches a Party for a given role                                      |
| `set_field_value`          | Sets the typed value of a custom field                                 |
| `trash_document`           | Moves the document to the trash (soft delete)                          |
| `reprocess_document`       | Republishes the ingestion job (OCR, analysis, rules)                   |
| `list_parties`             | Lists Parties (search by name, alias, identifiers)                     |
| `get_party`                | Detail of a Party: identifiers, relations, document count              |
| `create_party`             | Creates a Party                                                        |
| `update_party`             | Partial patch of a Party; `identifiers` is merged key by key (`null` removes one), `replaceIdentifiers: true` replaces the whole object |
| `merge_parties`            | Absorbs one Party into another (documents, relations, identifiers, aliases) and archives the source |
| `list_duplicate_parties`   | Live Parties sharing a domain, or the same name up to case and spacing |
| `find_party_by_identifier` | Matches an issuer by SIREN, SIRET, VAT, IBAN, email, domain            |
| `list_categories`          | Flattened category tree, with path and counters                        |
| `list_tags`                | Tags and document count                                                |
| `create_tag`               | Creates a tag (name unique, case-insensitive)                          |
| `list_custom_fields`       | Custom field definitions                                               |
| `list_rules`               | Automation rules, by priority                                          |
| `test_rule`                | Evaluates an automation rule against a document, without writing anything |
| `run_rule`                 | Applies an automation rule to a list of documents                      |
| `get_stats`                | Global counters + size of the review queue                             |
| `ignore_duplicate`         | Dismisses a duplicate pair: it stops being reported                    |
| `upload_document`          | Uploads a base64-encoded file (20 MB maximum); already stored content comes back as `duplicateOf` + `trashed` |
| `list_document_types`      | Document types, with the stats of the recurring ones                   |
| `get_document_type`        | Detail of a type: layouts with their extraction rules, and `present`/`missing`/`pending` timeline |
| `list_missing_periods`     | Missing periods of one recurring type, or of all of them               |
| `apply_document_type`      | Applies a type to documents (category, parties, tags, layout, extraction) |
| `create_document_type_from_document` | Creates a type prefilled from a document and applies it to it |
| `list_dossiers`            | Open Dossiers (or all) with their document count                       |
| `create_dossier`           | Opens a Dossier (name, optional description)                           |
| `add_to_dossier`           | Attaches documents to a Dossier                                        |
| `remove_from_dossier`      | Detaches one document from a Dossier; the document itself is untouched |
| `close_dossier`            | Closes a Dossier (`reopen: true` puts it back among the open ones)     |
| `list_reminders`           | Expiry reminders and missing periods, by due date                      |
| `add_document_relation`    | Links two documents (`version_of`, `page_of`, `supersedes`…)           |
| `list_saved_searches`      | Saved searches; `filters` replays in `search_documents`                |
| `list_intake_sources`      | Intake channels: last poll, last error, counters                       |
| `run_intake_source`        | Triggers an immediate poll of a channel (asynchronous)                 |
| `create_upload_link`       | Creates a public upload URL (expiry, quota, imposed values)            |
| `list_share_links`         | Public links onto a document or a dossier, with quota and views        |
| `create_share_link`        | Opens a public URL `/s/<token>` (expiry, password, quota, download)    |
| `revoke_share_link`        | Closes a link: the public URL answers 410                              |
| `export_documents`         | Previews a ZIP export (count, size, paths); download via `POST /api/export` |
| `assign_asn`               | Gives the document the next free archive serial number                 |
| `find_by_asn`              | Finds a document by its ASN, or returns the next free number           |

### What the tools refuse

An agent gets an explicit tool error in each of these cases:

| Situation | Answer |
| --------- | ------ |
| A document in the trash (`update_document`, `set_document_category`, `set_document_tags`, `set_field_value`, `link_party`, `unlink_party`, `assign_asn`, `ignore_duplicate`, `approve_review`, `reject_assignment`, `add_to_dossier`, `remove_from_dossier`, `add_document_relation`, `apply_document_type`, `run_rule`, `create_share_link`, `reprocess_document`) | "Document is in the trash; restore it first." — every writer, without exception |
| `reject_assignment` on a value entered by a human | "This assignment was set manually; edit it instead." — a manual value is edited, never rejected |
| `reject_assignment` on an assignment that does not exist | `NOT_FOUND` |
| `approve_review` on a `processing` or `failed` document | `CONFLICT`: nothing reviewable yet |
| `approve_review` on a document that is not in the queue (`active`, `archived`) | `BAD_REQUEST` "Document is not in review." — never a silent no-op |
| `create_share_link`, `create_upload_link` with an `expiresAt` already past | `BAD_REQUEST`: the guard lives in the service, so no schema can bypass it |
| `create_party` / `update_party` reusing the SIREN, SIRET, VAT or **domain** of another live Party | `CONFLICT` naming the Party that already holds it — merge them with `merge_parties` |
| `upload_document` with content that is not a PDF/PNG/JPEG/WebP/TIFF, or a payload that is not valid base64 | The magic bytes decide; the file is refused before any row is written |
| `set_field_value` outside the categories of the field, in another currency, or with a negative amount without `allowNegative` | `BAD_REQUEST` naming the constraint |
| `apply_document_type` on a disabled type, `run_rule` on a disabled automation | Refused unless `force: true` |

`list_document_types` returns the enabled types only unless
`includeDisabled: true`, and `test_rule` answers `hasActions` and `enabled`
next to `matched`: an automation left without any action matches and does
nothing, so the tool says so.

### Boolean arguments

Every boolean input (`force`, `includeDisabled`, `includeClosed`, `sensitive`,
`allowDownload`, `reopen`, `replaceIdentifiers`…) also accepts the strings
`"true"` and `"false"`. Clients that build their arguments from a text template
send every scalar quoted, and a rejected `"true"` reads as a schema error on an
argument the agent believes it passed correctly. The published JSON Schema is
unchanged and still says `"type": "boolean"`, so the quoted form is advertised
nowhere; only what the server tolerates is wider. Any other string is still a
validation error.

### Cached tool lists

An MCP client fetches `tools/list` once, at connect time, and keeps it for the
whole session. After a server upgrade an already-connected client keeps calling
the old set: a new tool is invisible to it, and a widened argument still looks
refused. Reconnect the client (restart Claude Desktop, `/mcp` in Claude Code,
or drop and re-add the server) after deploying a new version. Nothing on the
server side can push the change: the transport is sessionless and carries no
`notifications/tools/list_changed` between requests.

## 5. Resources and prompts

Resources (JSON):

- `docstore://document/{id}`: detail of a document; `resources/list` exposes
  the 50 most recent documents;
- `docstore://party/{id}`: record of a Party (no enumeration: go through
  `list_parties`).

Prompts:

- `classify_document(documentId)`: steps to categorize a document, match its
  issuer, extract dates and amounts, then approve it;
- `review_queue()`: process the "to review" queue.

`run_intake_source`, `create_upload_link`, `create_share_link`,
`revoke_share_link`, `apply_document_type`,
`create_document_type_from_document`, `create_dossier`, `add_to_dossier`,
`remove_from_dossier`, `close_dossier` and `assign_asn` require the `write`
scope.
`apply_document_type` does more than patch metadata: it writes the category, the
Parties, the tags and the extracted field values in one go (see
`docs/document-types.md`).
`create_upload_link` and `create_share_link` open public URLs, to be entrusted
only to a trusted agent; `create_share_link` refuses a sensitive document (or a
dossier holding one). `export_documents` stops at the preview on purpose, since
a multi-megabyte archive has no business travelling over JSON-RPC, so the agent
is pointed at `POST /api/export` with the same body. That route needs
`sensitive` for `includeSensitive: true`. Intake channels are configured from
the application (`docs/ingestion.md`): MCP only lists and triggers them, it
never enters a password.

The export's file name template accepts `{date}`, `{issuer}`, `{category}`,
`{title}`, `{period}`, `{filename}` and `{ext}` (an unknown placeholder is a
`BAD_REQUEST` naming every one it allows). `{filename}` is the original file
name without its extension, because the export always appends the real one
once: `{period} {issuer} {filename}` on `facture-nordwind-043.pdf` produces
`… facture-nordwind-043.pdf`, never `….pdf.pdf`. `{ext}` (without the leading
dot) is there for a template that wants the extension somewhere else than at
the end.

## 6. Deployment

The reverse proxy already routes `/mcp*` to the Hono server
(`docker/Caddyfile`, matcher `@api`), along with `/api*`, which now covers the
public routes and `POST /api/export`. No extra setting is needed: the transport
is sessionless (`sessionIdGenerator: undefined`), and a fresh MCP server is
built per request with the scopes of the calling key.
