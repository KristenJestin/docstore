# Intake channels, upload links and webhooks

Five entry doors lead to the same pipeline (`SPEC.md` §5): web upload, watched
folder, IMAP mailbox, public upload link and API/CLI.
Every document keeps track of its origin in `document.source`
(`upload` · `mail` · `folder` · `link` · `api`) and of its exact reference in
`document.source_ref` (identifier of the source, of the link, or `Message-ID`
of the mail).

## Direct upload (`file.upload`)

`POST /files/upload` (multipart, up to 20 files) is the web and API/CLI door.
It answers `{ created, duplicates }` and never fails the whole batch because one
file is already known:

```ts
await client.file.upload({ files });
// {
//   created:    [{ documentId, fileId, filename }],
//   duplicates: [{ filename, duplicateOf, trashed }]
// }
```

`trashed` tells the two duplicate cases apart:

| `trashed` | Meaning | What to offer |
| --------- | ------- | ------------- |
| `false` | The same SHA-256 is already the original of a live document | Open `duplicateOf` |
| `true`  | It belongs to a document sitting in the **trash** — the unique index on the original SHA-256 ignores `deleted_at`, so a re-import is impossible | Restore or permanently delete `duplicateOf`, then upload again |

The MCP tool `upload_document` returns the same pair (`duplicateOf`,
`trashed`) for a single file, and rejects a payload that is not valid base64.

### Content validation

The declared MIME type and the file name are both caller-supplied, so intake
trusts neither and lets the magic bytes decide. `file.upload`,
`POST /api/u/:token` and the MCP `upload_document` all go through `intakeFile`,
which sniffs the first bytes and refuses anything that is not a PDF (`%PDF-`),
a PNG, a JPEG, a WebP or a TIFF, with a `BAD_REQUEST` raised before a row is
written. A `.pdf` whose content says PNG is stored as a PNG: the content wins
over the declaration.

### When the pipeline gives up

A document sits in `processing` while its job is being retried. After the last
attempt (`JOB_RETRY_LIMIT + 1`) it moves to `failed`, keeping the reason in
`processing_error`:

- `document.list({ status: "failed" })` lists them, and `document.stats` counts
  them in `byStatus`;
- `review.approve` / `approveMany` refuse them (`CONFLICT`), like a document
  still `processing`: there is nothing reviewable in a half-computed analysis;
- the export leaves them out unless `filters.status` explicitly asks for them;
- `document.reprocess` puts them back into `processing` and republishes the job.

A status the user set in the meantime (`archived`, say) is never overwritten:
the update is filtered on `processing`, exactly like `finalize`.

### What a reprocess rewrites

`document.reprocess` replays the whole pipeline, and `analyze` overwrites the
metadata it computed itself: the date read off the text, the covered period,
the title rendered from a document type, the validity extracted by a rule. That
is what it is for. A payslip ingested before `analyze` learnt to read "payé le"
carries the first day of its period as its date, and reprocessing fixes it. A
field the pipeline cannot re-derive on this pass (no candidate in the text) is
left as it is, never cleared.

The exception is what a human typed. `document.update` records the names of the
fields it sets in `document.manualFields` (`title`, `documentDate`,
`datePrecision`, `periodStart`, `periodEnd`, `validUntil`), and `analyze`, the
extraction rules and the title template of a document type all skip a field
listed there. Clearing a field counts as setting it: "this document has no
validity date" is a decision, and re-deriving one would undo it. A marker is
never removed. `sensitive`, `asn` and `physicalLocation` are absent from the
list because no automatic pass writes them in the first place.

`manualFields` is returned by `document.get` (and by the MCP `get_document`), so
the interface can show which values are pinned against the pipeline.

### What approving a review does

`review.approve` accepts what the pipeline proposed. It stamps the current time
on every assignment that did not come from a human — `document_party`,
`document_tag` and `document_field_value` carry a `confirmed_at`, the category
its `document.category_confirmed_at` — then empties `review_reasons` and moves
the document to `active`. The interface shows a "confirmed" badge in place of
the "auto" one.

