import {
	exportDocumentsInput,
	exportPreviewSchema,
} from "@docstore/shared/export";
import { ORPCError } from "@orpc/server";
import { protectedProcedure, requireScope } from "../index";
import { previewExport } from "../services/export.service";

const TAGS = ["Export"];

/**
 * Tree export (SPEC §8 iteration 7).
 *
 * Only the preview lives on oRPC: the archive itself is served by `POST
 * /api/export` (`apps/server/src/export.ts`), which can stream a ZIP straight
 * to the browser instead of buffering it through an RPC envelope.
 */
export const exportRouter = {
	preview: protectedProcedure
		.use(requireScope("read"))
		.route({
			method: "POST",
			path: "/export/preview",
			tags: TAGS,
			summary: "Count, total size and first paths the export would produce",
			description:
				"Same input as `POST /api/export`. `includeSensitive` requires the `sensitive` scope when the caller is an API key.",
		})
		.input(exportDocumentsInput)
		.output(exportPreviewSchema)
		.handler(({ input, context }) => {
			if (
				input.includeSensitive &&
				context.apiKey &&
				!context.apiKey.scopes.some(
					(scope) => scope === "sensitive" || scope === "admin",
				)
			) {
				throw new ORPCError("FORBIDDEN", {
					message: 'This API key does not have the "sensitive" scope.',
				});
			}
			return previewExport(context.db, input);
		}),
};
