import {
	activityEntrySchema,
	listActivityInput,
	maskSensitiveActivity,
} from "@docstore/shared/activity";
import { paginatedSchema } from "@docstore/shared/pagination";
import { maskPartyActivityEntry } from "@docstore/shared/party-masking";
import { protectedProcedure } from "../index";
import { listActivity } from "../services/activity.service";

const TAGS = ["Activity"];

export const activityRouter = {
	list: protectedProcedure
		.route({
			method: "GET",
			path: "/activity",
			tags: TAGS,
			summary: "Activity log: who changed or read what (newest first)",
			description:
				"One entry per change (web, API, MCP, rules, pipeline) and per traced read (document detail, OCR text, file download, export, search by an API key). Filter by `since`, `actorKeyId`, `objectId`, `action` (exact, or a prefix ending with a dot such as `document.`), `kind`, `sensitive`. An agent can list what it did itself with its own key id.",
		})
		.input(listActivityInput)
		.output(paginatedSchema(activityEntrySchema))
		.handler(async ({ input, context }) => {
			const page = await listActivity(context.db, input);
			return {
				...page,
				// Field values of sensitive documents (#22) and Party identifiers
				// (#23) are withheld from a key without `sensitive`.
				items: page.items.map((entry) =>
					maskPartyActivityEntry(
						maskSensitiveActivity(entry, context.apiKey),
						context.apiKey,
					),
				),
			};
		}),
};
