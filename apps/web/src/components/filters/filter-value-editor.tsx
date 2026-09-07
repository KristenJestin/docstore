import { Button } from "@docstore/ui/components/button";
import { Checkbox } from "@docstore/ui/components/checkbox";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@docstore/ui/components/command";
import { Input } from "@docstore/ui/components/input";
import { cn } from "@docstore/ui/lib/utils";
import { ArrowRightIcon } from "lucide-react";
import { useState } from "react";

import { DatePicker } from "@/components/date-picker";

import {
	type FilterField,
	type FilterValue,
	isComplete,
	operatorOf,
} from "./filter-types";

/** Indentation of a tree option (categories); three levels at most. */
const DEPTH_CLASSES = ["", "pl-6", "pl-10"] as const;

export interface FilterValueEditorProps<S> {
	field: FilterField<S>;
	value: FilterValue;
	/** Applies the value and closes the popover. */
	onApply: (value: FilterValue) => void;
	/** Closes without touching the filter. */
	onCancel: () => void;
}

/**
 * Value editor of a filter, drawn inside the popover of a pill. The control
 * follows the type of the field: searchable list, multi-selection with
 * checkboxes, calendar (one date or a range), text or number.
 */
export function FilterValueEditor<S>({
	field,
	value,
	onApply,
	onCancel,
}: FilterValueEditorProps<S>) {
	switch (field.type) {
		case "select":
		case "boolean":
			return <SingleChoice field={field} value={value} onApply={onApply} />;
		case "multiSelect":
			return (
				<MultiChoice
					field={field}
					value={value}
					onApply={onApply}
					onCancel={onCancel}
				/>
			);
		case "date":
		case "dateRange":
			return <DateValues field={field} value={value} onApply={onApply} />;
		default:
			return <TextValue field={field} value={value} onApply={onApply} />;
	}
}

/** Searchable list, one choice: picking a row applies straight away. */
function SingleChoice<S>({
	field,
	value,
	onApply,
}: {
	field: FilterField<S>;
	value: FilterValue;
	onApply: (value: FilterValue) => void;
}) {
	const options = field.options ?? [];
	const selected = value.values[0] ?? null;

	return (
		<Command loop>
			{options.length > 8 ? (
				<CommandInput placeholder={`Search ${field.label.toLowerCase()}…`} />
			) : null}
			<CommandList>
				<CommandEmpty>No match.</CommandEmpty>
				<CommandGroup>
					{options.map((option) => (
						<CommandItem
							key={option.value}
							value={`${option.label} ${option.keywords ?? ""}`}
							data-checked={option.value === selected}
							className={DEPTH_CLASSES[option.depth ?? 0]}
							onSelect={() =>
								onApply({ operator: value.operator, values: [option.value] })
							}
						>
							{option.adornment}
							<span className="min-w-0 flex-1 truncate">{option.label}</span>
						</CommandItem>
					))}
				</CommandGroup>
			</CommandList>
		</Command>
	);
}

/** Searchable list with checkboxes; "Apply" writes the whole selection. */
function MultiChoice<S>({
	field,
	value,
	onApply,
	onCancel,
}: {
	field: FilterField<S>;
	value: FilterValue;
	onApply: (value: FilterValue) => void;
	onCancel: () => void;
}) {
	const [selected, setSelected] = useState<string[]>(value.values);
	const options = field.options ?? [];

	const toggle = (option: string) =>
		setSelected((current) =>
			current.includes(option)
				? current.filter((item) => item !== option)
				: [...current, option],
		);

	return (
		<div className="flex flex-col gap-2">
			<Command loop>
				{options.length > 8 ? (
					<CommandInput placeholder={`Search ${field.label.toLowerCase()}…`} />
				) : null}
				<CommandList>
					<CommandEmpty>No match.</CommandEmpty>
					<CommandGroup>
						{options.map((option) => (
							<CommandItem
								key={option.value}
								value={`${option.label} ${option.keywords ?? ""}`}
								className={DEPTH_CLASSES[option.depth ?? 0]}
								onSelect={() => toggle(option.value)}
							>
								<Checkbox
									aria-hidden
									tabIndex={-1}
									checked={selected.includes(option.value)}
								/>
								{option.adornment}
								<span className="min-w-0 flex-1 truncate">{option.label}</span>
							</CommandItem>
						))}
					</CommandGroup>
				</CommandList>
			</Command>
			<EditorFooter
				disabled={selected.length === 0}
				onCancel={onCancel}
				onApply={() => onApply({ operator: value.operator, values: selected })}
			/>
		</div>
	);
}

/** One date, or the two bounds of a range, through the shared `DatePicker`. */
function DateValues<S>({
	field,
	value,
	onApply,
}: {
	field: FilterField<S>;
	value: FilterValue;
	onApply: (value: FilterValue) => void;
}) {
	const operator = operatorOf(field, value);
	const set = (index: number, next: string | null) => {
		const values = [...value.values];
		values[index] = next ?? "";
		onApply({ operator: value.operator, values });
	};

	if (operator.arity === 2) {
		return (
			<div className="flex items-center gap-2">
				<DatePicker
					label={`${field.label} from`}
					placeholder="From"
					value={value.values[0] || null}
					onValueChange={(next) => set(0, next)}
					className="min-w-0 flex-1"
				/>
				<ArrowRightIcon
					aria-hidden
					className="size-4 shrink-0 text-muted-foreground"
				/>
				<DatePicker
					label={`${field.label} to`}
					placeholder="To"
					value={value.values[1] || null}
					onValueChange={(next) => set(1, next)}
					className="min-w-0 flex-1"
				/>
			</div>
		);
	}

	return (
		<DatePicker
			label={field.label}
			value={value.values[0] || null}
			onValueChange={(next) => set(0, next)}
		/>
	);
}

/** Free text or number: Enter and "Apply" both commit. */
function TextValue<S>({
	field,
	value,
	onApply,
}: {
	field: FilterField<S>;
	value: FilterValue;
	onApply: (value: FilterValue) => void;
}) {
	const [draft, setDraft] = useState(value.values[0] ?? "");
	const next: FilterValue = {
		operator: value.operator,
		values: [draft.trim()],
	};

	return (
		<form
			className="flex items-center gap-2"
			onSubmit={(event) => {
				event.preventDefault();
				if (isComplete(field, next)) {
					onApply(next);
				}
			}}
		>
			<Input
				autoFocus
				type={field.type === "number" ? "number" : "text"}
				aria-label={field.label}
				placeholder={field.placeholder ?? field.label}
				value={draft}
				className={cn("min-w-0 flex-1", field.type === "number" && "font-mono")}
				onChange={(event) => setDraft(event.target.value)}
			/>
			<Button type="submit" size="sm" disabled={!isComplete(field, next)}>
				Apply
			</Button>
		</form>
	);
}

function EditorFooter({
	disabled,
	onCancel,
	onApply,
}: {
	disabled: boolean;
	onCancel: () => void;
	onApply: () => void;
}) {
	return (
		<div className="flex items-center justify-end gap-2 border-border border-t pt-2">
			<Button variant="ghost" size="sm" onClick={onCancel}>
				Cancel
			</Button>
			<Button size="sm" disabled={disabled} onClick={onApply}>
				Apply
			</Button>
		</div>
	);
}
