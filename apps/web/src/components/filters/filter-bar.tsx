import { Button } from "@docstore/ui/components/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@docstore/ui/components/command";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@docstore/ui/components/dropdown-menu";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@docstore/ui/components/popover";
import { cn } from "@docstore/ui/lib/utils";
import { ChevronDownIcon, ListFilterIcon, XIcon } from "lucide-react";
import { type ReactNode, type Ref, useState } from "react";

import { SearchInput } from "@/components/search-input";

import {
	activeFilters,
	emptyValue,
	type FilterField,
	type FilterValue,
	formatValue,
	isComplete,
	operatorOf,
} from "./filter-types";
import { FilterValueEditor } from "./filter-value-editor";

export interface FilterBarSearch {
	value: string;
	onValueChange: (query: string) => void;
	placeholder?: string;
	label?: string;
	inputRef?: Ref<HTMLInputElement>;
}

export interface FilterBarProps<S> {
	/** Declaration of every filter the screen offers, in menu order. */
	fields: FilterField<S>[];
	/** Current URL search object. */
	value: S;
	/** Applies a patch; the page resets the page number and writes the URL. */
	onChange: (patch: Partial<S>) => void;
	/** Compact search field on the left; omitted when the screen has none. */
	search?: FilterBarSearch;
	/** Right-hand slot: result count, sort select… */
	trailing?: ReactNode;
	className?: string;
}

/** A filter picked from the menu, still being filled in. */
interface DraftFilter {
	fieldId: string;
	value: FilterValue;
}

/**
 * Filter bar: a compact search field, the active filters as editable pills
 * (`Field · operator · value`), an "Add filter" button opening the list of the
 * remaining fields, and "Clear all".
 *
 * Everything is declarative: a screen hands over its `FilterField[]`, each of
 * them knowing how to read and write itself in the URL search object. Only the
 * half-filled filter lives here, so a pasted link restores the bar exactly.
 */
export function FilterBar<S>({
	fields,
	value,
	onChange,
	search,
	trailing,
	className,
}: FilterBarProps<S>) {
	const [draft, setDraft] = useState<DraftFilter | null>(null);

	const active = activeFilters(fields, value);
	const taken = new Set(active.map((item) => item.field.id));
	if (draft) {
		taken.add(draft.fieldId);
	}
	const available = fields.filter((field) => !taken.has(field.id));
	const draftField = draft
		? fields.find((field) => field.id === draft.fieldId)
		: undefined;

	const clearAll = () => {
		let patch: Partial<S> = {};
		for (const { field } of active) {
			patch = { ...patch, ...field.write(null) };
		}
		onChange(patch);
		setDraft(null);
	};

	return (
		<div
			className={cn("flex flex-wrap items-center gap-2", className)}
			data-testid="filter-bar"
		>
			{search ? (
				<SearchInput
					value={search.value}
					onValueChange={search.onValueChange}
					placeholder={search.placeholder}
					label={search.label}
					inputRef={search.inputRef}
					shortcut="/"
					className="w-full max-w-sm"
				/>
			) : null}

			{active.map(({ field, value: current }) => (
				<FilterPill
					key={field.id}
					field={field}
					value={current}
					onChange={(next) => onChange(field.write(next))}
				/>
			))}

			{draft && draftField ? (
				<FilterPill
					key={`draft:${draftField.id}`}
					field={draftField}
					value={draft.value}
					openOnMount
					onChange={(next) => {
						if (next === null) {
							setDraft(null);
							return;
						}
						if (isComplete(draftField, next)) {
							setDraft(null);
							onChange(draftField.write(next));
							return;
						}
						setDraft({ fieldId: draftField.id, value: next });
					}}
					// A filter left half-filled leaves no trace when its editor closes.
					onDismiss={() => setDraft(null)}
				/>
			) : null}

			<AddFilterButton
				fields={available}
				onAdd={(field) =>
					setDraft({ fieldId: field.id, value: emptyValue(field) })
				}
			/>

			{active.length > 0 ? (
				<Button variant="ghost" size="sm" onClick={clearAll}>
					Clear all
				</Button>
			) : null}

			{trailing ? (
				<div className="ml-auto flex items-center gap-3">{trailing}</div>
			) : null}
		</div>
	);
}

