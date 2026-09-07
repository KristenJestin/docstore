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
| Reading (`/files/:id/download`, `/files/:id/thumbnail`, `file.download`, `/api/s/...`, export) | The driver is chosen from `document_file.encrypted`; decryption is transparent. |

Re-keying happens in place: the storage key does not change, only the bytes
behind it. `FsStorageDriver.put` writes to a temporary file then renames, so the
swap is atomic. A failure halfway through a multi-file document leaves every
object readable, each consistent with its own `encrypted` flag, and the next
call reconciles the rest (`setSensitive` is idempotent).

### What this does not protect against

- A running server: the master key lives in the process, so anyone who can read
  the application's memory, or who holds a valid session or API key, reads the
  documents.
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
| `read`      | Search, reading documents, Party, taxonomy, statistics, `POST /api/export` |
| `write`     | Every mutation, including creating and revoking share links |
| `sensitive` | OCR text of sensitive documents, and `includeSensitive` on the export |
| `admin`     | API keys, settings, upload links; implies every other scope |

A browser session keeps every right: the scopes only narrow what an API key can
do. Concretely:

- `get_document_text` returns a placeholder instead of the text of a sensitive
  document when the key lacks `sensitive`; `search_documents` never returns
  content snippets at all, for any document.
- `POST /api/export` and `export.preview` refuse `includeSensitive: true` with `403`
  for a key without `sensitive`. Without that flag, sensitive documents are
  simply absent from the archive.
- `apiKey.create` / `revoke` / `delete` require `admin`, so a `write` key cannot
  mint itself a stronger one.

Only the sha256 of the secret is stored; the plaintext (`dsk_` + 40 characters)
is returned once, at creation.

## 5. Public surface

Three groups of routes accept unauthenticated requests, all rate limited per IP:

- `GET|POST /api/u/:token`: public upload by link (see `docs/ingestion.md`);
- `GET /api/s/:token`, `POST /api/s/:token/unlock`,
  `GET /api/s/:token/files/:fileId/…`: share links;
- `GET /health`.

Everything else demands a Better Auth session cookie or an API key. The reverse
proxy routes these paths to the Hono server through the `@api` matcher of
`docker/Caddyfile`.

> `/u/<token>` and `/s/<token>` are web pages served by the SPA; the endpoints
> above live under `/api/`, so the two never collide on the shared origin. The
> `url` returned by `uploadLink` and `shareLink` is the page
> (`PUBLIC_URL` + `/u/<token>`), which is what you hand to a third party.
