import type { Db } from "@docstore/db";
import type { IngestionBinding } from "@docstore/ingestion";
import type { ApiKeyScope } from "@docstore/shared/api-key";
import { hasScope } from "@docstore/shared/api-key";
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
}

export interface McpContext {
	db: Db;
	/** Absent on a degraded server: upload and reprocessing are refused. */
	ingestion?: IngestionBinding;
	principal: McpPrincipal;
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

export function canReadSensitive(context: McpContext): boolean {
	return hasScope(context.principal.scopes, "sensitive");
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
			const output = await handler(input);
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
