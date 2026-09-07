import type { DocumentListItem } from "@docstore/shared/document";
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
import { useQuery } from "@tanstack/react-query";
import { FileTextIcon } from "lucide-react";
import { useState } from "react";

import { DocumentThumbnail } from "@/components/documents/document-thumbnail";
import { orpc } from "@/utils/orpc";

/** How many candidates the search shows at once. */
const PAGE_SIZE = 20;

export interface TestDocumentPickerProps {
	value: DocumentListItem | null;
	onValueChange: (document: DocumentListItem | null) => void;
	/** Accessible name of the trigger. */
	label?: string;
	/** Document hidden from the candidates, typically the current one. */
	excludeId?: string;
	id?: string;
}

/**
 * Document chooser of the test panels: full-text search through
 * `document.list`, most recent first when the query is empty.
 */
export function TestDocumentPicker({
	value,
	onValueChange,
	label = "Document",
	excludeId,
	id,
}: TestDocumentPickerProps) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");

	const needle = query.trim();
	const documents = useQuery(
		orpc.document.list.queryOptions({
			input: {
				query: needle.length > 0 ? needle : undefined,
				page: 1,
				pageSize: PAGE_SIZE,
				sort: "createdAt:desc",
			},
		}),
	);
	const items = (documents.data?.items ?? []).filter(
		(item) => item.id !== excludeId,
	);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				render={
					<Button
						type="button"
						id={id}
						aria-label={label}
						variant="outline"
						className="w-full justify-between font-normal"
					/>
				}
			>
				<span className="truncate leading-normal">
					{value?.title ?? "Choose a document…"}
				</span>
				<FileTextIcon />
			</PopoverTrigger>
			<PopoverContent align="start" className="w-96 p-0">
				<Command shouldFilter={false} loop>
					<CommandInput
						value={query}
						onValueChange={setQuery}
						placeholder="Search a document…"
					/>
					<CommandList>
						<CommandEmpty>No document found.</CommandEmpty>
						<CommandGroup>
							{items.map((item) => (
								<CommandItem
									key={item.id}
									value={item.id}
									onSelect={() => {
										onValueChange(item);
										setOpen(false);
									}}
								>
									<DocumentThumbnail
										thumbnailKey={item.thumbnailKey}
										sensitive={item.sensitive}
										size="sm"
									/>
									<span className="min-w-0 flex-1 truncate">{item.title}</span>
								</CommandItem>
							))}
						</CommandGroup>
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
