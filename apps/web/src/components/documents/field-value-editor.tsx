import type {
	CustomField,
	CustomFieldValue,
} from "@docstore/shared/custom-field";
import { customFieldValueIssue } from "@docstore/shared/custom-field";
import { Button } from "@docstore/ui/components/button";
import { Input } from "@docstore/ui/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@docstore/ui/components/select";
import { Switch } from "@docstore/ui/components/switch";
import { XIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { DatePicker } from "@/components/date-picker";
import { PartyPicker } from "@/components/parties/party-picker";

import { formatMoney } from "./document-labels";

/** Fallback currency when the field definition does not enforce one. */
const DEFAULT_CURRENCY = "EUR";

export interface FieldValueEditorProps {
	field: CustomField;
	/** Stored value, `null` when the field is empty. */
	value: CustomFieldValue | null;
	/** Called on commit; `null` clears the value. */
	onCommit: (value: CustomFieldValue | null) => void;
	disabled?: boolean;
	id?: string;
}

/**
 * Editor of a custom field value, matching the type of the definition (SPEC §2
 * "CustomFieldDefinition"). Text-like fields commit on blur or Enter; discrete
 * controls commit immediately.
 */
export function FieldValueEditor({
	field,
	value,
	onCommit,
	disabled = false,
	id,
}: FieldValueEditorProps) {
	const [issue, setIssue] = useState<string | null>(null);

	// Same check as the API (`customFieldValueIssue`), run before the write: a
	// negative amount on a field that refuses one is caught here rather than
	// coming back as a `BAD_REQUEST` toast.
	const commit = (next: CustomFieldValue | null) => {
		const problem = next === null ? null : customFieldValueIssue(field, next);
		setIssue(problem);
		if (problem === null) {
			onCommit(next);
		}
	};

	return (
		<div className="flex flex-col gap-1.5">
			<FieldValueControl
				field={field}
				value={value}
				onCommit={commit}
				disabled={disabled}
				id={id}
			/>
			{issue ? (
				<p className="text-tone-danger-foreground text-xs">{issue}</p>
			) : null}
		</div>
	);
}

/** The control itself, one per field type. */
function FieldValueControl({
	field,
	value,
	onCommit,
	disabled = false,
	id,
}: FieldValueEditorProps) {
	switch (field.type) {
		case "boolean":
			return (
				<Switch
					id={id}
					aria-label={field.name}
					disabled={disabled}
					checked={value?.kind === "boolean" ? value.boolean : false}
					onCheckedChange={(checked) =>
						onCommit({ kind: "boolean", boolean: checked })
					}
				/>
			);
		case "date":
			return (
				<DatePicker
					id={id}
					label={field.name}
					disabled={disabled}
					value={value?.kind === "date" ? value.date : null}
					onValueChange={(next) =>
						onCommit(next ? { kind: "date", date: next } : null)
					}
				/>
			);
		case "select":
			return (
				<SelectEditor
					field={field}
					value={value?.kind === "select" ? value.choice : null}
					onCommit={onCommit}
					disabled={disabled}
					id={id}
				/>
			);
		case "money":
			return (
				<MoneyEditor
					field={field}
					value={value?.kind === "money" ? value : null}
					onCommit={onCommit}
					disabled={disabled}
					id={id}
				/>
			);
		case "party_ref":
			return (
				<PartyRefEditor
					field={field}
					value={value?.kind === "party_ref" ? value.partyId : null}
					onCommit={onCommit}
					disabled={disabled}
					id={id}
				/>
			);
		case "number":
			return (
				<TextLikeEditor
					id={id}
					label={field.name}
					type="number"
					disabled={disabled}
					initial={value?.kind === "number" ? String(value.number) : ""}
					onCommit={(text) => {
						if (!text.trim()) {
							onCommit(null);
							return;
						}
						const parsed = Number(text);
						onCommit(
							Number.isFinite(parsed)
								? { kind: "number", number: parsed }
								: null,
						);
					}}
				/>
			);
		case "url":
			return (
				<TextLikeEditor
					id={id}
					label={field.name}
					type="url"
					disabled={disabled}
					initial={value?.kind === "url" ? value.url : ""}
					onCommit={(text) =>
						onCommit(text.trim() ? { kind: "url", url: text.trim() } : null)
					}
				/>
			);
		default:
			return (
				<TextLikeEditor
					id={id}
					label={field.name}
					type="text"
					disabled={disabled}
					initial={value?.kind === "text" ? value.text : ""}
					onCommit={(text) =>
						onCommit(text.trim() ? { kind: "text", text: text.trim() } : null)
					}
				/>
			);
	}
}

/** Free-form field committed on blur or Enter. */
function TextLikeEditor({
	id,
	label,
	type,
	initial,
	onCommit,
	disabled,
}: {
	id?: string;
	label: string;
	type: "text" | "number" | "url";
	initial: string;
	onCommit: (text: string) => void;
	disabled: boolean;
}) {
	const [draft, setDraft] = useState(initial);

	useEffect(() => {
		setDraft(initial);
	}, [initial]);

	return (
		<Input
			id={id}
			type={type}
			aria-label={label}
			disabled={disabled}
			value={draft}
			className={type === "text" ? undefined : "font-mono tabular-nums"}
			onChange={(event) => setDraft(event.target.value)}
			onBlur={() => {
				if (draft !== initial) {
					onCommit(draft);
				}
			}}
			onKeyDown={(event) => {
				if (event.key === "Enter") {
					event.preventDefault();
					event.currentTarget.blur();
				}
			}}
		/>
	);
}

function MoneyEditor({
	field,
	value,
	onCommit,
	disabled,
	id,
}: {
	field: CustomField;
	value: { amount: number; currency: string } | null;
	onCommit: (value: CustomFieldValue | null) => void;
	disabled: boolean;
	id?: string;
}) {
	// The currency belongs to the definition, not to the value: the API refuses
	// anything else (`customFieldValueIssue`), so it is shown, never typed.
	const currency = field.options.currency ?? DEFAULT_CURRENCY;
	const initial = value ? String(value.amount) : "";
	const [draft, setDraft] = useState(initial);

	useEffect(() => {
		setDraft(initial);
	}, [initial]);

	const commit = (nextDraft: string) => {
		if (!nextDraft.trim()) {
			onCommit(null);
			return;
		}
		const parsed = Number(nextDraft.replace(",", "."));
		if (!Number.isFinite(parsed)) {
			return;
		}
		onCommit({
			kind: "money",
			amount: Math.round(parsed * 100) / 100,
			currency,
		});
	};

	return (
		<div className="flex items-center gap-2">
			<Input
				id={id}
				type="text"
				inputMode="decimal"
				aria-label={`${field.name} — amount`}
				disabled={disabled}
				value={draft}
				className="font-mono tabular-nums"
				onChange={(event) => setDraft(event.target.value)}
				onBlur={() => commit(draft)}
			/>
			<span
				data-testid="money-currency"
				title={`This field is expressed in ${currency}.`}
				className="shrink-0 font-mono text-muted-foreground text-xs"
			>
				{currency}
			</span>
			{value ? (
				<span className="shrink-0 font-mono text-muted-foreground text-xs tabular-nums">
					{formatMoney(value.amount, value.currency)}
				</span>
			) : null}
		</div>
	);
}

function SelectEditor({
	field,
	value,
	onCommit,
	disabled,
	id,
}: {
	field: CustomField;
	value: string | null;
	onCommit: (value: CustomFieldValue | null) => void;
	disabled: boolean;
	id?: string;
}) {
	const choices = field.options.choices ?? [];

	return (
		<div className="flex items-center gap-1">
			<Select
				items={Object.fromEntries(choices.map((choice) => [choice, choice]))}
				value={value ?? ""}
				disabled={disabled}
				onValueChange={(next) =>
					onCommit(next ? { kind: "select", choice: String(next) } : null)
				}
			>
				<SelectTrigger id={id} aria-label={field.name} className="w-full">
					<SelectValue placeholder="Choose…" />
				</SelectTrigger>
				<SelectContent>
					{choices.map((choice) => (
						<SelectItem key={choice} value={choice}>
							{choice}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			{value ? (
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label={`Clear ${field.name}`}
					disabled={disabled}
					onClick={() => onCommit(null)}
				>
					<XIcon />
				</Button>
			) : null}
		</div>
	);
}

function PartyRefEditor({
	field,
	value,
	onCommit,
	disabled,
	id,
}: {
	field: CustomField;
	value: string | null;
	onCommit: (value: CustomFieldValue | null) => void;
	disabled: boolean;
	id?: string;
}) {
	return (
		<PartyPicker
			id={id}
			label={field.name}
			placeholder="Choose a party…"
			disabled={disabled}
			value={value}
			onValueChange={(partyId) =>
				onCommit(partyId ? { kind: "party_ref", partyId } : null)
			}
		/>
	);
}
