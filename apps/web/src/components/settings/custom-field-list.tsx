import { slugify } from "@docstore/shared/common";
import type {
	CustomField,
	CustomFieldOptions,
	CustomFieldType,
} from "@docstore/shared/custom-field";
import { CUSTOM_FIELD_TYPES } from "@docstore/shared/custom-field";
import { Badge } from "@docstore/ui/components/badge";
import { Button } from "@docstore/ui/components/button";
import { Input } from "@docstore/ui/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@docstore/ui/components/select";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from "@docstore/ui/components/sheet";
import { Skeleton } from "@docstore/ui/components/skeleton";
import { Switch } from "@docstore/ui/components/switch";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	PencilIcon,
	PlusIcon,
	SlidersHorizontalIcon,
	Trash2Icon,
} from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";

import { ChipsInput } from "@/components/chips-input";
import { useConfirm } from "@/components/confirm-dialog";
import {
	DragHandle,
	SortableList,
	SortableRow,
} from "@/components/dnd/sortable";
import { EmptyState } from "@/components/empty-state";
import { FormField } from "@/components/form-field";
import { toastApiError } from "@/lib/api-error";
import { countLabel } from "@/lib/plural";
import { orpc } from "@/utils/orpc";
import { CategoryBadges, CategoryMultiSelect } from "./category-multi-select";
import { CUSTOM_FIELD_TYPE_LABELS } from "./settings-labels";
import { SettingsPanel, SettingsStack } from "./settings-panel";

/** Default currency proposed for a `money` field (the API falls back to it). */
const DEFAULT_CURRENCY = "EUR";

/**
 * Custom field definitions (SPEC §2): ordered list reordered by drag and drop
 * (`SortableList`, keyboard included), creation and editing in a side sheet,
 * deletion. The type can no longer change once values exist — the API answers
 * `CONFLICT` and its message is surfaced in the toast.
 */
export function CustomFieldList() {
	const queryClient = useQueryClient();
	const confirm = useConfirm();
	const fields = useQuery(orpc.customField.list.queryOptions({ input: {} }));

	const [editing, setEditing] = useState<CustomField | null>(null);
	const [creating, setCreating] = useState(false);

	const reorder = useMutation(orpc.customField.reorder.mutationOptions());
	const remove = useMutation(orpc.customField.delete.mutationOptions());

	const invalidate = async () => {
		await queryClient.invalidateQueries({ queryKey: orpc.customField.key() });
	};

	const items = fields.data ?? [];

	const onReorder = async (ids: string[]) => {
		try {
			await reorder.mutateAsync({ ids });
			await invalidate();
		} catch (error) {
			toastApiError(error, "The fields could not be reordered.");
		}
	};

	const destroy = async (field: CustomField) => {
		const ok = await confirm({
			title: `Delete the field "${field.name}"?`,
			description: "Every value entered for this field is deleted with it.",
			confirmLabel: "Delete",
			destructive: true,
		});
		if (!ok) {
			return;
		}
		try {
			await remove.mutateAsync({ id: field.id });
			await invalidate();
			toast.success("Custom field deleted.");
		} catch (error) {
			toastApiError(error, "The field could not be deleted.");
		}
	};

	if (fields.isLoading) {
		return (
			<SettingsStack>
				<Skeleton className="h-64 w-full" />
			</SettingsStack>
		);
	}

	return (
		<SettingsStack>
			<SettingsPanel
				title="Custom fields"
				description="Extra metadata offered on the document form. Drag a row to change the order they appear in."
				actions={
					<Button size="sm" onClick={() => setCreating(true)}>
						<PlusIcon />
						New field
					</Button>
				}
			>
				{items.length === 0 ? (
					<div className="p-3">
						<EmptyState
							icon={SlidersHorizontalIcon}
							title="No custom field"
							description="Add the fields your documents need: invoice number, amount, contract end date…"
							size="sm"
							action={
								<Button variant="outline" onClick={() => setCreating(true)}>
									<PlusIcon />
									New field
								</Button>
							}
						/>
					</div>
				) : (
					<SortableList
						ids={items.map((field) => field.id)}
						onReorder={(ids) => void onReorder(ids)}
						label="Reorder the custom fields"
						disabled={reorder.isPending}
					>
						<ul className="divide-y divide-border">
							{items.map((field) => (
								<SortableRow key={field.id} id={field.id}>
									{({ handleProps }) => (
										<div className="group/row flex h-14 items-center gap-3 px-4 transition-colors duration-200 ease-premium hover:bg-muted/70">
											<DragHandle
												handleProps={handleProps}
												label={`Reorder ${field.name}`}
												disabled={reorder.isPending}
											/>

											<div className="min-w-0 flex-1">
												<p className="truncate font-medium text-sm">
													{field.name}
												</p>
												<p className="truncate font-mono text-muted-foreground text-xs">
													{field.slug}
												</p>
											</div>

											<Badge tone="neutral" className="shrink-0">
												{CUSTOM_FIELD_TYPE_LABELS[field.type]}
											</Badge>
											<Badge tone="outline" className="shrink-0">
												{field.categoryIds.length === 0
													? "every category"
													: countLabel(
															field.categoryIds.length,
															"category",
															"categories",
														)}
											</Badge>

											<div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/row:opacity-100">
												<Button
													variant="ghost"
													size="icon-sm"
													aria-label={`Edit ${field.name}`}
													onClick={() => setEditing(field)}
												>
													<PencilIcon />
												</Button>
												<Button
													variant="ghost"
													size="icon-sm"
													aria-label={`Delete ${field.name}`}
													onClick={() => void destroy(field)}
												>
													<Trash2Icon />
												</Button>
											</div>
										</div>
									)}
								</SortableRow>
							))}
						</ul>
					</SortableList>
				)}
			</SettingsPanel>

			<CustomFieldSheet
				open={creating || editing !== null}
				field={editing ?? undefined}
				onOpenChange={(open) => {
					if (!open) {
						setCreating(false);
						setEditing(null);
					}
				}}
				onSaved={invalidate}
			/>
		</SettingsStack>
	);
}