Approving does not make those values manual. It used to, and the cost only
showed up later: an extraction rule fixed weeks after the fact no longer
touched the documents that had been through the queue, so a corrected layout
had to be re-applied by hand, document by document. A confirmed assignment is
still an automatic one — the next rule run, `document.reprocess` or a
re-applied document type refreshes it, and the confirmation is dropped along
with the value it described, which puts the "auto" badge back.

Only what someone typed is manual: `document.update` (which also fills
`manualFields`), `document.setCategory`, `document.setTags`,
`document.setFieldValue` and the bulk actions. Rejecting an assignment
(`review.rejectAssignment`) removes it outright and stays available on a
confirmed one, since confirming no longer disguises it as a hand entry.

## 1. Polling cadence

pg-boss only schedules one cron expression per queue name, and cron does not go
below the minute, so a per-source schedule is impossible. An `intake.poll`
dispatcher runs every minute instead: it reads the active sources and publishes
`intake.folder.poll` or `intake.mail.poll` for those whose last poll is older
than `pollSeconds`.

Consequence: `pollSeconds` is rounded up to the next minute, with a floor of
one minute. A folder set to 30 s is polled every minute. The "Run now" button
(`intakeSource.runNow`) publishes an immediate poll, without waiting for the
next round.

A failed poll interrupts nothing: the message lands in
`intake_source.last_error`, the other sources keep going, and every file seen
leaves a row in `intake_log` (`imported` · `duplicate` · `error` · `skipped`),
purged beyond 30 days when the server starts.

## 2. Watched folder

### Configuration

| Field         | Default | Role                                                        |
| ------------- | ------- | ----------------------------------------------------------- |
| `path`        | —       | Path **as seen by the server** (hence by the container)      |
| `recursive`   | `false` | Descends into subfolders (10 levels at most)                 |
| `pollSeconds` | `30`    | Desired cadence (see §1)                                     |
| `afterImport` | `keep`  | `delete`, `move` (with `moveTo`) or `keep`                   |
| `moveTo`      | —       | Required when `afterImport: "move"`                          |
| `filePattern` | —       | Regular expression on the name, for example `\.pdf$`         |

Ignored: hidden files (`.`), editor temporary files (`~`), and anything that is
neither a PDF nor an image. The type comes from the leading bytes rather than
the extension, so a `.pdf` that is not one is rejected.

Files still being written are handled by measuring the size of each candidate
twice, two seconds apart. A file that grows between the two measurements is
left for the next round, so a scanner writing slowly does not produce a
truncated PDF.

Content already present (same SHA-256) is logged `duplicate` and undergoes the
same `afterImport` as a successful import; otherwise a `keep` would re-import
endlessly. Content attached to a document in the trash is the exception: the
file is left in place, so the only remaining copy is not deleted.

### In Docker

Compose mounts a host folder on `/data/inbox`:

```bash
# docker/.env
INBOX_PATH_HOST=/srv/docstore/inbox   # host folder (default: ./inbox)
```

Then the source is created with `path: "/data/inbox"`, the container path. A
source always stores the path as the server sees it. The `INBOX_PATH` variable
is exposed to the server so that the interface can offer it by default.

```ts
await client.intakeSource.create({
  name: "Living room scanner",
  config: {
    type: "folder",
    path: "/data/inbox",
    recursive: true,
    pollSeconds: 60,
    afterImport: "move",
    moveTo: "/data/inbox/.processed",
    filePattern: "\\.(pdf|jpg|png)$",
  },
  defaults: { categoryId: "cat_…", sensitive: false },
});
```

## 3. Server-defined sources

A source can also be declared in the server configuration instead of being
created from the interface. That makes the deployment reproducible: the file
lives next to `docker-compose.yml`, it is versioned, and the database follows
it.

`DOCSTORE_CONFIG` gives the path of that file: `./docstore.config.json` in
development, `/data/config/docstore.json` in Docker. Only JSON is supported in
v1. An absent file is not an error; it declares nothing.

