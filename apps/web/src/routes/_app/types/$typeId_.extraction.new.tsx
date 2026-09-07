import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { ExtractionRuleEditor } from "@/components/rules/extraction-rule-editor";

/**
 * `layoutId` is set by the "Add extraction rule" button of the Layouts tab: an
 * extraction rule only exists inside a layout of a document type (SPEC §9), so
 * the editor always opens prefilled with it.
 */
const searchSchema = z.object({
	layoutId: z.string().min(1).optional().catch(undefined),
});

export const Route = createFileRoute("/_app/types/$typeId_/extraction/new")({
	validateSearch: searchSchema,
	component: NewExtractionRulePage,
});

function NewExtractionRulePage() {
	const { typeId } = Route.useParams();
	const { layoutId } = Route.useSearch();
	return <ExtractionRuleEditor documentTypeId={typeId} layoutId={layoutId} />;
}
