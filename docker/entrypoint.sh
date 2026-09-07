#!/bin/sh
# Entry point of the docstore image.
#   api  -> applies the Drizzle migrations then starts the Hono/oRPC server
#   web  -> starts the TanStack Start SSR server
# Any other value is executed as-is (useful for `docker compose run`).
set -eu

case "${1:-api}" in
api)
	echo "[docstore] applying Drizzle migrations..."
	bun run /app/packages/db/migrate.mjs
	echo "[docstore] starting the API on port ${PORT:-3000}"
	exec bun run /app/apps/server/dist/index.mjs
	;;
web)
	echo "[docstore] starting the SSR front-end on port ${PORT:-3001}"
	exec bun run /app/docker/web-server.mjs
	;;
*)
	exec "$@"
	;;
esac
