import type { DocumentTypeItem } from "@docstore/shared/document-type";
import {
	Combobox,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxInput,
	ComboboxItem,
	ComboboxList,
} from "@docstore/ui/components/combobox";
import { cn } from "@docstore/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { PlusIcon, SparklesIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { toastApiError } from "@/lib/api-error";
import { orpc } from "@/utils/orpc";

import { DocumentTypeMark, PeriodicityBadge } from "./document-type-badges";

/** Sentinel ids of the two trailing actions; no type can carry them. */
const CREATE_ID = "__create__";
const FROM_DOCUMENT_ID = "__from_document__";

/** Only what the picker renders, so every list shape fits. */
export type DocumentTypeOption = Pick<
	DocumentTypeItem,
	| "id"
	| "name"
	| "icon"
	| "color"
	| "categoryName"
	| "issuerName"
	| "periodicity"
>;

function optionOf(item: DocumentTypeItem): DocumentTypeOption {
	return {
		id: item.id,
		name: item.name,
		icon: item.icon,
		color: item.color,
		categoryName: item.categoryName,
		issuerName: item.issuerName,
		periodicity: item.periodicity,
	};
}

/** Sentinel option carrying the typed name. */
function actionOption(id: string, name: string): DocumentTypeOption {
	return {
		id,
		name,
		icon: null,
		color: null,
		categoryName: null,
		issuerName: null,
		periodicity: null,
	};
}

/**
 * Document types of the picker: the whole list (there are never many) filtered
 * client side, so a selected type always keeps its name even while searching.
 */
export function useDocumentTypeOptions(): {
	options: DocumentTypeOption[];
	byId: Map<string, DocumentTypeOption>;
	isLoading: boolean;
} {
	const list = useQuery(
		orpc.documentType.list.queryOptions({
			input: { recurringOnly: false, includeDisabled: true },
		}),
	);
	const items = list.data;

	return useMemo(() => {
		const byId = new Map<string, DocumentTypeOption>();
		for (const item of items ?? []) {
			byId.set(item.id, optionOf(item));
		}
		return { options: [...byId.values()], byId, isLoading: list.isLoading };
	}, [items, list.isLoading]);
}

function DocumentTypeOptionRow({ option }: { option: DocumentTypeOption }) {
	const subtitle = [option.issuerName, option.categoryName]
		.filter(Boolean)
		.join(" · ");
	return (
		<>
			<DocumentTypeMark icon={option.icon} color={option.color} size="sm" />
			<span className="min-w-0 flex-1">
				<span className="block truncate">{option.name}</span>
				{subtitle ? (
					<span className="block truncate text-muted-foreground text-xs">
						{subtitle}
					</span>
				) : null}
			</span>
			{option.periodicity ? (
				<PeriodicityBadge periodicity={option.periodicity} />
			) : null}
		</>
	);
}

export interface DocumentTypePickerProps {
	/** Id of the selected document type, or `null`. */
	value: string | null;
	onValueChange: (documentTypeId: string | null) => void;
	label?: string;
	placeholder?: string;
	id?: string;
	/** Offers the "Create ‘…’" entry. On by default. */
	allowCreate?: boolean;
	/**
	 * When set, a "Create type from this document" entry calls
	 * `documentType.createFromDocument` and navigates to the new type.
	 */
	fromDocumentId?: string;
	disabled?: boolean;
	className?: string;
}

/**
 * **The** document type combobox of the application: the list of the types with
 * their icon, issuer and recurrence, a "Create ‘…’" quick creation (name only)
 * and, on a document screen, "Create type from this document" which prefills
 * everything from the document and opens the new type.
 */
export function DocumentTypePicker({
	value,
	onValueChange,
	label = "Document type",
	placeholder = "No document type",
	id,
	allowCreate = true,
	fromDocumentId,
	disabled = false,
	className,
}: DocumentTypePickerProps) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [query, setQuery] = useState("");
	const needle = useDebouncedValue(query.trim());
	const { options, byId } = useDocumentTypeOptions();

	const create = useMutation(orpc.documentType.create.mutationOptions());
	const createFromDocument = useMutation(
		orpc.documentType.createFromDocument.mutationOptions(),
	);
	const busy = create.isPending || createFromDocument.isPending;

	const items = useMemo(() => {
		const lower = needle.toLowerCase();
		const visible = options.filter(
			(option) =>
				lower.length === 0 || option.name.toLowerCase().includes(lower),
		);
		const exists = options.some(
			(option) => option.name.toLowerCase() === lower && lower.length > 0,
		);
		const extra: DocumentTypeOption[] = [];
		if (allowCreate && needle.length > 0 && !exists) {
			extra.push(actionOption(CREATE_ID, needle));
		}
		if (fromDocumentId) {
			extra.push(actionOption(FROM_DOCUMENT_ID, ""));
		}
		return [...visible, ...extra];
	}, [options, needle, allowCreate, fromDocumentId]);

	const selected = value ? (byId.get(value) ?? null) : null;

	const invalidate = () =>
		Promise.all([
			queryClient.invalidateQueries({ queryKey: orpc.documentType.key() }),
			queryClient.invalidateQueries({ queryKey: orpc.document.key() }),
		]);

	const quickCreate = async (name: string) => {
		try {
			const created = await create.mutateAsync({ name, tagIds: [] });
			await invalidate();
			toast.success(`Document type "${created.name}" created.`);
			onValueChange(created.id);
		} catch (error) {
			toastApiError(error, "The document type could not be created.");
		}
	};

	const createFrom = async (documentId: string) => {
		try {
			const created = await createFromDocument.mutateAsync({ documentId });
			await invalidate();
			toast.success(
				`Document type "${created.name}" created from this document.`,
			);
			await navigate({
				to: "/types/$typeId",
				params: { typeId: created.id },
			});
		} catch (error) {
			toastApiError(error, "The document type could not be created.");
		}
	};

	return (
		<Combobox
			items={items}
			value={selected}
			filter={null}
			onInputValueChange={setQuery}
			onValueChange={(next: DocumentTypeOption | null) => {
				if (next?.id === CREATE_ID) {
					void quickCreate(next.name);
					return;
				}
				if (next?.id === FROM_DOCUMENT_ID && fromDocumentId) {
					void createFrom(fromDocumentId);
					return;
				}
				onValueChange(next?.id ?? null);
			}}
			itemToStringLabel={(item: DocumentTypeOption) =>
				item.id === CREATE_ID || item.id === FROM_DOCUMENT_ID ? "" : item.name
			}
			isItemEqualToValue={(
				item: DocumentTypeOption,
				current: DocumentTypeOption,
			) => item.id === current.id}
		>
			<ComboboxInput
				id={id}
				aria-label={label}
				placeholder={placeholder}
				disabled={disabled || busy}
				showClear
				className={cn("w-full", className)}
			/>
			<ComboboxContent>
				<ComboboxEmpty>No document type found.</ComboboxEmpty>
				<ComboboxList>
					{(item: DocumentTypeOption) => (
						<ComboboxItem key={item.id} value={item}>
							{item.id === CREATE_ID ? (
								<>
									<PlusIcon className="size-4" />
									<span className="min-w-0 flex-1 truncate">
										Create “{item.name}”…
									</span>
								</>
							) : item.id === FROM_DOCUMENT_ID ? (
								<>
									<SparklesIcon className="size-4 text-primary" />
									<span className="min-w-0 flex-1 truncate">
										Create type from this document
									</span>
								</>
							) : (
								<DocumentTypeOptionRow option={item} />
							)}
						</ComboboxItem>
					)}
				</ComboboxList>
			</ComboboxContent>
		</Combobox>
	);
}
