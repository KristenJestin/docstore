# syntax=docker/dockerfile:1
#
# Single docstore image: it holds both the API (Hono/oRPC) and the front-end
# (TanStack Start SSR). The service to run is picked by the argument passed to
# the entrypoint (`api` or `web`).
#
# Expected build context: the monorepo root.
#   docker build -f docker/Dockerfile .

# --------------------------------------------------------------------------
# deps: full install (dev + prod) so that the build can run
# --------------------------------------------------------------------------
FROM oven/bun:1.3 AS deps
WORKDIR /app

# Only the manifests are copied: the install layer stays cached as long as no
# dependency changes.
COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/api/package.json packages/api/
COPY packages/auth/package.json packages/auth/
COPY packages/config/package.json packages/config/
COPY packages/db/package.json packages/db/
COPY packages/env/package.json packages/env/
COPY packages/ingestion/package.json packages/ingestion/
COPY packages/mcp/package.json packages/mcp/
COPY packages/rules/package.json packages/rules/
COPY packages/ocr/package.json packages/ocr/
COPY packages/shared/package.json packages/shared/
COPY packages/storage/package.json packages/storage/
COPY packages/ui/package.json packages/ui/

# `--linker hoisted`: a single node_modules at the root. The produced bundles
# (tsdown server, Vite SSR) then resolve all their external dependencies from
# /app/node_modules, whatever workspace the inlined code came from.
RUN bun install --frozen-lockfile --linker hoisted

# --------------------------------------------------------------------------
# prod-deps: slimmed down node_modules for the final image
#
# A plain `bun install --production` is not enough: the TanStack Start SSR
# bundle externalizes @tanstack/react-query-devtools and
# @tanstack/react-router-devtools, which are devDependencies. So we start from
# the full install and only remove build tools that can never be imported by
# application code.
# --------------------------------------------------------------------------
FROM deps AS prod-deps
WORKDIR /app

RUN rm -rf \
	node_modules/@biomejs \
	node_modules/@turbo \
	node_modules/turbo \
	node_modules/@playwright \
	node_modules/playwright \
	node_modules/playwright-core \
	node_modules/lefthook \
	node_modules/lefthook-* \
	node_modules/drizzle-kit \
	node_modules/tsdown

# --------------------------------------------------------------------------
# build: turbo build (server through tsdown, front-end through Vite/TanStack Start)
# --------------------------------------------------------------------------
FROM oven/bun:1.3 AS build
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Public URL of the stack. The TanStack Start client bundle inlines it at build
# time (VITE_SERVER_URL), so the image must be rebuilt if the domain changes.
# Front-end and API are served by the same Caddy, hence the same origin.
ARG PUBLIC_URL=http://localhost
ENV VITE_SERVER_URL=${PUBLIC_URL}
ENV NODE_ENV=production
# The @t3-oss/env validation does not need to run during the build (no DB, no
# secret): only the VITE_ variables are actually inlined.
ENV SKIP_ENV_VALIDATION=1

RUN bun run build

# --------------------------------------------------------------------------
# runtime: final image (Debian slim + tesseract + poppler)
# --------------------------------------------------------------------------
FROM oven/bun:1.3-slim AS runtime

RUN apt-get update \
	&& apt-get install -y --no-install-recommends \
		tesseract-ocr \
		tesseract-ocr-fra \
		tesseract-ocr-eng \
		poppler-utils \
		ca-certificates \
		curl \
	&& rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production \
	PORT=3000 \
	STORAGE_PATH=/data/storage

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY packages/db/src/migrations ./packages/db/src/migrations
COPY docker/entrypoint.sh docker/web-server.mjs ./docker/
# Placed next to the migrations folder: module resolution (drizzle-orm, pg)
# works even without hoisting.
COPY docker/migrate.mjs ./packages/db/migrate.mjs

RUN chmod +x /app/docker/entrypoint.sh \
	&& mkdir -p /data/storage \
	&& groupadd --system docstore \
	&& useradd --system --gid docstore --home-dir /app --shell /usr/sbin/nologin docstore \
	&& chown -R docstore:docstore /app /data

USER docstore

VOLUME ["/data"]
EXPOSE 3000 3001

# API health probe. The `web` service overrides its own probe in the compose
# file. `/health` is the target route; falls back to `/` while it does not exist.
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
	CMD curl -fsS http://127.0.0.1:${PORT:-3000}/health \
		|| curl -fsS http://127.0.0.1:${PORT:-3000}/ \
		|| exit 1

ENTRYPOINT ["/app/docker/entrypoint.sh"]
CMD ["api"]
