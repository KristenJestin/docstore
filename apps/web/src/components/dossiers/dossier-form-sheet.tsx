import type { DossierDto, DossierWithCount } from "@docstore/shared/dossier";
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
import { Textarea } from "@docstore/ui/components/textarea";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";

import { FormField } from "@/components/form-field";
import { toastApiError } from "@/lib/api-error";
import { orpc } from "@/utils/orpc";

export interface DossierFormSheetProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Absent = create, present = rename. */
	dossier?: DossierWithCount | DossierDto;
	onSaved?: (dossier: DossierDto) => void;
}

/** Create / rename a Dossier in a side sheet. */
export function DossierFormSheet({
	open,
	onOpenChange,
	dossier,
	onSaved,
}: DossierFormSheetProps) {
	const isEdit = Boolean(dossier);
	const ids = useId();
	const queryClient = useQueryClient();

	const [name, setName] = useState(dossier?.name ?? "");
	const [description, setDescription] = useState(dossier?.description ?? "");

	useEffect(() => {
		if (open) {
			setName(dossier?.name ?? "");
			setDescription(dossier?.description ?? "");
		}
	}, [open, dossier]);

	const create = useMutation(orpc.dossier.create.mutationOptions());
	const update = useMutation(orpc.dossier.update.mutationOptions());

	const trimmed = name.trim();
	const pending = create.isPending || update.isPending;

	const submit = async () => {
		if (trimmed.length === 0) {
			return;
		}
		const payload = {
			name: trimmed,
			description: description.trim() || null,
		};
		try {
			const saved = dossier
				? await update.mutateAsync({ id: dossier.id, ...payload })
				: await create.mutateAsync(payload);
			await queryClient.invalidateQueries({ queryKey: orpc.dossier.key() });
			toast.success(
				isEdit ? "Dossier updated." : `Dossier "${saved.name}" created.`,
			);
			onOpenChange(false);
			onSaved?.(saved);
		} catch (error) {
			toastApiError(error, "The dossier could not be saved.");
		}
	};

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent side="right" className="w-full gap-0">
				<SheetHeader className="shrink-0 border-border border-b px-6 py-5">
					<SheetTitle>{isEdit ? "Edit dossier" : "New dossier"}</SheetTitle>
					<SheetDescription>
						A dossier gathers documents that share a life cycle: a move, a
						claim, a tax year.
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
					<FormField label="Name" htmlFor={`${ids}-name`} required>
						<Input
							id={`${ids}-name`}
							value={name}
							placeholder="2026 move"
							onChange={(event) => setName(event.target.value)}
						/>
					</FormField>

					<FormField
						label="Description"
						htmlFor={`${ids}-description`}
						hint="What this dossier is about, and when it can be closed."
					>
						<Textarea
							id={`${ids}-description`}
							value={description}
							onChange={(event) => setDescription(event.target.value)}
						/>
					</FormField>
				</form>

				<SheetFooter className="shrink-0 flex-row justify-end border-border border-t px-6 py-4">
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button
						type="submit"
						form={`${ids}-form`}
						disabled={trimmed.length === 0 || pending}
					>
						{pending ? "Saving…" : isEdit ? "Save" : "Create dossier"}
					</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}
