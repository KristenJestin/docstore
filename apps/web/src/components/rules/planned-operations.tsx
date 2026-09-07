import type { PlannedOperation } from "@docstore/shared/rule";
import { Badge } from "@docstore/ui/components/badge";
import { useQuery } from "@tanstack/react-query";

import {
	DATE_PRECISION_LABELS,
	DOCUMENT_PARTY_ROLE_LABELS,
	formatConfidence,
} from "@/components/documents/document-labels";
import { orpc } from "@/utils/orpc";

/** Readable form of a value produced by an extraction. */
function formatValue(value: unknown): string {
	if (value === null || value === undefined) {
		return "—";
	}
	if (typeof value === "object") {
		return JSON.stringify(value);
	}
	return String(value);
}

export interface PlannedOperationListProps {
	operations: PlannedOperation[];
}

/**
 * Operations the engine would write (`rule.test`), rendered with the names of
 * the referenced categories, tags, parties and custom fields.
 */
export function PlannedOperationList({
	operations,
}: PlannedOperationListProps) {
	const tags = useQuery(orpc.tag.list.queryOptions({ input: {} }));
	const fields = useQuery(orpc.customField.list.queryOptions({ input: {} }));
	const parties = useQuery(
		orpc.party.list.queryOptions({
			input: { page: 1, pageSize: 100, includeArchived: true },
		}),
	);
	const documentTypes = useQuery(
		orpc.documentType.list.queryOptions({
			input: { recurringOnly: false, includeDisabled: true },
		}),
	);

	const tagName = (id: string) =>
		tags.data?.find((tag) => tag.id === id)?.name ?? id;
	const fieldName = (id: string) =>
		fields.data?.find((field) => field.id === id)?.name ?? id;
	const partyName = (id: string) =>
		parties.data?.items.find((party) => party.id === id)?.name ?? id;
	const documentTypeName = (id: string) =>
		documentTypes.data?.find((type) => type.id === id)?.name ?? id;

	if (operations.length === 0) {
		return (
			<p className="text-muted-foreground text-sm">
				No operation: the rule would leave this document untouched.
			</p>
		);
	}

	return (
		<ul data-testid="planned-actions" className="flex flex-col gap-1.5">
			{operations.map((operation, index) => (
				<li
					key={`${operation.type}-${index}`}
					className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-sm ring-1 ring-border"
				>
					<Badge
						tone={operation.type === "extraction_failed" ? "danger" : "outline"}
					>
						{operation.type}
					</Badge>
					<span className="min-w-0 flex-1 truncate">
						{describe(operation, {
							tagName,
							fieldName,
							partyName,
							documentTypeName,
						})}
					</span>
					<Confidence operation={operation} />
				</li>
			))}
		</ul>
	);
}

interface OperationNames {
	tagName: (id: string) => string;
	fieldName: (id: string) => string;
	partyName: (id: string) => string;
	documentTypeName: (id: string) => string;
}

function describe(operation: PlannedOperation, names: OperationNames): string {
	switch (operation.type) {
		case "add_tag":
			return names.tagName(operation.tagId);
		case "remove_tag":
			return names.tagName(operation.tagId);
		case "link_party":
			return `${names.partyName(operation.partyId)} · ${
				DOCUMENT_PARTY_ROLE_LABELS[operation.role]
			}`;
		case "set_field":
			return `${names.fieldName(operation.fieldId)} = ${formatValue(operation.value)}`;
		case "set_document_date":
			return `${operation.date} (${DATE_PRECISION_LABELS[operation.precision].toLowerCase()})`;
		case "set_period":
			return `from ${operation.start ?? "—"} to ${operation.end ?? "—"}`;
		case "set_valid_until":
			return operation.date;
		case "set_title":
			return operation.title;
		case "set_sensitive":
			return operation.sensitive ? "Sensitive" : "Not sensitive";
		case "webhook":
			return operation.url;
		case "set_document_type":
			return names.documentTypeName(operation.documentTypeId);
		case "extraction_failed":
			return `${operation.extractionRuleName} produced no value`;
		default:
			return "";
	}
}

function Confidence({ operation }: { operation: PlannedOperation }) {
	if (!("confidence" in operation) || operation.confidence === null) {
		return null;
	}
	const score = formatConfidence(operation.confidence);
	return score ? (
		<Badge tone={operation.confidence < 0.75 ? "warning" : "success"}>
			{score}
		</Badge>
	) : null;
}