```json
{
  "intakeSources": [
    {
      "key": "inbox",
      "name": "Server inbox",
      "type": "folder",
      "config": { "path": "/data/inbox", "recursive": true }
    },
    {
      "key": "billing-mail",
      "type": "mail",
      "config": {
        "host": "imap.example.test",
        "username": "billing@example.test",
        "password": "${MAIL_PASSWORD}"
      }
    }
  ]
}
```

| Field      | Required | Role                                                          |
| ---------- | -------- | ------------------------------------------------------------- |
| `key`      | yes      | Identity of the source across restarts (`intake_source.managed_key`) |
| `type`     | yes      | `folder` or `mail`                                            |
| `name`     | no       | Displayed name; defaults to the key                           |
| `enabled`  | no       | `true` by default                                             |
| `config`   | yes      | The very fields of §2 and §4, minus `type` (already at the top) |
| `defaults` | no       | Same `{ categoryId, tagIds, partyId, sensitive }` as the API  |

`docstore.config.example.json` at the repository root is a complete example.

Any string of the file may reference an environment variable through a `${VAR}`
placeholder, which keeps the IMAP password out of a versioned file. The
substitution happens when the file is read: an unset or empty variable stops
the startup with a message naming both the variable and the field that uses it.
The password is then encrypted like any other (§7) before it reaches the
database.

At every startup `syncManagedIntakeSources` aligns the table with the file:
upsert by `key`, deletion of the managed rows whose key disappeared (their logs
go with them), and nothing at all for the sources created from the interface.
The operation is idempotent, so restarting the server without touching the file
changes no row. A summary is logged:

```text
[config] /data/config/docstore.json: 2 server-defined source(s) — 1 created, 0 updated, 1 unchanged, 0 removed.
```

In the API, those rows come back with `managed: true` and their `managedKey`,
and the interface shows them read-only. `update`, `delete` and `toggle` answer
`FORBIDDEN`; `runNow`, `test` and `logs` keep working, so a server-defined
source is polled, tested and audited like any other. To change one, edit the
file and restart.

When `INBOX_PATH` is set (it is, in Docker) and no folder source of the file
watches that path, the server synthesizes the managed source `inbox`:
recursive, `afterImport: "move"` into `<INBOX_PATH>/imported`. Dropping a file
in the mounted folder therefore works with no configuration at all. Declaring a
folder source on the same path, or a source whose key is `inbox`, takes
precedence over the shortcut.

`settings.serverInfo` reports what the server is running on:
`{ publicUrl, apiUrl, version, configPath, managedIntakeSources }`, where
`configPath` is exactly the file described here.

## 4. IMAP mailbox

One attachment = one document. The subject, the sender and the date of the
message are kept in `document.intake_meta`, which makes the `mail.from` and
`mail.subject` rule conditions usable (SPEC §3). `document.received_at` takes
the date of the mail.

| Field             | Default     | Role                                             |
| ----------------- | ----------- | ------------------------------------------------ |
| `host` / `port`   | — / `993`   | IMAP server                                      |
| `secure`          | `true`      | Implicit TLS                                     |
| `username`        | —           | Login                                            |
| `password`        | —           | **Plaintext on write only** (see §6)             |
| `mailbox`         | `INBOX`     | Polled mailbox                                   |
| `pollSeconds`     | `300`       | Desired cadence                                  |
| `onlyUnseen`      | `true`      | Only polls unread messages                       |
| `from`            | —           | Filter on the sender (substring)                 |
| `subjectPattern`  | —           | Regular expression on the subject                |
| `afterImport`     | `mark_seen` | `mark_seen`, `move` (with `moveTo`) or `delete`  |
| `attachmentsOnly` | `true`      | Only attachments are imported                    |
| `importBodyAsPdf` | `false`     | **Out of scope for v1**: `true` is rejected      |

A message without a usable attachment is logged `skipped` then acknowledged
like the others: it will not be seen again on every poll.

