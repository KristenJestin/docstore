import type { Db } from "@docstore/db";
import type { Actor, IngestionBinding } from "@docstore/ingestion";
import { runAsActor } from "@docstore/ingestion";
import type { ApiKeyScope } from "@docstore/shared/api-key";
import { hasScope, mayReadSensitive } from "@docstore/shared/api-key";
import type {
	McpServer,
	ToolCallback,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ZodRawShape, z } from "zod";

/** Caller of the MCP server: always an API key (SPEC §6). */
export interface McpPrincipal {
	userId: string;
	scopes: ApiKeyScope[];
	/** Id of the key: every change and read of the tools is logged under it. */
	keyId?: string;
	/** Name of the key, shown by the activity log and the webhooks. */
	keyName?: string;
}

/** The actor of the tool calls of a server, set by `createMcpServer`. */
const serverActors = new WeakMap<McpServer, Actor>();

/**
 * Who the tools of `server` act for (issue #15): the key of the principal.
 * Without a key id (a test harness), the session of its user.
 */
export function bindMcpActor(server: McpServer, principal: McpPrincipal): void {
	serverActors.set(
		server,
		principal.keyId
			? {
					type: "api_key",
					apiKeyId: principal.keyId,
					userId: principal.userId,
					name: principal.keyName ?? null,
				}
			: { type: "user", userId: principal.userId },
	);
}

export interface McpContext {
	db: Db;
	/** Absent on a degraded server: upload and reprocessing are refused. */
	ingestion?: IngestionBinding;
	principal: McpPrincipal;
}

/** Runs `fn` on behalf of the key bound to `server`, if any. */
export function runAsMcpActor<T>(
	server: McpServer,
	fn: () => Promise<T>,
): Promise<T> {
	const actor = serverActors.get(server);
	return actor ? runAsActor(actor, fn) : fn();
}

/** Business error returned as-is to the agent (`isError: true`). */
export class McpToolError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "McpToolError";
	}
}

/** Every mutation requires the `write` scope. */
export function requireWrite(context: McpContext): void {
	if (!hasScope(context.principal.scopes, "write")) {
		throw new McpToolError(
			"Write refused: this API key does not have the `write` scope.",
		);
	}
}

/**
 * Every read requires the `read` scope, like `protectedProcedure` on oRPC and
 * the `/files` routes (issue #1).
 */
export function requireRead(context: McpContext): void {
	if (!hasScope(context.principal.scopes, "read")) {
		throw new McpToolError(
			"Read refused: this API key does not have the `read` scope.",
		);
	}
}

/** Same decision as oRPC and `/files` (`mayReadSensitive`, D-01 of #1). */
export function canReadSensitive(context: McpContext): boolean {
	return mayReadSensitive(context.principal);
}

export function requireIngestion(context: McpContext): IngestionBinding {
	if (!context.ingestion) {
		throw new McpToolError(
			"The ingestion pipeline is not available on this server.",
		);
	}
	return context.ingestion;
}

/** Readable message for any error (ORPCError, Error, raw value). */
export function errorMessage(error: unknown): string {
	if (error instanceof Error && error.message) return error.message;
	return String(error);
}

/** Values of a Zod shape (input arguments, structured output). */
export type ShapeValue<Shape extends ZodRawShape> = z.output<
	z.ZodObject<Shape>
>;

export interface ToolDefinition<
	Input extends ZodRawShape,
	Output extends ZodRawShape,
> {
	title: string;
	description: string;
	/** Always provided (`{}` for a tool without arguments). */
	inputSchema: Input;
	outputSchema: Output;
	/** Readable text that mirrors the structured output. */
	text: (output: ShapeValue<Output>) => string;
}

/**
 * Registers a tool while normalising two things: the readable text block that
 * accompanies the structured output, and the translation of errors into an
 * `isError` result rather than a JSON-RPC exception.
 *
 * Both type parameters are inferred from the declared Zod shapes: the handler
 * is therefore forced to return exactly the announced output.
 */
export function defineTool<
	Input extends ZodRawShape,
	Output extends ZodRawShape,
>(
	server: McpServer,
	name: string,
	definition: ToolDefinition<Input, Output>,
	handler: (input: ShapeValue<Input>) => Promise<ShapeValue<Output>>,
): void {
	const callback = async (
		input: ShapeValue<Input>,
	): Promise<CallToolResult> => {
		try {
			const output = await runAsMcpActor(server, () => handler(input));
			return {
				content: [{ type: "text", text: definition.text(output) }],
				structuredContent: output as Record<string, unknown>,
			};
		} catch (error) {
			return {
				isError: true,
				content: [{ type: "text", text: errorMessage(error) }],
			};
		}
	};

	server.registerTool(
		name,
		{
			title: definition.title,
			description: definition.description,
			inputSchema: definition.inputSchema,
			outputSchema: definition.outputSchema,
		},
		callback as unknown as ToolCallback<Input>,
	);
}
