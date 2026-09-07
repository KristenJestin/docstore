import type { TagSummary } from "@docstore/shared/tag";
import {
	Combobox,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxItem,
	ComboboxList,
	useComboboxAnchor,
} from "@docstore/ui/components/combobox";
import {
	TagsInput,
	TagsInputChip,
	TagsInputField,
} from "@docstore/ui/components/tags-input";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { type KeyboardEvent, useState } from "react";
import { toast } from "sonner";

import { TAXONOMY_COLORS } from "@/components/settings/taxonomy-pickers";
import { toastApiError } from "@/lib/api-error";
import { orpc } from "@/utils/orpc";

import { TagChip } from "./document-badges";

/**
 * Single field holding the tags of a document: the selected tags are removable
 * chips inside the input, typing filters `tag.list` in a dropdown below, Enter
 * takes the highlighted suggestion — or the "Create tag …" row, which calls
 * `tag.create` with a colour — a comma resolves what was typed, and Backspace
 * on an empty field removes the last chip.
 */

/** Sentinel id of the "Create tag …" row; no tag can carry it. */
const CREATE_ID = "__create__";

/** Only what the field displays, so `TagWithCount` and `TagSummary` both fit. */
type TagOption = Pick<TagSummary, "id" | "name" | "color">;

/**
 * Colour given to a tag created on the fly: the palette entry the name hashes
 * to, so the same name always gets the same hue and no tag stays colourless.
 */
export function colorForTagName(name: string): string {
	const needle = name.toLowerCase();
	let hash = 0;
	for (let index = 0; index < needle.length; index += 1) {
		hash = (hash * 31 + needle.charCodeAt(index)) % 100_000;
	}
	return TAXONOMY_COLORS[hash % TAXONOMY_COLORS.length].value;
}

export interface TagInputProps {
	/** Ids of the selected tags. */
	value: string[];
	onValueChange: (tagIds: string[]) => void;
	/** Creates the tag when the typed name matches none. On by default. */
	allowCreate?: boolean;
	/** Accessible name of the field. */
	label?: string;
	placeholder?: string;
	id?: string;
	disabled?: boolean;
	className?: string;
}

export function TagInput({
	value,
	onValueChange,
	allowCreate = true,
	label = "Tags",
	placeholder = "Add a tag…",
	id,
	disabled = false,
	className,
}: TagInputProps) {
	const anchor = useComboboxAnchor();
	const [query, setQuery] = useState("");

	const tags = useQuery(orpc.tag.list.queryOptions({ input: {} }));
	const createTag = useMutation(orpc.tag.create.mutationOptions());

	const items: TagOption[] = tags.data ?? [];
	const byId = new Map(items.map((tag) => [tag.id, tag]));
	const selected = value
		.map((tagId) => byId.get(tagId))
		.filter((tag): tag is TagOption => tag !== undefined);

	const needle = query.trim();
	const matches = items.filter(
		(tag) =>
			!value.includes(tag.id) &&
			(needle.length === 0 ||
				tag.name.toLowerCase().includes(needle.toLowerCase())),
	);
	const exact = items.find(
		(tag) => tag.name.toLowerCase() === needle.toLowerCase(),
	);
	const canCreate = allowCreate && needle.length > 0 && exact === undefined;
	const options: TagOption[] = canCreate
		? [...matches, { id: CREATE_ID, name: needle, color: null }]
		: matches;

	const add = (tagId: string) => {
		setQuery("");
		if (!value.includes(tagId)) {
			onValueChange([...value, tagId]);
		}
	};

	const create = async (name: string) => {
		try {
			const tag = await createTag.mutateAsync({
				name,
				color: colorForTagName(name),
			});
			add(tag.id);
			toast.success(`Tag "${tag.name}" created.`);
		} catch (error) {
			toastApiError(error, "The tag could not be created.");
		}
	};

	/**
	 * A comma commits what was typed without going through the list: the exact
	 * name, then the first match, then the creation.
	 */
	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key !== ",") {
			return;
		}
		event.preventDefault();
		if (needle.length === 0) {
			return;
		}
		const match = exact ?? matches[0];
		if (match) {
			add(match.id);
			return;
		}
		if (allowCreate) {
			void create(needle);
		}
	};

	return (
		<Combobox
			multiple
			autoHighlight
			items={options}
			value={selected}
			filter={null}
			disabled={disabled}
			inputValue={query}
			onInputValueChange={setQuery}
			onValueChange={(next: TagOption[]) => {
				const pending = next.find((tag) => tag.id === CREATE_ID);
				if (pending) {
					void create(pending.name);
					return;
				}
				setQuery("");
				onValueChange(next.map((tag) => tag.id));
			}}
			itemToStringLabel={(item: TagOption) => item.name}
			isItemEqualToValue={(item: TagOption, current: TagOption) =>
				item.id === current.id
			}
		>
			<TagsInput ref={anchor} className={className}>
				{selected.map((tag) => (
					<TagsInputChip
						key={tag.id}
						removeLabel={`Remove the tag ${tag.name}`}
					>
						<TagChip tag={tag} />
					</TagsInputChip>
				))}
				<TagsInputField
					id={id}
					aria-label={label}
					autoComplete="off"
					placeholder={selected.length === 0 ? placeholder : undefined}
					onKeyDown={onKeyDown}
				/>
			</TagsInput>
			<ComboboxContent anchor={anchor}>
				<ComboboxEmpty>No tag found.</ComboboxEmpty>
				<ComboboxList>
					{(item: TagOption) => (
						<ComboboxItem key={item.id} value={item}>
							{item.id === CREATE_ID ? (
								<>
									<PlusIcon className="size-4" />
									<span className="min-w-0 flex-1 truncate">
										Create tag "{item.name}"
									</span>
								</>
							) : (
								<TagChip tag={item} />
							)}
						</ComboboxItem>
					)}
				</ComboboxList>
			</ComboboxContent>
		</Combobox>
	);
}
