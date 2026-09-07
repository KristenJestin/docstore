import type { PartySummary, PartyType } from "@docstore/shared/party";
import { normalizeIdentifier, PARTY_TYPES } from "@docstore/shared/party";
import { Button } from "@docstore/ui/components/button";
import {
	Combobox,
	ComboboxChip,
	ComboboxChips,
	ComboboxChipsInput,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxInput,
	ComboboxItem,
	ComboboxList,
	useComboboxAnchor,
} from "@docstore/ui/components/combobox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@docstore/ui/components/dialog";
import { Input } from "@docstore/ui/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@docstore/ui/components/select";
import { cn } from "@docstore/ui/lib/utils";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { toast } from "sonner";

import { FormField } from "@/components/form-field";
import { IconLabel, iconLabelItems } from "@/components/icon-label";
import { PartyAvatar } from "@/components/party-avatar";
import {
	PARTY_TYPE_ICONS,
	PARTY_TYPE_LABELS,
	PartyTypeBadge,
} from "@/components/party-type-badge";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { toastApiError } from "@/lib/api-error";
import { orpc } from "@/utils/orpc";

/**
 * The one party combobox of the application: `party.list` search, avatar plus
 * type badge on every option, and a last "Create …" entry opening the quick
 * creation dialog. `PartyMultiPicker` is the same list rendered as chips.
 */

/** How many parties one page of the search returns. */
const PAGE_SIZE = 50;

/** Always-loaded first page, so a selected party keeps its name and avatar. */
const BASE_PAGE_SIZE = 100;

/** Sentinel id of the "Create …" option; no party can carry it. */
const CREATE_ID = "__create__";

/** Only what the picker displays, so `party.list` and `party.get` both fit. */
export type PartyOption = Pick<
	PartySummary,
	"id" | "name" | "type" | "logoKey"
>;

const PARTY_TYPE_ITEMS = iconLabelItems(
	PARTY_TYPES,
	PARTY_TYPE_LABELS,
	PARTY_TYPE_ICONS,
);

/**
 * Options of the list: the first page of `party.list`, always loaded so an
 * already selected party keeps its name, merged with the server-side search
 * results of what is being typed.
 */
function usePartyOptions(query: string): {
	options: PartyOption[];
	byId: Map<string, PartyOption>;
} {
	const needle = useDebouncedValue(query.trim());

	const base = useQuery(
		orpc.party.list.queryOptions({
			input: { page: 1, pageSize: BASE_PAGE_SIZE, includeArchived: false },
		}),
	);
	const search = useQuery({
		...orpc.party.list.queryOptions({
			input: {
				page: 1,
				pageSize: PAGE_SIZE,
				includeArchived: false,
				query: needle,
			},
		}),
		enabled: needle.length > 0,
	});

	const baseItems = base.data?.items;
	const searchItems = search.data?.items;

	return useMemo(() => {
		const byId = new Map<string, PartyOption>();
		for (const item of searchItems ?? []) {
			byId.set(item.id, item);
		}
		for (const item of baseItems ?? []) {
			if (!byId.has(item.id)) {
				byId.set(item.id, item);
			}
		}
		return { options: [...byId.values()], byId };
	}, [baseItems, searchItems]);
}

/** One row of the list: avatar, name, type badge. */
function PartyOptionRow({ party }: { party: PartyOption }) {
	return (
		<>
			<PartyAvatar
				name={party.name}
				logoKey={party.logoKey}
				partyId={party.id}
				size="sm"
			/>
			<span className="min-w-0 flex-1 truncate">{party.name}</span>
			<PartyTypeBadge type={party.type} />
		</>
	);
}

export interface PartyPickerProps {
	/** Id of the selected party, or `null`. */
	value: string | null;
	onValueChange: (partyId: string | null) => void;
	/** Accessible name of the field. */
	label?: string;
	placeholder?: string;
	id?: string;
	/** Hides these parties from the list (already linked, self…). */
	excludeIds?: string[];
	/** Offers the "Create …" entry. On by default. */
	allowCreate?: boolean;
	disabled?: boolean;
	className?: string;
}