### Example: Gmail with an app password

Gmail rejects the account password over IMAP. You have to enable two-step
verification, create an app password
(<https://myaccount.google.com/apppasswords>), and enable IMAP in the Gmail
settings.

```ts
await client.intakeSource.create({
  name: "Invoices mailbox",
  config: {
    type: "mail",
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    username: "me@gmail.com",
    password: "abcd efgh ijkl mnop", // app password, 16 letters
    mailbox: "INBOX",
    onlyUnseen: true,
    from: "invoice@",
    afterImport: "move",
    moveTo: "docstore/processed",     // existing Gmail label
  },
});
```

`intakeSource.test` checks the connection and counts the candidate messages
without importing anything. An authentication error fills `last_error` and does
not prevent the other sources from running.

## 5. Public upload links

A link opens a `/u/<token>` URL on which anyone can upload files, without an
account. The token (32 random characters) is its only key, hence the
safeguards: expiry, number of uses, 10 files and 20 MB per file at most, 10
requests per minute and per IP.

```ts
const { link, url } = await client.uploadLink.create({
  name: "Accountant upload",
  message: "Please upload the 2026 balance sheets here.",
  expiresAt: "2026-12-31T23:59:59Z",
  maxUses: 5,
  defaults: { categoryId: "cat_comptabilite" },
});
console.log(url); // https://docs.exemple.fr/u/AbCd…
```

On the public side, `/u/<token>` is the web page: that is what `url` holds, and
what you hand to the third party. The page talks to the API on the same origin:

```http
GET /api/u/<token>
→ 200 { "name": "…", "message": "…", "expired": false, "remainingUses": 5 }
→ 404 when the token is unknown

POST /api/u/<token>        (multipart/form-data, "files" field, repeatable)
→ 201 { "created": [...], "duplicates": [...], "errors": [...] }
→ 410 link expired, exhausted or disabled
→ 429 beyond 10 requests per minute and per IP
```

The documents created belong to the link creator (the uploader has no account),
carry `source: "link"` and `source_ref` = identifier of the link, and receive
the `defaults` of the link. One upload consumes one use, whatever the number of
files.

The reverse proxy routes `/api*` to the API and everything else, `/u/<token>`
included, to the front end (`docker/Caddyfile`, matcher `@api`). `uploadLink.list`
returns the same `url` on every item, so the management screen never rebuilds it.

## 6. Webhooks

| Event                | When                                                     |
| -------------------- | -------------------------------------------------------- |
| `document.created`   | At intake, before any processing                         |
| `document.processed` | `finalize` made the document `active`                    |
| `document.review`    | `finalize` sent it to the "to review" queue              |
| `document.updated`   | `document.update` changed the metadata                   |
| `reminder.due`       | A reminder has just been created and its due date is reached |

```ts
const hook = await client.webhook.create({
  name: "Home Assistant",
  url: "https://ha.local/api/webhook/docstore",
  events: ["document.processed", "reminder.due"],
});
console.log(hook.secret); // signing key, to copy over to the recipient
await client.webhook.test({ id: hook.id }); // sends a "ping" event
```

Every delivery is a JSON `POST` carrying:

- `X-Docstore-Event`: name of the event;
- `X-Docstore-Delivery`: unique identifier of the delivery;
- `X-Docstore-Signature`: `sha256=<hex>`, HMAC-SHA256 of the **raw body** with
  the webhook secret.

Five retries with increasing delay on failure (non-2xx, timeout, connection
refused). Every attempt leaves a row in `webhook_delivery` with its number
(`attempt`), its HTTP code and its error. `webhook.deliveries` exposes them.

### Check the signature on the recipient side

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

Bun.serve({
  port: 8787,
  async fetch(request) {
    const body = await request.text(); // the RAW body, before any JSON.parse
    const expected = `sha256=${createHmac("sha256", process.env.DOCSTORE_WEBHOOK_SECRET!)
      .update(body, "utf8")
      .digest("hex")}`;
    const received = request.headers.get("X-Docstore-Signature") ?? "";

    const a = Buffer.from(expected);
    const b = Buffer.from(received);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return new Response("invalid signature", { status: 401 });
    }

    const payload = JSON.parse(body);
    console.log(payload.event, payload.document?.title);
    return new Response("ok");
  },
});
```

In Python:

```python
import hmac, hashlib
expected = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
assert hmac.compare_digest(expected, request.headers["X-Docstore-Signature"])
```

### `webhook` rule action

The `webhook { url }` action of the rule engine (SPEC §3) posts the document
summary to the given URL, with `X-Docstore-Event: rule.webhook`. Since the URL
is not a registered webhook, it has no secret, so no signature is set. Reserve
it for a trusted entry point (local network, token in the URL).

## 7. Password encryption

IMAP passwords are encrypted with AES-256-GCM using a key derived from
`APP_SECRET` (scrypt), in the format `v1.<iv>.<tag>.<encrypted>`. They never
come back out of the API: `intakeSource.get` returns `hasPassword: true` and
nothing more, and an update without `password` keeps the stored secret.

```bash
# apps/server/.env or docker/.env — 32 characters minimum
APP_SECRET=$(openssl rand -base64 32)
```

Changing or losing `APP_SECRET` makes the secrets unreadable: the mailbox
passwords have to be entered again.

## 8. oRPC procedures

| Procedure                  | Input                           | Output                       |
| -------------------------- | ------------------------------- | ---------------------------- |
| `intakeSource.list`        | `{}`                            | `IntakeSource[]`             |
| `intakeSource.get`         | `{ id }`                        | `IntakeSource`               |
| `intakeSource.create`      | `{ name, enabled?, config, defaults? }` | `IntakeSource`       |
| `intakeSource.update`      | `{ id, name?, enabled?, config?, defaults? }` | `IntakeSource`  |
| `intakeSource.delete`      | `{ id }`                        | `{ id, deleted }`            |
| `intakeSource.toggle`      | `{ id, enabled }`               | `IntakeSource`               |
| `intakeSource.runNow`      | `{ id }`                        | `{ id, jobId, queued }`      |
| `intakeSource.test`        | `{ id }` **or** `{ draft }`     | `{ ok, candidates, message }`|
| `intakeSource.logs`        | `{ id, page?, pageSize? }`      | `Paginated<IntakeLog>`       |
| `uploadLink.list`          | `{}`                            | `UploadLink[]`               |
| `uploadLink.create`        | `{ name, message?, expiresAt?, maxUses?, defaults?, enabled? }` | `{ link, url }` |
| `uploadLink.update`        | `{ id, … }`                     | `UploadLink`                 |
| `uploadLink.disable`       | `{ id }`                        | `UploadLink`                 |
| `uploadLink.delete`        | `{ id }`                        | `{ id, deleted }`            |
| `webhook.list`             | `{}`                            | `Webhook[]`                  |
| `webhook.create`           | `{ name, url, events, secret?, enabled? }` | `Webhook`         |
| `webhook.update`           | `{ id, … }`                     | `Webhook`                    |
| `webhook.delete`           | `{ id }`                        | `{ id, deleted }`            |
| `webhook.test`             | `{ id }`                        | `{ queued, jobId }`          |
| `webhook.deliveries`       | `{ id, page?, pageSize? }`      | `Paginated<WebhookDelivery>` |
| `settings.serverInfo`      | `{}`                            | `{ publicUrl, apiUrl, version, configPath, managedIntakeSources }` |

Writes (`create`, `update`, `delete`, `toggle`, `runNow`, `test`, `disable`)
require the `admin` scope when the caller is an API key: these objects carry
connection credentials, server paths and entry points into the database.

An `IntakeSource` also carries `managed` and `managedKey` (§3): `update`,
`delete` and `toggle` answer `FORBIDDEN` when `managed` is true. The MCP tool
`list_intake_sources` reports the same flag.
