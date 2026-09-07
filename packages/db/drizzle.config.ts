import dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";

dotenv.config({
	path: "../../apps/server/.env",
});

export default defineConfig({
	// index.ts re-exports the whole schema: prevents drizzle-kit from also
	// loading the test files in the folder (`bun:test` import is not resolvable
	// by the CLI).
	schema: "./src/schema/index.ts",
	out: "./src/migrations",
	dialect: "postgresql",
	dbCredentials: {
		url: process.env.DATABASE_URL || "",
	},
});
