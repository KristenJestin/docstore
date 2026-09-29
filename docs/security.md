# docstore security model

What protects the store, and what it does not protect against: `APP_SECRET`,
encryption at rest, public share links, API key scopes and the unauthenticated
routes.

## 1. `APP_SECRET`

One secret backs every cryptographic operation of the server:

| Use                        | Derivation                                    | Where |
| -------------------------- | --------------------------------------------- | ----- |
| Stored secrets (IMAP passwords) | scrypt, salt `docstore.secret.v1`        | `packages/api/src/services/crypto.service.ts` |
| Storage master key         | HKDF-SHA256, salt `docstore-storage`          | `packages/storage/src/encrypted-driver.ts` |
| Share-link access tokens   | HMAC-SHA256 over `<linkId>.<expiry>`          | `packages/api/src/services/share-link.service.ts` |

Generate one with `openssl rand -base64 32`; 32 characters minimum, validated by
`@docstore/env`.

> Rotation is not supported in v1. Changing `APP_SECRET` makes every
> encrypted file and every stored IMAP password unreadable, with no migration
> path. If the secret must change, first turn every sensitive document back to
> `sensitive: false` (which rewrites the files in the clear), then change the
> secret, then flag them again. A future iteration will need a key-version
> header and a re-key job.

## 2. Encryption at rest

`document.sensitive = true` means every file of that document (original,
archive, attachment and thumbnail) is stored encrypted, and
`document_file.encrypted` records it.

### Format

`EncryptedStorageDriver` wraps any `StorageDriver` and writes:

```text
"DSE1" (4 bytes) | iv (12 bytes) | GCM tag (16 bytes) | ciphertext
```

- AES-256-GCM, with a fresh random IV per object.
- The data key is derived per object: `HKDF-SHA256(masterKey, salt =
  docstore-storage-object, info = storage key)`. Two objects never share a key,
  and a ciphertext copied under another storage key no longer decrypts.
- `document_file.size` stays the plaintext size, so `Content-Length` and the
  storage statistics are unaffected.
- An object that does not start with `DSE1` is passed through unchanged. That is
  what makes migration possible: files written before the flag was raised stay
  readable through the same driver.

### Lifecycle

| Event | What happens |
| ----- | ------------ |
| Intake with `defaults.sensitive` (upload link, mailbox, watched folder) | The file is written straight through the encrypted driver: the plaintext never touches the disk. |
| Rule action `set_sensitive` | `setSensitive` re-keys the files already stored. |
| `document.update { sensitive }`, `document.bulk { setSensitive }`, MCP `update_document` | Same hook, injected into the router like `onDeleteFiles`. |
| Reading (`/files/:id/download`, `/files/:id/thumbnail`, `/d/:docId`, `file.download`, `/api/s/...`, export) | The driver is chosen from `document_file.encrypted`; decryption is transparent. An API key without the `sensitive` scope is refused before the storage is touched (section 4). |

Re-keying happens in place: the storage key does not change, only the bytes
behind it. `FsStorageDriver.put` writes to a temporary file then renames, so the
swap is atomic. A failure halfway through a multi-file document leaves every
object readable, each consistent with its own `encrypted` flag, and the next
call reconciles the rest (`setSensitive` is idempotent).

### What this does not protect against

- A running server: the master key lives in the process, so anyone who can read
  the application's memory, or who holds a valid session or an API key with the
  `sensitive` scope, reads the documents.
- The database: `document.content` (the OCR text) and
  `document_file.ocr_layout` are stored in the clear. Encryption at rest covers
  the files, and leaving the full-text index readable is what makes search work
  at all.
- Backups of the database, for the same reason.
- Thumbnails of non-sensitive documents, and the metadata of sensitive ones
  (title, dates, category, tags), which stay in the clear.

The threat model is a stolen disk or a leaked backup of the storage folder. A
compromised server is out of scope.

## 3. Share links

A share link is a public, unauthenticated window onto one document or one
dossier. `/s/<token>` is the page the visitor opens; it reads the API under
`/api/s/<token>` on the same origin.

- The token is 32 characters drawn from a 60-character alphabet (~189 bits): it
  is the only key of the URL.