/** Create / edit form of a custom field, in a side sheet. */
function CustomFieldSheet({
	open,
	field,
	onOpenChange,
	onSaved,
}: {
	open: boolean;
	field?: CustomField;
	onOpenChange: (open: boolean) => void;
	onSaved: () => Promise<void>;
}) {
	const fieldId = useId();
	const isEdit = Boolean(field);

	const [name, setName] = useState("");
	const [slug, setSlug] = useState("");
	const [slugTouched, setSlugTouched] = useState(false);
	const [type, setType] = useState<CustomFieldType>("text");
	const [choices, setChoices] = useState<string[]>([]);
	const [currency, setCurrency] = useState(DEFAULT_CURRENCY);
	const [allowNegative, setAllowNegative] = useState(false);
	const [categoryIds, setCategoryIds] = useState<string[]>([]);
	const [loadedFor, setLoadedFor] = useState<string | null>(null);

	const createField = useMutation(orpc.customField.create.mutationOptions());
	const updateField = useMutation(orpc.customField.update.mutationOptions());
	const pending = createField.isPending || updateField.isPending;

	// Reset when the sheet opens on a different field (or on a creation).
	const key = field?.id ?? "__new__";
	if (open && loadedFor !== key) {
		setLoadedFor(key);
		setName(field?.name ?? "");
		setSlug(field?.slug ?? "");
		setSlugTouched(Boolean(field));
		setType(field?.type ?? "text");
		setChoices(field?.options.choices ?? []);
		setCurrency(field?.options.currency ?? DEFAULT_CURRENCY);
		setAllowNegative(field?.options.allowNegative ?? false);
		setCategoryIds(field?.categoryIds ?? []);
	}
	if (!open && loadedFor !== null) {
		setLoadedFor(null);
	}

	const changeName = (value: string) => {
		setName(value);
		if (!slugTouched) {
			setSlug(slugify(value));
		}
	};

	const submit = async () => {
		const trimmed = name.trim();
		if (trimmed.length === 0) {
			return;
		}
		// A credit note is the exception: a signed amount has to be asked for.
		const options: CustomFieldOptions =
			type === "select"
				? { choices }
				: type === "money"
					? { currency: currency.trim().toUpperCase(), allowNegative }
					: type === "number"
						? { allowNegative }
						: {};
		try {
			if (field) {
				await updateField.mutateAsync({
					id: field.id,
					name: trimmed,
					slug: slug.trim(),
					type,
					options,
					categoryIds,
				});
				toast.success("Custom field updated.");
			} else {
				await createField.mutateAsync({
					name: trimmed,
					slug: slug.trim(),
					type,
					options,
					categoryIds,
				});
				toast.success(`Field "${trimmed}" created.`);
			}
			await onSaved();
			onOpenChange(false);
		} catch (error) {
			toastApiError(error, "The field could not be saved.");
		}
	};

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent side="right" className="w-full gap-0 sm:max-w-lg">
				<SheetHeader className="shrink-0 border-border border-b px-6 py-5">
					<SheetTitle>
						{isEdit ? "Edit custom field" : "New custom field"}
					</SheetTitle>
					<SheetDescription>
						The slug is the stable identifier used by the API and the MCP
						agents.
					</SheetDescription>
				</SheetHeader>

				<div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-6">
					<FormField label="Name" htmlFor={`${fieldId}-name`} required>
						<Input
							id={`${fieldId}-name`}
							value={name}
							onChange={(event) => changeName(event.target.value)}
						/>
					</FormField>

					<FormField
						label="Slug"
						htmlFor={`${fieldId}-slug`}
						hint="Lowercase letters, digits and hyphens."
					>
						<Input
							id={`${fieldId}-slug`}
							value={slug}
							onChange={(event) => {
								setSlugTouched(true);
								setSlug(event.target.value);
							}}
							className="font-mono"
						/>
					</FormField>

					<FormField
						label="Type"
						htmlFor={`${fieldId}-type`}
						hint={
							isEdit
								? "The type is locked as soon as a value has been entered."
								: undefined
						}
					>
						<Select
							items={CUSTOM_FIELD_TYPE_LABELS}
							value={type}
							onValueChange={(value) => setType(value as CustomFieldType)}
						>
							<SelectTrigger id={`${fieldId}-type`} className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{CUSTOM_FIELD_TYPES.map((item) => (
									<SelectItem key={item} value={item}>
										{CUSTOM_FIELD_TYPE_LABELS[item]}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</FormField>

					{type === "select" ? (
						<FormField
							label="Choices"
							htmlFor={`${fieldId}-choices`}
							hint="Type a choice then press Enter."
						>
							<ChipsInput
								id={`${fieldId}-choices`}
								values={choices}
								onValuesChange={setChoices}
							/>
						</FormField>
					) : null}

					{type === "money" ? (
						<FormField
							label="Currency"
							htmlFor={`${fieldId}-currency`}
							hint="ISO 4217 code, e.g. EUR. Every value of the field is expressed in it."
						>
							<Input
								id={`${fieldId}-currency`}
								value={currency}
								maxLength={3}
								onChange={(event) =>
									setCurrency(event.target.value.toUpperCase())
								}
								className="w-24 font-mono"
							/>
						</FormField>
					) : null}

					{type === "money" || type === "number" ? (
						<div className="flex items-center justify-between gap-4">
							<div>
								<p className="font-medium text-sm">Allow negative values</p>
								<p className="text-muted-foreground text-xs">
									Off: the API refuses a negative
									{type === "money" ? " amount" : " value"} — a credit note is
									the exception, not the rule.
								</p>
							</div>
							<Switch
								aria-label="Allow negative values"
								checked={allowNegative}
								onCheckedChange={setAllowNegative}
							/>
						</div>
					) : null}

					<FormField
						label="Categories"
						htmlFor={`${fieldId}-categories`}
						hint="Leave empty to offer the field on every document."
					>
						<CategoryMultiSelect
							id={`${fieldId}-categories`}
							value={categoryIds}
							onValueChange={setCategoryIds}
						/>
					</FormField>
					<CategoryBadges value={categoryIds} />
				</div>

				<SheetFooter className="shrink-0 flex-row justify-end border-border border-t px-6 py-4">
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button
						onClick={submit}
						disabled={pending || name.trim().length === 0}
					>
						{isEdit ? "Save" : "Create field"}
					</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}
