import { DOCUMENT_SOURCES } from "@docstore/shared/document";
import type {
	RuleComparator,
	RuleConditionField,
	RuleConditionValue,
} from "@docstore/shared/rule";
import { Input } from "@docstore/ui/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@docstore/ui/components/select";
import { ArrowRightIcon } from "lucide-react";

import { ChipsInput } from "@/components/chips-input";
import { DatePicker } from "@/components/date-picker";
import { CategoryPicker } from "@/components/documents/category-picker";
import { TagInput } from "@/components/documents/tag-input";
import { IconLabel, iconLabelItems } from "@/components/icon-label";
import {
	PartyMultiPicker,
	PartyPicker,
} from "@/components/parties/party-picker";
import { CategoryMultiSelect } from "@/components/settings/category-multi-select";
import {
	DOCUMENT_SOURCE_ICONS,
	DOCUMENT_SOURCE_LABELS,
	regexError,
	ruleFieldKind,
	valueControlFor,
} from "./rule-labels";

const SOURCE_ITEMS = iconLabelItems(
	DOCUMENT_SOURCES,
	DOCUMENT_SOURCE_LABELS,
	DOCUMENT_SOURCE_ICONS,
);

/** Presence of a value: the engine reads `value === false` as "absent". */
const PRESENCE_LABELS: Record<string, string> = {
	present: "Is present",
	absent: "Is absent",
};

function toStringList(value: RuleConditionValue | undefined): string[] {
	if (value === undefined || typeof value === "boolean") {
		return [];
	}
	if (Array.isArray(value)) {
		return value.map(String);
	}
	return [String(value)];
}

function firstString(value: RuleConditionValue | undefined): string {
	return toStringList(value)[0] ?? "";
}

export interface ConditionValueInputProps {
	field: RuleConditionField;
	cmp: RuleComparator;
	value: RuleConditionValue | undefined;
	flags: string | undefined;
	onValueChange: (value: RuleConditionValue | undefined) => void;
	onFlagsChange: (flags: string | undefined) => void;
	id?: string;
}

/**
 * Operand editor of a condition leaf: the control adapts to the field type and
 * to the comparator (plain text, number, date, regex with its flags, list for
 * `in`, two bounds for `between`, taxonomy pickers for the reference fields).
 */