- A sensitive document is never shareable. Creation is refused with
  `BAD_REQUEST`, for a document as well as for a dossier holding one, and the
  public route filters sensitive documents out again at read time, in case one
  joined the dossier after the link was minted. A document in the trash is
  refused too, with the `CONFLICT` every other write on the trash answers.
- A document that *becomes* sensitive closes its links. Raising the flag
  (through `document.update`, `document.bulk`, a `set_sensitive` rule, the
  `sensitiveDefault` of a document type or the MCP `update_document`) revokes
  every still-active link on the document and on the dossiers holding it.
  Filtering at read time was already in place; revoking makes it visible, and
  the link stops answering instead of quietly serving nothing.
- A dossier that *gains* a sensitive document closes its links too.
  `dossier.addDocuments` (and the MCP `add_to_dossier`) revokes every active
  link on the dossier with `revokedReason: "sensitive"`. Same rule as above,
  taken from the other side: there the flag moved under the link, here the
  document walked into the dossier the link was open on.
- A startup sweep catches whatever the three rules above missed. Each of them
  was added after the fact, so links minted before them are still open on
  stores deployed today: the `0019_revoke-sensitive-share-links` migration
  closes those once, and `sweepSensitiveShareLinks` runs the same statement at
  every server start. A gap in a future write path therefore lasts one restart.
  The sweep is idempotent and leaves an earlier revocation, reason and date,
  untouched.
- Optional narrowing: `expiresAt` (must be in the future), `password` (argon2id
  via `Bun.password`), `maxViews`, `allowDownload: false` (metadata and
  thumbnails only). The future-expiry rule is enforced in the service and not
  only in the shared Zod input, because the MCP tools declare their own
  schemas, so a guard placed on the oRPC callers alone would miss them. Same
  for the upload links and the API keys.
- `revoke` sets `revoked_at` and `revoked_reason`: the link answers `410` for
  good but stays listed, so the revocation is auditable. `delete` removes it
  entirely.

| `revokedReason` | Set by |
| --------------- | ------ |
| `manual`        | `shareLink.revoke` |
| `sensitive`     | The target became sensitive, or a sensitive document joined the shared dossier |

`shareLink.list` returns it next to `revokedAt`, so the interface can tell
"someone revoked this" from "the document is now sensitive". A link already
revoked keeps the reason it was first revoked for.

### Public route semantics

| Code | Meaning |
| ---- | ------- |
| `404` | Unknown token. A deleted link is indistinguishable from a token that never existed: scanners learn nothing. |
| `410` | Revoked, expired, or view quota reached. |
| `401` | A password is required and the `access` token is missing or stale. |
| `403` | `allowDownload: false` and the caller asked for the file. |
| `429` | More than 30 requests per minute from the same IP. |

`POST /api/s/:token/unlock { password }` returns
`{ accessToken, expiresIn }`. The access token is
`<linkId>.<expiryMs>.<HMAC-SHA256>` signed with `APP_SECRET`: nothing is stored
server-side, it is worthless for any other link, and it lasts one hour. The SPA
keeps it in memory and passes it as `?access=…`.

Views are counted once per token + IP per hour, in memory: browsing a dossier of
twenty documents counts as one view, not twenty. That counter resets when the
server restarts, so `maxViews` is a courtesy limit with no accounting guarantee
behind it.

### Rate limiting

In-memory, per IP, 30 requests/minute over a 60-second window, shared by every
`/api/s/*` route. It exists to make token scanning expensive; it is not
fine-grained traffic control. Behind the Caddy proxy the client address comes
from `X-Forwarded-For`.

## 4. API key scopes

| Scope       | What it opens |
| ----------- | ------------- |
| `read`      | Every read: search, documents, files and thumbnails, Party, taxonomy, statistics, `POST /api/export` |
| `write`     | Every mutation, including creating, listing and revoking share links |
| `sensitive` | The content of a sensitive document: file bytes, thumbnail, OCR text, OCR layout, and `includeSensitive` on the export; the personal identifiers and notes of Parties |
| `admin`     | API keys, webhooks, upload links, intake sources and settings, reads included; implies every other scope |