/** Single-selection party combobox. */
export function PartyPicker({
	value,
	onValueChange,
	label = "Party",
	placeholder = "No party",
	id,
	excludeIds,
	allowCreate = true,
	disabled = false,
	className,
}: PartyPickerProps) {
	const [query, setQuery] = useState("");
	const [creating, setCreating] = useState<string | null>(null);
	const { options, byId } = usePartyOptions(query);

	const items = visibleOptions(options, query, excludeIds, allowCreate);
	const selected = value ? (byId.get(value) ?? null) : null;

	return (
		<>
			<Combobox
				items={items}
				value={selected}
				filter={null}
				onInputValueChange={setQuery}
				onValueChange={(next: PartyOption | null) => {
					if (next?.id === CREATE_ID) {
						setCreating(next.name);
						return;
					}
					onValueChange(next?.id ?? null);
				}}
				itemToStringLabel={(item: PartyOption) =>
					item.id === CREATE_ID ? "" : item.name
				}
				isItemEqualToValue={(item: PartyOption, current: PartyOption) =>
					item.id === current.id
				}
			>
				<ComboboxInput
					id={id}
					aria-label={label}
					placeholder={placeholder}
					disabled={disabled}
					showClear
					className={cn("w-full", className)}
				/>
				<ComboboxContent>
					<ComboboxEmpty>No party found.</ComboboxEmpty>
					<ComboboxList>
						{(item: PartyOption) => (
							<ComboboxItem key={item.id} value={item}>
								{item.id === CREATE_ID ? (
									<CreateOptionRow name={item.name} />
								) : (
									<PartyOptionRow party={item} />
								)}
							</ComboboxItem>
						)}
					</ComboboxList>
				</ComboboxContent>
			</Combobox>

			<PartyQuickCreateDialog
				open={creating !== null}
				name={creating ?? ""}
				onOpenChange={(open) => {
					if (!open) {
						setCreating(null);
					}
				}}
				onCreated={(party) => onValueChange(party.id)}
			/>
		</>
	);
}

export interface PartyMultiPickerProps {
	value: string[];
	onValueChange: (partyIds: string[]) => void;
	label?: string;
	placeholder?: string;
	id?: string;
	excludeIds?: string[];
	allowCreate?: boolean;
	className?: string;
}

/** Multi-selection party combobox, rendered as removable chips. */
export function PartyMultiPicker({
	value,
	onValueChange,
	label = "Parties",
	placeholder = "Search a party…",
	id,
	excludeIds,
	allowCreate = true,
	className,
}: PartyMultiPickerProps) {
	const [query, setQuery] = useState("");
	const [creating, setCreating] = useState<string | null>(null);
	const anchor = useComboboxAnchor();
	const { options, byId } = usePartyOptions(query);

	const items = visibleOptions(options, query, excludeIds, allowCreate);
	const selected = value
		.map((partyId) => byId.get(partyId))
		.filter((party): party is PartyOption => party !== undefined);

	return (
		<>
			<Combobox
				multiple
				items={items}
				value={selected}
				filter={null}
				onInputValueChange={setQuery}
				onValueChange={(next: PartyOption[]) => {
					const create = next.find((item) => item.id === CREATE_ID);
					if (create) {
						setCreating(create.name);
						return;
					}
					onValueChange(next.map((item) => item.id));
				}}
				itemToStringLabel={(item: PartyOption) =>
					item.id === CREATE_ID ? "" : item.name
				}
				isItemEqualToValue={(item: PartyOption, current: PartyOption) =>
					item.id === current.id
				}
			>
				<ComboboxChips ref={anchor} className={className}>
					{selected.map((party) => (
						<ComboboxChip key={party.id} removeLabel={`Remove ${party.name}`}>
							<PartyAvatar
								name={party.name}
								logoKey={party.logoKey}
								partyId={party.id}
								size="sm"
							/>
							{party.name}
						</ComboboxChip>
					))}
					<ComboboxChipsInput
						id={id}
						aria-label={label}
						placeholder={selected.length === 0 ? placeholder : undefined}
					/>
				</ComboboxChips>
				<ComboboxContent anchor={anchor}>
					<ComboboxEmpty>No party found.</ComboboxEmpty>
					<ComboboxList>
						{(item: PartyOption) => (
							<ComboboxItem key={item.id} value={item}>
								{item.id === CREATE_ID ? (
									<CreateOptionRow name={item.name} />
								) : (
									<PartyOptionRow party={item} />
								)}
							</ComboboxItem>
						)}
					</ComboboxList>
				</ComboboxContent>
			</Combobox>

			<PartyQuickCreateDialog
				open={creating !== null}
				name={creating ?? ""}
				onOpenChange={(open) => {
					if (!open) {
						setCreating(null);
					}
				}}
				onCreated={(party) => onValueChange([...value, party.id])}
			/>
		</>
	);
}

