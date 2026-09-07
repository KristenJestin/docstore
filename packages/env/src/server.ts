import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
	server: {
		DATABASE_URL: z.string().min(1),
		BETTER_AUTH_SECRET: z.string().min(32),
		BETTER_AUTH_URL: z.url(),
		CORS_ORIGIN: z.url(),
		/**
		 * Encryption secret for data at rest (IMAP passwords, iteration 6;
		 * sensitive documents at iteration 7). 32 characters minimum. Generate
		 * one with `openssl rand -base64 32`.
		 *
		 * Changing it makes already-encrypted secrets unreadable.
		 */
		APP_SECRET: z.string().min(32),
		/**
		 * Public origin of the **web** app: the base of the pages handed to third
		 * parties, `/u/<token>` (upload links) and `/s/<token>` (share links).
		 *
		 * Not the API origin: those pages call the API under `/api/…` on the same
		 * origin, behind the reverse proxy. When absent, `BETTER_AUTH_URL` takes
		 * over.
		 */
		PUBLIC_URL: z.url().optional(),
		NODE_ENV: z
			.enum(["development", "production", "test"])
			.default("development"),
		/** Test database used by the integration tests. */
		DATABASE_URL_TEST: z.string().min(1).optional(),
		/** Root of the file storage (filesystem driver). */
		STORAGE_PATH: z.string().min(1).default("./data/storage"),
		/**
		 * Drop folder mounted in the container (`/data/inbox`). Used as the
		 * suggested value for a "watched folder" intake source.
		 */
		INBOX_PATH: z.string().min(1).optional(),
		/**
		 * Server configuration file (JSON): intake sources declared next to the
		 * deployment rather than in the database. Absent file = no managed
		 * source. Docker points it at `/data/config/docstore.json`.
		 */
		DOCSTORE_CONFIG: z.string().min(1).default("./docstore.config.json"),
		/** External binaries; empty = looked up on the PATH. */
		TESSERACT_PATH: z.string().min(1).optional(),
		TESSDATA_PREFIX: z.string().min(1).optional(),
		POPPLER_PATH: z.string().min(1).optional(),
		/** Starts the intake worker inside the server process. */
		WORKER_ENABLED: z
			.union([z.boolean(), z.enum(["true", "false", "1", "0"])])
			.transform((value) =>
				typeof value === "boolean" ? value : value === "true" || value === "1",
			)
			.default(true),
	},
	runtimeEnv: process.env,
	skipValidation: !!process.env.SKIP_ENV_VALIDATION,
	emptyStringAsUndefined: true,
});