A browser session keeps every right: the scopes only narrow what an API key can
do. The same rules apply on every surface (oRPC and the REST API generated from
it, `/files`, `/mcp`, the export).

### `read`

- oRPC: `protectedProcedure`, the default base of every procedure, requires
  `read`. Mutations build on `writeProcedure` (`write`) and administration on
  `adminProcedure` (`admin`), so a key with `write` only can write but cannot
  read, and gets `403 FORBIDDEN` on `document.list`.
- `/files/:id/download`, `/files/:id/thumbnail`, `/d/:docId`,
  `/api/parties/:id/logo` and `POST /api/export` answer `403` to a key without
  `read`.
- MCP: every read tool and resource returns an error without `read`; every
  mutation requires `write`.

### `sensitive`

One helper decides whether a caller may read sensitive content:
`mayReadSensitive` in `packages/shared/src/api-key.ts`. MCP, oRPC and the
`/files` routes all call it, so the surfaces cannot drift apart again.

| Surface | Without `sensitive`, on a sensitive document |
| ------- | -------------------------------------------- |
| `GET /files/:id/download`, `GET /files/:id/thumbnail`, `GET /d/:docId`, oRPC `file.download`, `file.thumbnail` | `403 FORBIDDEN`, checked before the storage is read: no byte of the file is sent |
| oRPC `document.get`, `document.byAsn`, and every write that returns the document (`document.update`, `setTags`, `review.approve`…) | `content` is replaced by ``[sensitive document: `sensitive` scope required]`` and `masked: true` is set |
| oRPC `document.getFileLayout` | `403 FORBIDDEN` |
| Dry runs over the OCR layer: `extractionRule.test`, `extractionRule.preview`, `documentType.preview`, `documentType.testLayout`, `rule.test`, MCP `test_rule` | `403 FORBIDDEN` (MCP: tool error) |
| MCP `get_document_text` | The same placeholder, `masked: true` |
| `POST /api/export`, `export.preview`, MCP `export_documents` | `includeSensitive: true` is refused (`403`, MCP: tool error); without the flag, sensitive documents are absent from the archive |

A refusal is a `403`, not a `404`: the caller already knows the id, and the
document metadata already says `sensitive: true`.

`GET /d/:docId` (the stable URL of a document, see `docs/mcp.md`) checks the
caller before it resolves anything: an anonymous request gets `401` and a key
without `read` gets `403`, so neither learns whether the id was merged, and
into what. The `302` of a merged id only reaches a reader, who could read the
same target through `document.get`. The `sensitive` check then runs on the
document actually served, the kept one.

What stays readable with `read` alone: the metadata of a sensitive document
(title, dates, category, tags, Parties, custom field values), in search
results as in the detail. `search_documents` never returns content snippets at
all, for any document.

### Party identifiers and notes

