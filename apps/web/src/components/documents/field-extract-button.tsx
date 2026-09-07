import type {
	CustomField,
	CustomFieldValue,
} from "@docstore/shared/custom-field";
import type { DocumentDetail } from "@docstore/shared/document";
import type {
	ExtractionResult,
	ExtractionRule,
} from "@docstore/shared/extraction";
import { Badge } from "@docstore/ui/components/badge";
import { Button } from "@docstore/ui/components/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@docstore/ui/components/popover";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ScanTextIcon } from "lucide-react";
import { useState } from "react";

import { MonoLabel } from "@/components/mono-label";
import { toastApiError } from "@/lib/api-error";
import { orpc } from "@/utils/orpc";

import { formatConfidence } from "./document-labels";

/**
 * Among the rules of the layout the document carries, those targeting this
 * custom field. The scope itself is resolved by the server
 * (`extractionRule.applicable`): a rule only exists inside a layout (SPEC §9).
 */
function rulesForField(
	rules: ExtractionRule[],
	field: CustomField,
): ExtractionRule[] {
	return rules.filter(
		(rule) => rule.target.kind === "field" && rule.target.fieldId === field.id,
	);
}

/** Extracted value cast into the typed shape the field expects. */
function toFieldValue(
	field: CustomField,
	result: ExtractionResult,
): CustomFieldValue | null {
	const raw = result.value ?? result.raw;
	if (raw === null || raw === undefined) {
		return null;
	}
	const text = String(raw).trim();
	if (text.length === 0) {
		return null;
	}
	switch (field.type) {
		case "number": {
			const value = Number(text);
			return Number.isFinite(value) ? { kind: "number", number: value } : null;
		}
		case "money": {
			const amount = Number(text);
			return Number.isFinite(amount)
				? {
						kind: "money",
						amount,
						currency: field.options.currency ?? "EUR",
					}
				: null;
		}
		case "date":
			return /^\d{4}-\d{2}-\d{2}$/.test(text)
				? { kind: "date", date: text }
				: null;
		case "boolean":
			return { kind: "boolean", boolean: text.toLowerCase() !== "false" };
		case "select":
			return field.options.choices?.includes(text)
				? { kind: "select", choice: text }
				: null;
		case "url":
			return { kind: "url", url: text };
		case "party_ref":
			return null;
		default:
			return { kind: "text", text };
	}
}

export interface FieldExtractButtonProps {
	document: DocumentDetail;
	field: CustomField;
	/** Called once the value has been written, to refresh the document. */
	onApplied: () => Promise<unknown>;
}

/**
 * "Extract" button of a custom field: lists the extraction rules of the layout
 * the document carries (`extractionRule.applicable`), runs the chosen one
 * through `extractionRule.test`, shows the value with its confidence and writes
 * it with `document.setFieldValue({ source: "rule", confidence })` — the value
 * keeps the score of the extraction rather than passing for a manual entry.
 */
export function FieldExtractButton({
	document,
	field,
	onApplied,
}: FieldExtractButtonProps) {
	const [open, setOpen] = useState(false);
	const [result, setResult] = useState<{
		rule: ExtractionRule;
		outcome: ExtractionResult;
	} | null>(null);

	const rules = useQuery(
		orpc.extractionRule.applicable.queryOptions({
			input: { documentId: document.id },
		}),
	);
	const test = useMutation(orpc.extractionRule.test.mutationOptions());
	const setFieldValue = useMutation(
		orpc.document.setFieldValue.mutationOptions(),
	);

	const candidates = rulesForField(rules.data ?? [], field);
	if (candidates.length === 0) {
		return null;
	}

	const runTest = async (rule: ExtractionRule) => {
		try {
			const outcome = await test.mutateAsync({
				extractionRuleId: rule.id,
				documentId: document.id,
			});
			setResult({ rule, outcome });
		} catch (error) {
			setResult(null);
			toastApiError(error, "The extraction could not be run.");
		}
	};

	const applyValue = async () => {
		if (!result) {
			return;
		}
		const value = toFieldValue(field, result.outcome);
		if (!value) {
			toastApiError(
				new Error("empty"),
				`The extracted value does not fit a ${field.type} field.`,
			);
			return;
		}
		try {
			await setFieldValue.mutateAsync({
				id: document.id,
				fieldId: field.id,
				value,
				source: "rule",
				confidence: result.outcome.confidence,
			});
			await onApplied();
			setOpen(false);
			setResult(null);
		} catch (error) {
			toastApiError(error, "The value could not be saved.");
		}
	};

	return (
		<Popover
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (!next) {
					setResult(null);
				}
			}}
		>
			<PopoverTrigger
				render={
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={`Extract ${field.name} from the document`}
					/>
				}
			>
				<ScanTextIcon />
			</PopoverTrigger>
			<PopoverContent align="end" className="w-72">
				<MonoLabel>Extraction rules</MonoLabel>
				<ul className="mt-2 flex flex-col gap-1">
					{candidates.map((rule) => (
						<li key={rule.id}>
							<Button
								variant="ghost"
								size="sm"
								className="w-full justify-start"
								disabled={test.isPending}
								onClick={() => runTest(rule)}
							>
								<span className="min-w-0 flex-1 truncate text-left">
									{rule.name}
								</span>
							</Button>
						</li>
					))}
				</ul>

				{result ? (
					<div className="mt-3 flex flex-col gap-2 border-border border-t pt-3">
						<div className="flex items-center gap-2">
							<span className="min-w-0 flex-1 truncate font-mono text-sm">
								{result.outcome.raw === null
									? "No value"
									: String(result.outcome.value ?? result.outcome.raw)}
							</span>
							<Badge tone={result.outcome.raw === null ? "danger" : "success"}>
								{formatConfidence(result.outcome.confidence)}
							</Badge>
						</div>
						<Button
							size="sm"
							disabled={result.outcome.raw === null || setFieldValue.isPending}
							onClick={applyValue}
						>
							Apply the value
						</Button>
					</div>
				) : null}
			</PopoverContent>
		</Popover>
	);
}