export function ConditionValueInput({
	field,
	cmp,
	value,
	flags,
	onValueChange,
	onFlagsChange,
	id,
}: ConditionValueInputProps) {
	const control = valueControlFor(field, cmp);
	const list = toStringList(value);

	switch (control) {
		case "presence":
			return (
				<Select
					items={PRESENCE_LABELS}
					value={value === false ? "absent" : "present"}
					onValueChange={(next) => onValueChange(next !== "absent")}
				>
					<SelectTrigger id={id} className="w-full" aria-label="Presence">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="present">{PRESENCE_LABELS.present}</SelectItem>
						<SelectItem value="absent">{PRESENCE_LABELS.absent}</SelectItem>
					</SelectContent>
				</Select>
			);

		case "regex":
			return (
				<RegexValueInput
					id={id}
					pattern={firstString(value)}
					flags={flags}
					onPatternChange={(next) => onValueChange(next)}
					onFlagsChange={onFlagsChange}
				/>
			);

		case "range":
			return (
				<RangeValueInput
					id={id}
					type={ruleFieldKind(field) === "date" ? "date" : "number"}
					low={list[0] ?? ""}
					high={list[1] ?? ""}
					onChange={(low, high) => onValueChange([low, high])}
				/>
			);

		case "list":
			return (
				<ChipsInput
					id={id}
					values={list}
					onValuesChange={(values) => onValueChange(values)}
					placeholder="Type a value then press Enter"
				/>
			);

		case "number":
			return (
				<Input
					id={id}
					type="number"
					aria-label="Value"
					className="font-mono tabular-nums"
					value={firstString(value)}
					onChange={(event) =>
						onValueChange(
							event.target.value === ""
								? undefined
								: Number(event.target.value),
						)
					}
				/>
			);

		case "date":
			return (
				<DatePicker
					id={id}
					label="Value"
					value={firstString(value) || null}
					onValueChange={(next) => onValueChange(next ?? undefined)}
				/>
			);

		case "source":
			return (
				<Select
					items={SOURCE_ITEMS}
					value={firstString(value) || DOCUMENT_SOURCES[0]}
					onValueChange={(next) => onValueChange(next ?? undefined)}
				>
					<SelectTrigger id={id} className="w-full" aria-label="Source">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{DOCUMENT_SOURCES.map((source) => (
							<SelectItem key={source} value={source}>
								<IconLabel
									icon={DOCUMENT_SOURCE_ICONS[source]}
									label={DOCUMENT_SOURCE_LABELS[source]}
								/>
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			);

		case "category":
			return cmp === "in" ? (
				<CategoryMultiSelect
					id={id}
					value={list}
					onValueChange={(ids) => onValueChange(ids)}
					emptyLabel="Choose categories…"
				/>
			) : (
				<CategoryPicker
					id={id}
					value={list[0] ?? null}
					onValueChange={(categoryId) => onValueChange(categoryId ?? undefined)}
				/>
			);

		case "tag":
			return (
				<TagInput
					id={id}
					value={list}
					onValueChange={(ids) =>
						onValueChange(cmp === "in" ? ids : (ids.at(-1) ?? undefined))
					}
				/>
			);

		case "party":
			return cmp === "in" ? (
				<PartyMultiPicker
					id={id}
					value={list}
					onValueChange={(ids) => onValueChange(ids)}
				/>
			) : (
				<PartyPicker
					id={id}
					value={list[0] ?? null}
					onValueChange={(partyId) => onValueChange(partyId ?? undefined)}
				/>
			);

		default:
			return (
				<Input
					id={id}
					aria-label="Value"
					placeholder="Value"
					value={firstString(value)}
					onChange={(event) => onValueChange(event.target.value || undefined)}
				/>
			);
	}
}

/** Pattern + flags, with the compilation error shown inline. */
function RegexValueInput({
	id,
	pattern,
	flags,
	onPatternChange,
	onFlagsChange,
}: {
	id?: string;
	pattern: string;
	flags: string | undefined;
	onPatternChange: (pattern: string) => void;
	onFlagsChange: (flags: string | undefined) => void;
}) {
	const error = regexError(pattern, flags);

	return (
		<div className="flex flex-col gap-1">
			<div className="flex items-center gap-2">
				<Input
					id={id}
					aria-label="Regular expression"
					placeholder="bulletin de (paie|salaire)"
					className="flex-1 font-mono"
					value={pattern}
					onChange={(event) => onPatternChange(event.target.value)}
				/>
				<Input
					aria-label="Regex flags"
					placeholder="i"
					maxLength={8}
					className="w-16 font-mono"
					value={flags ?? ""}
					onChange={(event) =>
						onFlagsChange(
							event.target.value.replace(/[^dgimsuvy]/g, "") || undefined,
						)
					}
				/>
			</div>
			{error ? (
				<p className="text-destructive text-xs">{error}</p>
			) : pattern.length > 0 ? (
				<p className="text-tone-success-foreground text-xs">
					Valid pattern (flags: {flags && flags.length > 0 ? flags : "i"}).
				</p>
			) : null}
		</div>
	);
}

/** Two bounds of a `between` comparison. */
function RangeValueInput({
	id,
	type,
	low,
	high,
	onChange,
}: {
	id?: string;
	type: "number" | "date";
	low: string;
	high: string;
	onChange: (low: string, high: string) => void;
}) {
	if (type === "date") {
		return (
			<div className="flex items-center gap-2">
				<DatePicker
					id={id}
					label="Lower bound"
					value={low || null}
					onValueChange={(next) => onChange(next ?? "", high)}
					className="min-w-0 flex-1"
				/>
				<ArrowRightIcon
					aria-hidden
					className="size-4 shrink-0 text-muted-foreground"
				/>
				<DatePicker
					label="Upper bound"
					value={high || null}
					onValueChange={(next) => onChange(low, next ?? "")}
					className="min-w-0 flex-1"
				/>
			</div>
		);
	}
	return (
		<div className="flex items-center gap-2">
			<Input
				id={id}
				type="number"
				aria-label="Lower bound"
				className="min-w-0 flex-1 font-mono tabular-nums"
				value={low}
				onChange={(event) => onChange(event.target.value, high)}
			/>
			<ArrowRightIcon
				aria-hidden
				className="size-4 shrink-0 text-muted-foreground"
			/>
			<Input
				type="number"
				aria-label="Upper bound"
				className="min-w-0 flex-1 font-mono tabular-nums"
				value={high}
				onChange={(event) => onChange(low, event.target.value)}
			/>
		</div>
	);
}