The same `sensitive` scope protects the personal data of Parties (issue #23):
a household member's IBAN, phone or email is not for every agent holding a
`read` key. The decision is `maskParty` in
`packages/shared/src/party-masking.ts`, called by oRPC and MCP alike; a browser
session and a key with `sensitive` (or `admin`) see every Party in full.

| Party | Without `sensitive` |
| ----- | ------------------- |
| A person, household member or not | Every identifier is withheld (`identifiers: {}`), `notes` is `null`, `masked: true` |
| A company, public body or association | `siren`, `siret`, `vat` and `domain` stay visible (agents need them to recognise issuers); `iban`, `email`, `phone` and `customerRef` are withheld, and `masked: true` says so. The notes stay visible |

| Surface | Without `sensitive` |
| ------- | ------------------- |
| oRPC `party.get`, `party.list`, `party.findByIdentifier` and every write that returns a Party (`create`, `update`, `mergeInto`, `archive`, `unarchive`, the logo procedures); MCP `get_party`, `list_parties`, `find_party_by_identifier`, `create_party`, `update_party`, `merge_parties`, resource `docstore://party/{id}` | The masked view above |
| `party.findByIdentifier`, MCP `find_party_by_identifier` with `kind: iban` or `email` | `403 FORBIDDEN` (MCP: tool error): the lookup would tell whether an IBAN belongs to someone. With a public kind, only organisations are matched |
| `party.list` / `list_parties` with a `query` | The query matches names, aliases and the public identifiers of organisations only, never a masked value |
| `party.duplicates`, MCP `list_duplicate_parties` | A pair sharing the domain of a person is still reported, its `value` replaced by ``[masked: `sensitive` scope required]`` |
| `activity.list`, MCP `list_activity` | The before and after of the identifiers on a `party.updated` entry become `{ changed: true }` and the summary says `masked: true` (the notes were already logged that way) |

Nothing else carries Party identifiers: a document detail embeds its Parties
as id, name, type, role and logo only, the export manifest as id, name and
type, and no webhook payload holds a Party.

### Administration

`apiKey.create` / `revoke` / `delete` require `admin`, so a `write` key cannot
mint itself a stronger one.

Listing an object takes the same scope as managing it (issue #11), so a
`read` key cannot collect working public URLs or administration data:

| Procedure | Scope |
| --------- | ----- |
| `shareLink.list`, MCP `list_share_links` | `write` (the list returns working public URLs) |
| `uploadLink.list` | `admin` (same reason) |
| `apiKey.list`, `webhook.deliveries` | `admin` |
| `intakeSource.list`, `intakeSource.get`, `intakeSource.logs`, MCP `list_intake_sources` | `admin` |

A key without that scope gets `403 FORBIDDEN` (MCP: a tool error); a browser
session is unaffected. `settings.serverInfo` stays on `read`: it returns the
public origins, the version, the path of the configuration file and a count,
no secret. Likewise `settings.set` on `auth.allowSignUp`
requires `admin` (or a browser session): opening sign-up lets someone new into
the whole library.

Only the sha256 of the secret is stored; the plaintext (`dsk_` + 40 characters)
is returned once, at creation.

### Activity log and last use

Every change (web, API, MCP, rules, pipeline) and every read of a document
(detail, OCR text, file download through `/files` or `/d/`, export, search by an
API key) writes an entry to `activity_log`: when, who (the session user, the
API key with its name, or `system`), the action, the object and a short
summary. Summaries hold fields before and after, never file content, OCR text,
free-text notes, share tokens or webhook secrets. A read carries the
`sensitive` flag of its document, so "sensitive reads by keys" is one filter
on the Activity page. Thumbnails and the list views of the web app are not
logged; a browser session re-reading the same document within a minute is
logged once, a key every time. The log is kept forever for now, without a
foreign key, so it outlives the keys, users and documents it names.

A key records `lastUsedAt` and the client address of that request
(`lastUsedIp`: the first hop of `X-Forwarded-For`, else `X-Real-IP`, else the
TCP peer), refreshed at most once a minute. The address is informative, not a
control: behind the reverse proxy it is what the proxy forwards.

## 5. Public surface

Three groups of routes accept unauthenticated requests, all rate limited per IP:

- `GET|POST /api/u/:token`: public upload by link (see `docs/ingestion.md`);
- `GET /api/s/:token`, `POST /api/s/:token/unlock`,
  `GET /api/s/:token/files/:fileId/…`: share links;
- `GET /health`.

Two more answer without a session, by nature:

- `POST /api/auth/sign-up/email` (Better Auth). It creates an account only
  while the installation has none (first run) or while a member has turned
  "Allow sign-up" on in Settings (`auth.allowSignUp`, off by default).
  Otherwise the server refuses it with `403 SIGN_UP_CLOSED`, before looking
  the address up, so a refusal does not reveal whether an account exists. The
  same check guards any other path that would create a user
  (`packages/auth/src/sign-up.ts`).
- `settings.signUpStatus` (`/rpc`): tells the `/signup` page whether sign-up is
  open, and nothing else.

Everything else demands a Better Auth session cookie or an API key. The reverse
proxy routes these paths to the Hono server through the `@api` matcher of
`docker/Caddyfile`.

> `/u/<token>` and `/s/<token>` are web pages served by the SPA; the endpoints
> above live under `/api/`, so the two never collide on the shared origin. The
> `url` returned by `uploadLink` and `shareLink` is the page
> (`PUBLIC_URL` + `/u/<token>`), which is what you hand to a third party.
