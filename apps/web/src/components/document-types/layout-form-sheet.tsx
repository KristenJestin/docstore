import type { DocumentTypeLayoutDto } from "@docstore/shared/document-type";
import type { RuleCondition } from "@docstore/shared/rule";
import { Button } from "@docstore/ui/components/button";
import { Input } from "@docstore/ui/components/input";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from "@docstore/ui/components/sheet";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";

import { DatePicker } from "@/components/date-picker";
import { FormField, FormSection } from "@/components/form-field";
import {
	asConditionGroup,
	ConditionBuilder,
	EMPTY_GROUP,
} from "@/components/rules/condition-builder";
import { toastApiError } from "@/lib/api-error";
import { orpc } from "@/utils/orpc";

interface LayoutDraft {
	name: string;
	validFrom: string | null;
	validUntil: string | null;
	signature: RuleCondition | null;
}

function emptyDraft(): LayoutDraft {
	return { name: "", validFrom: null, validUntil: null, signature: null };
}

function toDraft(layout: DocumentTypeLayoutDto): LayoutDraft {
	return {
		name: layout.name,
		validFrom: layout.validFrom,
		validUntil: layout.validUntil,
		signature: layout.signature,
	};
}

export interface LayoutFormSheetProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	documentTypeId: string;
	/** Absent = create, present = edit. */
	layout?: DocumentTypeLayoutDto;
	onSaved?: () => void;
}

/**
 * Create / edit a layout of a document type: name, validity range and optional
 * signature condition. Its extraction rules are listed by the Layouts tab,
 * which owns the only entry point to their editor.
 */
export function LayoutFormSheet({
	open,
	onOpenChange,
	documentTypeId,
	layout,
	onSaved,
}: LayoutFormSheetProps) {
	const ids = useId();
	const isEdit = Boolean(layout);
	const queryClient = useQueryClient();

	const [draft, setDraft] = useState<LayoutDraft>(emptyDraft);
	const [signatureOpen, setSignatureOpen] = useState(false);

	useEffect(() => {
		if (open) {
			const next = layout ? toDraft(layout) : emptyDraft();
			setDraft(next);
			setSignatureOpen(next.signature !== null);
		}
	}, [open, layout]);

	const add = useMutation(orpc.documentType.addLayout.mutationOptions());
	const update = useMutation(orpc.documentType.updateLayout.mutationOptions());
	const pending = add.isPending || update.isPending;

	const patch = (next: Partial<LayoutDraft>) =>
		setDraft((current) => ({ ...current, ...next }));

	const nameError =
		draft.name.trim().length === 0 ? "A name is required." : null;

	const submit = async () => {
		if (nameError) {
			return;
		}
		const payload = {
			name: draft.name.trim(),
			validFrom: draft.validFrom,
			validUntil: draft.validUntil,
			signature: signatureOpen ? draft.signature : null,
		};
		try {
			if (layout) {
				await update.mutateAsync({ id: layout.id, ...payload });
				toast.success("Layout saved.");
			} else {
				await add.mutateAsync({ documentTypeId, ...payload });
				toast.success(`Layout "${payload.name}" added.`);
			}
			await queryClient.invalidateQueries({
				queryKey: orpc.documentType.key(),
			});
			onOpenChange(false);
			onSaved?.();
		} catch (error) {
			toastApiError(error, "The layout could not be saved.");
		}
	};

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent side="right" size="md" className="w-full gap-0">
				<SheetHeader className="shrink-0 border-border border-b px-6 py-5">
					<SheetTitle>{isEdit ? "Edit layout" : "New layout"}</SheetTitle>
					<SheetDescription>
						A layout is one page design of the type. It is selected by its
						signature, then by its date range, then by trial.
					</SheetDescription>
				</SheetHeader>

				<form
					id={`${ids}-form`}
					className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 py-6"
					onSubmit={(event) => {
						event.preventDefault();
						void submit();
					}}
				>
					<FormSection title="Identity">
						<FormField
							label="Name"
							htmlFor={`${ids}-name`}
							required
							errors={
								nameError && draft.name.length > 0 ? [nameError] : undefined
							}
						>
							<Input
								id={`${ids}-name`}
								value={draft.name}
								placeholder="2024 redesign"
								onChange={(event) => patch({ name: event.target.value })}
							/>
						</FormField>

						<div className="grid grid-cols-2 gap-3">
							<FormField label="Valid from" htmlFor={`${ids}-from`}>
								<DatePicker
									id={`${ids}-from`}
									label="Valid from"
									value={draft.validFrom}
									onValueChange={(validFrom) => patch({ validFrom })}
								/>
							</FormField>
							<FormField label="Valid until" htmlFor={`${ids}-until`}>
								<DatePicker
									id={`${ids}-until`}
									label="Valid until"
									value={draft.validUntil}
									onValueChange={(validUntil) => patch({ validUntil })}
								/>
							</FormField>
						</div>
					</FormSection>

					<FormSection
						title="Signature"
						description="Condition identifying this layout in the text of the document. It wins over the date range."
					>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="self-start"
							aria-expanded={signatureOpen}
							onClick={() => {
								const next = !signatureOpen;
								setSignatureOpen(next);
								if (next && draft.signature === null) {
									patch({ signature: EMPTY_GROUP });
								}
							}}
						>
							{signatureOpen ? <ChevronDownIcon /> : <ChevronRightIcon />}
							{signatureOpen ? "Signature condition" : "Add a signature"}
						</Button>
						{signatureOpen ? (
							<ConditionBuilder
								value={asConditionGroup(draft.signature ?? EMPTY_GROUP)}
								onChange={(signature) => patch({ signature })}
							/>
						) : null}
					</FormSection>
				</form>

				<SheetFooter className="shrink-0 flex-row justify-end border-border border-t px-6 py-4">
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button
						type="submit"
						form={`${ids}-form`}
						disabled={Boolean(nameError) || pending}
					>
						{pending ? "Saving…" : isEdit ? "Save" : "Add layout"}
					</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}
