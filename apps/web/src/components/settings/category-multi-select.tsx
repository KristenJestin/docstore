import { Badge } from "@docstore/ui/components/badge";
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
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@docstore/ui/components/popover";
import { CheckIcon, FolderTreeIcon } from "lucide-react";
import { useState } from "react";

import { useCategoryOptions } from "@/components/documents/category-picker";

import { countLabel } from "@/lib/plural";

export interface CategoryMultiSelectProps {
	value: string[];
	onValueChange: (categoryIds: string[]) => void;
	/** Wording of the trigger when nothing is selected. */
	emptyLabel?: string;
	id?: string;
}

/** Multi-selection of categories, listed by their full path. */
export function CategoryMultiSelect({
	value,
	onValueChange,
	emptyLabel = "Every category",
	id,
}: CategoryMultiSelectProps) {
	const { options } = useCategoryOptions();
	const [open, setOpen] = useState(false);

	const toggle = (categoryId: string) => {
		onValueChange(
			value.includes(categoryId)
				? value.filter((item) => item !== categoryId)
				: [...value, categoryId],
		);
	};

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				render={
					<Button
						type="button"
						id={id}
						variant="outline"
						className="w-full justify-between font-normal"
					/>
				}
			>
				<span className="truncate leading-normal">
					{value.length === 0
						? emptyLabel
						: countLabel(value.length, "category", "categories")}
				</span>
				<FolderTreeIcon />
			</PopoverTrigger>
			<PopoverContent align="start" className="w-80 p-0">
				<Command loop>
					<CommandInput placeholder="Search a category…" />
					<CommandList>
						<CommandEmpty>No category found.</CommandEmpty>
						<CommandGroup>
							{options.map((option) => (
								<CommandItem
									key={option.id}
									value={option.path}
									onSelect={() => toggle(option.id)}
								>
									<span className="min-w-0 flex-1 truncate">{option.path}</span>
									{value.includes(option.id) ? (
										<CheckIcon className="size-4" />
									) : null}
								</CommandItem>
							))}
						</CommandGroup>
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}

/** Read-only summary of the selected categories, shown under the trigger. */
export function CategoryBadges({ value }: { value: string[] }) {
	const { byId } = useCategoryOptions();
	if (value.length === 0) {
		return null;
	}
	return (
		<ul className="flex flex-wrap gap-1">
			{value.map((categoryId) => (
				<li key={categoryId}>
					<Badge tone="outline">
						{byId.get(categoryId)?.path ?? categoryId}
					</Badge>
				</li>
			))}
		</ul>
	);
}