/** Excludes what the caller hides and appends the "Create …" entry. */
function visibleOptions(
	options: PartyOption[],
	query: string,
	excludeIds: string[] | undefined,
	allowCreate: boolean,
): PartyOption[] {
	const needle = query.trim();
	const hidden = new Set(excludeIds ?? []);
	const visible = options.filter(
		(party) =>
			!hidden.has(party.id) &&
			(needle.length === 0 ||
				party.name.toLowerCase().includes(needle.toLowerCase())),
	);
	const exists = visible.some(
		(party) => party.name.toLowerCase() === needle.toLowerCase(),
	);
	if (!allowCreate || needle.length === 0 || exists) {
		return visible;
	}
	return [
		...visible,
		{ id: CREATE_ID, name: needle, type: "company", logoKey: null },
	];
}

function CreateOptionRow({ name }: { name: string }) {
	return (
		<>
			<PlusIcon className="size-4" />
			<span className="min-w-0 flex-1 truncate">Create “{name}”…</span>
		</>
	);
}

export interface PartyQuickCreateDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Name typed in the combobox, prefilled in the dialog. */
	name: string;
	onCreated: (party: PartyOption) => void;
}

/**
 * Minimal creation form opened from the picker: name, type and one optional
 * domain. The full form stays `PartyFormSheet`.
 */
export function PartyQuickCreateDialog({
	open,
	onOpenChange,
	name,
	onCreated,
}: PartyQuickCreateDialogProps) {
	const ids = useId();
	const createParty = useMutation(orpc.party.create.mutationOptions());

	const [draftName, setDraftName] = useState(name);
	const [type, setType] = useState<PartyType>("company");
	const [domain, setDomain] = useState("");
	const [loadedFor, setLoadedFor] = useState<string | null>(null);

	// The dialog stays mounted: the draft is rebuilt every time it reopens.
	if (open && loadedFor !== name) {
		setLoadedFor(name);
		setDraftName(name);
		setType("company");
		setDomain("");
	}
	if (!open && loadedFor !== null) {
		setLoadedFor(null);
	}

	const trimmed = draftName.trim();

	const submit = async () => {
		if (trimmed.length === 0) {
			return;
		}
		try {
			const party = await createParty.mutateAsync({
				type,
				name: trimmed,
				// Same canonical form as the full party form: a domain typed
				// "ACME.fr" must find the party stored as "acme.fr".
				identifiers: domain.trim()
					? { domain: [normalizeIdentifier("domain", domain)] }
					: {},
			});
			toast.success(`Party "${party.name}" created.`);
			onOpenChange(false);
			onCreated(party);
		} catch (error) {
			toastApiError(error, "The party could not be created.");
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>New party</DialogTitle>
					<DialogDescription>
						Just enough to link it now; the rest can be filled in later on its
						page.
					</DialogDescription>
				</DialogHeader>

				<form
					id={`${ids}-form`}
					className="flex flex-col gap-4"
					onSubmit={(event) => {
						event.preventDefault();
						void submit();
					}}
				>
					<FormField label="Name" htmlFor={`${ids}-name`} required>
						<Input
							id={`${ids}-name`}
							autoFocus
							value={draftName}
							onChange={(event) => setDraftName(event.target.value)}
						/>
					</FormField>

					<FormField label="Type" htmlFor={`${ids}-type`} required>
						<Select
							items={PARTY_TYPE_ITEMS}
							value={type}
							onValueChange={(next) => setType(next as PartyType)}
						>
							<SelectTrigger id={`${ids}-type`} className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{PARTY_TYPES.map((item) => (
									<SelectItem key={item} value={item}>
										<IconLabel
											icon={PARTY_TYPE_ICONS[item]}
											label={PARTY_TYPE_LABELS[item]}
										/>
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</FormField>

					<FormField
						label="Domain"
						htmlFor={`${ids}-domain`}
						hint="Optional; used to recognise the issuer of a document and to fetch the logo."
					>
						<Input
							id={`${ids}-domain`}
							value={domain}
							placeholder="free.fr"
							onChange={(event) => setDomain(event.target.value)}
						/>
					</FormField>
				</form>

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button
						type="submit"
						form={`${ids}-form`}
						disabled={trimmed.length === 0 || createParty.isPending}
					>
						{createParty.isPending ? "Creating…" : "Create party"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
