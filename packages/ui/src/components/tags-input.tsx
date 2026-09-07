"use client";

import {
	ComboboxChip,
	ComboboxChips,
	ComboboxChipsInput,
} from "@docstore/ui/components/combobox";
import { cn } from "@docstore/ui/lib/utils";
import type * as React from "react";

/**
 * Chips field of a `Combobox` tuned for tag-like values: one control that looks
 * like a plain `Input`, holds the selected values as removable chips and ends
 * with the free-text entry. It only restyles the combobox chips parts — the
 * dropdown stays the ordinary `ComboboxContent` anchored on this field, so it
 * escapes the `overflow-hidden` of a `Card`.
 *
 * Usage: `Combobox multiple` → `TagsInput` (chips + `TagsInputField`) →
 * `ComboboxContent anchor={…}`.
 */

function TagsInput({
	className,
	...props
}: React.ComponentProps<typeof ComboboxChips>) {
	return (
		<ComboboxChips
			data-slot="tags-input"
			className={cn(
				"min-h-9 w-full items-center gap-1 rounded-lg px-1.5 py-1",
				className,
			)}
			{...props}
		/>
	);
}

/** Chip carrying its own rendering (a `TagChip`, an avatar…), with no extra frame. */
function TagsInputChip({
	className,
	...props
}: React.ComponentProps<typeof ComboboxChip>) {
	return (
		<ComboboxChip
			data-slot="tags-input-chip"
			className={cn("h-6 gap-0.5 bg-transparent px-0", className)}
			{...props}
		/>
	);
}

function TagsInputField({
	className,
	...props
}: React.ComponentProps<typeof ComboboxChipsInput>) {
	return (
		<ComboboxChipsInput
			data-slot="tags-input-field"
			className={cn(
				"h-6 min-w-24 px-1 placeholder:text-muted-foreground",
				className,
			)}
			{...props}
		/>
	);
}

export { TagsInput, TagsInputChip, TagsInputField };