/** "Add filter" → popover listing the fields still available, with icons. */
function AddFilterButton<S>({
	fields,
	onAdd,
}: {
	fields: FilterField<S>[];
	onAdd: (field: FilterField<S>) => void;
}) {
	const [open, setOpen] = useState(false);

	if (fields.length === 0) {
		return null;
	}

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				render={<Button variant="outline" size="sm" />}
				data-testid="add-filter"
			>
				<ListFilterIcon />
				Add filter
			</PopoverTrigger>
			<PopoverContent align="start" className="w-64 p-0">
				<Command loop>
					<CommandInput placeholder="Search a filter…" />
					<CommandList>
						<CommandEmpty>No filter.</CommandEmpty>
						<CommandGroup heading="Filter on">
							{fields.map((field) => {
								const Icon = field.icon;
								return (
									<CommandItem
										key={field.id}
										value={field.label}
										onSelect={() => {
											setOpen(false);
											onAdd(field);
										}}
									>
										<Icon className="text-muted-foreground" />
										<span className="min-w-0 flex-1 truncate">
											{field.label}
										</span>
									</CommandItem>
								);
							})}
						</CommandGroup>
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}

/**
 * One filter: `Field · operator · value`, the operator opening its menu when
 * the field accepts several, the value opening its editor, and × removing the
 * filter.
 */
function FilterPill<S>({
	field,
	value,
	openOnMount = false,
	onChange,
	onDismiss,
}: {
	field: FilterField<S>;
	value: FilterValue;
	openOnMount?: boolean;
	onChange: (value: FilterValue | null) => void;
	/** Called when the editor closes on a value that is still incomplete. */
	onDismiss?: () => void;
}) {
	const [open, setOpen] = useState(openOnMount);
	const Icon = field.icon;
	const operator = operatorOf(field, value);
	const listLike =
		field.type === "select" ||
		field.type === "multiSelect" ||
		field.type === "boolean";

	return (
		<div
			className="inline-flex h-8 items-center gap-1 rounded-md bg-card pr-1 pl-2 text-xs shadow-btn ring-1 ring-border"
			data-testid={`filter-pill-${field.id}`}
		>
			<Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
			<span className="font-medium">{field.label}</span>

			{field.operators.length > 1 ? (
				<DropdownMenu>
					<DropdownMenuTrigger
						render={
							<button
								type="button"
								aria-label={`Operator of ${field.label}`}
								className="cursor-pointer rounded px-1 py-0.5 text-muted-foreground transition-colors duration-200 ease-premium hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
							/>
						}
					>
						{operator.label}
					</DropdownMenuTrigger>
					<DropdownMenuContent align="start">
						{field.operators.map((item) => (
							<DropdownMenuItem
								key={item.id}
								onClick={() =>
									onChange({
										operator: item.id,
										values: value.values.slice(0, item.arity),
									})
								}
							>
								{item.label}
							</DropdownMenuItem>
						))}
					</DropdownMenuContent>
				</DropdownMenu>
			) : (
				<span className="px-1 text-muted-foreground">{operator.label}</span>
			)}

			<Popover
				open={open}
				onOpenChange={(next) => {
					setOpen(next);
					if (!next && !isComplete(field, value)) {
						onDismiss?.();
					}
				}}
			>
				<PopoverTrigger
					render={
						<button
							type="button"
							aria-label={`Value of ${field.label}`}
							className="cursor-pointer rounded px-1 py-0.5 font-semibold transition-colors duration-200 ease-premium hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
						/>
					}
				>
					{formatValue(field, value)}
					<ChevronDownIcon aria-hidden className="ml-1 inline size-3" />
				</PopoverTrigger>
				<PopoverContent
					align="start"
					className={cn(listLike ? "w-64 p-0" : "w-80")}
				>
					<FilterValueEditor
						field={field}
						value={value}
						onApply={(next) => {
							onChange(next);
							// A calendar stays open: the second bound of a range is picked
							// right after the first one.
							if (field.type !== "dateRange") {
								setOpen(false);
							}
						}}
						onCancel={() => setOpen(false)}
					/>
				</PopoverContent>
			</Popover>

			<button
				type="button"
				aria-label={`Remove the ${field.label} filter`}
				onClick={() => {
					onChange(null);
					onDismiss?.();
				}}
				className="cursor-pointer rounded p-0.5 text-muted-foreground transition-colors duration-200 ease-premium hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
			>
				<XIcon className="size-3.5" />
			</button>
		</div>
	);
}
