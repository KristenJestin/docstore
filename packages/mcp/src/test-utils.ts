import { fileURLToPath } from "node:url";
import { createId } from "@docstore/db/id";
import { user } from "@docstore/db/schema/auth";
import type { TestDb } from "@docstore/db/test-utils";
import type { IngestionBinding } from "@docstore/ingestion";
import type { ApiKeyScope } from "@docstore/shared/api-key";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import dotenv from "dotenv";
import { createMcpServer } from "./server";

// Dev env vars (test DB, binaries) live in apps/server/.env.
dotenv.config({
	path: fileURLToPath(new URL("../../../apps/server/.env", import.meta.url)),
	quiet: true,
});

/** PDF fixture shared with `@docstore/ocr`. */
export const TEXT_LAYER_PDF = fileURLToPath(
	new URL("../../ocr/test/fixtures/text-layer.pdf", import.meta.url),
);

export interface McpTestHarness {
	client: Client;
	close(): Promise<void>;
}

/**
 * MCP client connected to the server through an in-memory transport: the
 * protocol is really exercised (initialize, tools/list, tools/call) without
 * going through HTTP.
 */
export async function createMcpTestClient(options: {
	db: TestDb;
	userId: string;
	scopes: ApiKeyScope[];
	ingestion?: IngestionBinding;
}): Promise<McpTestHarness> {
	const server = createMcpServer({
		db: options.db,
		ingestion: options.ingestion,
		principal: { userId: options.userId, scopes: options.scopes },
	});

	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair();
	const client = new Client({ name: "test-client", version: "0.0.0" });

	await Promise.all([
		server.connect(serverTransport),
		client.connect(clientTransport),
	]);

	return {
		client,
		close: async () => {
			await client.close();
			await server.close();
		},
	};
}

/** Creates a user: `document.created_by_id` references it. */
export async function insertTestUser(db: TestDb): Promise<string> {
	const id = createId("usr_");
	await db.insert(user).values({
		id,
		name: "Camille Moreau",
		email: `${id}@example.test`,
	});
	return id;
}
