# docstore deployment (Docker Compose)

Production stack: Caddy (reverse proxy + TLS) → api (Hono/oRPC, port 3000) and
web (SSR TanStack Start, port 3001) → Postgres 18.

`api` and `web` share the same `docstore-app` image, built from the monorepo
root; the argument passed to the entrypoint (`api` or `web`) decides which
process is started. The `api` container applies the Drizzle migrations on
startup.

Caddy serves the front end and the API on the same origin, which avoids every
CORS and session cookie problem:

| Path | Service |
| --- | --- |
| `/rpc*`, `/api*`, `/files*`, `/health`, `/mcp*` | `api:3000` |
| everything else (SSR + assets) | `web:3001` |

`/api*` covers `/api/auth/*`, `/api-reference`, `POST /api/export` and the two
unauthenticated families `/api/u/*` and `/api/s/*`. The bare `/u/<token>` and
`/s/<token>` are the pages that call them, and stay on the front end.

## Requirements

- Docker Engine 24+ with the Compose v2 plugin (`docker compose version`).
- About 4 GB of disk space (the image is ~1.8 GB: Debian + Bun + tesseract + poppler + `node_modules`).
- Ports 80 and 443 free on the host (configurable through `HTTP_PORT` / `HTTPS_PORT`).
- For automatic TLS: a domain pointing at the machine, ports 80 and 443 reachable from the Internet.

## Getting started

```sh
cp docker/.env.example docker/.env   # 1. fill in the secrets (see below)
bun run docker:build                 # 2. build the image
bun run docker:up                    # 3. start the stack
```

The application is then available at `PUBLIC_URL` (by default <http://localhost>).

Useful commands:

```sh
docker compose -f docker/docker-compose.yml ps
docker compose -f docker/docker-compose.yml logs -f api
bun run docker:down                  # stop (volumes are kept)
```

## Variables (`docker/.env`)

| Variable | Role |
| --- | --- |
| `DOMAIN` | Domain served by Caddy. Empty = plain HTTP on `HTTP_PORT`. Set = HTTPS + automatic Let's Encrypt. |
| `ACME_EMAIL` | Let's Encrypt contact (optional). |
| `PUBLIC_URL` | Full public URL of the **web** app (front-end and API share this origin behind Caddy). Feeds `BETTER_AUTH_URL`, `CORS_ORIGIN`, the API URL of the front-end bundle, and the public links handed to third parties (`/u/<token>`, `/s/<token>`). |
| `HTTP_PORT` / `HTTPS_PORT` | Ports published on the host (80 / 443 by default). |
| `MAX_UPLOAD_SIZE` | Maximum size of an upload accepted by Caddy. |
| `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD` | Database credentials. |
| `DATABASE_URL` | Must repeat the three values above, host `postgres`. |
| `BETTER_AUTH_SECRET` | Session signing secret, 32 characters minimum. |
| `STORAGE_PATH` | Root of the files in the `docstore_data` volume (`/data/storage`). |
| `INBOX_PATH_HOST` | Host drop folder mounted on `/data/inbox` (default `./inbox`). Watched out of the box: files are imported then moved into `imported/`. |
| `CONFIG_PATH_HOST` | Host folder mounted **read-only** on `/data/config` (default `./config`), holding the optional `docstore.json` (see below). |
| `WORKER_ENABLED` / `WORKER_CONCURRENCY` | Ingestion worker (OCR, extraction) in the `api` container. |
| `TESSERACT_PATH` / `POPPLER_PATH` / `TESSDATA_PREFIX` | External binaries. Leave the first two empty: they are already on the image `PATH`. |

Generating the secrets:

```sh
openssl rand -base64 32   # BETTER_AUTH_SECRET
openssl rand -base64 24   # POSTGRES_PASSWORD
```

> `PUBLIC_URL` is frozen into the front-end bundle at build time.
> Any change requires a `bun run docker:build` followed by a `bun run docker:up`.
> With a non-standard `HTTP_PORT`, include it in the URL
> (`PUBLIC_URL=http://localhost:8080`).

## Version of the image

The version shown in Settings → General and returned by `settings.serverInfo`
is the `version` of the root `package.json`: `bun run build` projects it into
`packages/shared/src/version.ts` (`scripts/sync-version.ts`) before compiling,
and the image build runs that same command. An image therefore always reports
the version of the sources it was built from — bump the manifest, rebuild.

A build can stamp another value, for a nightly or a fork:

```sh
docker build -f docker/Dockerfile --build-arg APP_VERSION=2.1.0-rc.1 .
```

## Server configuration file (intake sources)

The stack mounts `${CONFIG_PATH_HOST:-./config}` read-only on `/data/config`
and points `DOCSTORE_CONFIG` at `/data/config/docstore.json`. That optional
JSON file declares intake sources in the deployment itself, instead of in the
database:

```sh
mkdir -p docker/config
cp docstore.config.example.json docker/config/docstore.json
docker compose -f docker/docker-compose.yml restart api
```

Those sources are recreated at every startup, appear read-only in the
interface, and disappear from the database when they leave the file. Secrets
stay out of it: `"password": "${MAIL_PASSWORD}"` is resolved from
`docker/.env` at load time, and an unset variable stops the `api` container
with a message naming it (`docker compose logs api`).

Without a file, `/data/inbox` is still watched (see `INBOX_PATH_HOST`). The
format is described in `docs/ingestion.md` §3.

## Updating

```sh
git pull
bun run docker:build
bun run docker:up            # recreates the containers, migrations replayed on startup
docker image prune -f        # optional: cleans up orphaned images
```

## Backup

Two things to back up: the database and the file volume.

```sh
# Database
docker compose -f docker/docker-compose.yml exec -T postgres \
  pg_dump -U docstore -d docstore --format=custom > docstore-$(date +%F).dump

# Files (docstore_data volume)
docker run --rm -v docstore-prod_docstore_data:/data -v "$PWD":/backup alpine \
  tar czf /backup/docstore-data-$(date +%F).tar.gz -C /data .
```

## Restore

```sh
bun run docker:up

# Files
docker run --rm -v docstore-prod_docstore_data:/data -v "$PWD":/backup alpine \
  sh -c 'rm -rf /data/* && tar xzf /backup/docstore-data-YYYY-MM-DD.tar.gz -C /data'

# Database (the database must be empty: recreate it if needed)
docker compose -f docker/docker-compose.yml exec -T postgres \
  psql -U docstore -d postgres -c 'DROP DATABASE docstore;' -c 'CREATE DATABASE docstore OWNER docstore;'
docker compose -f docker/docker-compose.yml exec -T postgres \
  pg_restore -U docstore -d docstore --no-owner < docstore-YYYY-MM-DD.dump

docker compose -f docker/docker-compose.yml restart api web
```

## Full reset

```sh
docker compose -f docker/docker-compose.yml down -v   # ⚠ deletes the database AND the files
```

## Notes

- Postgres publishes no port on the host: it is only reachable from the compose
  network. The development Postgres (`docstore-postgres`, port 5434) is
  independent of this stack.
- The `api` health probe queries `/health` and falls back to `/` as long as
  that route does not exist. `/health` reports the queue, the storage
  (`{ path, writable }`, checked by a real write), the OCR binaries
  (`{ tesseract, poppler }`) and whether encryption at rest is armed. All of
  them are `false` on a degraded server that started without its ingestion
  pipeline.
- `tesseract` (fra + eng) and `poppler-utils` are installed in the image:
  `TESSERACT_PATH` and `POPPLER_PATH` can stay empty.
