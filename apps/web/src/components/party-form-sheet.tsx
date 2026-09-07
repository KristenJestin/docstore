import type { Party, PartyIdentifiers } from "@docstore/shared/party";
import {
	normalizeIdentifier,
	normalizeIdentifiers,
	PARTY_TYPES,
} from "@docstore/shared/party";
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
import { Switch } from "@docstore/ui/components/switch";
import { Textarea } from "@docstore/ui/components/textarea";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";

import {
	type PartyConflict,
	partyConflict,
	toastApiError,
} from "@/lib/api-error";
import {
	EMPTY_PARTY_FORM,
	partyFormSchema,
	partyToFormValues,
	toPartyPayload,
} from "@/lib/party-form";
import { client, orpc } from "@/utils/orpc";

import { ChipsInput } from "./chips-input";
import { FormField, FormSection } from "./form-field";
import { IconLabel, iconLabelItems } from "./icon-label";
import {
	applyLogoDraft,
	KEEP_LOGO,
	type LogoDraft,
	PartyLogoField,
} from "./parties/party-logo-field";
import { PartyMergeDialog } from "./parties/party-merge-dialog";
import { PARTY_TYPE_ICONS, PARTY_TYPE_LABELS } from "./party-type-badge";

const PARTY_TYPE_ITEMS = iconLabelItems(
	PARTY_TYPES,
	PARTY_TYPE_LABELS,
	PARTY_TYPE_ICONS,
);

/** Fields `assertNoDuplicate` compares on the API side. */
type ConflictField = "name" | "siren" | "siret" | "vat" | "domain";

/** The rejected value, plus the field of the form it belongs under. */
interface FieldConflict extends PartyConflict {
	field: ConflictField;
}

/**
 * Which field the `CONFLICT` is about: the API names the surviving Party but
 * not what it collided on, so its identifiers are read back and compared with
 * what was submitted. The name is the remaining case (`type` + `name` match).
 */
async function conflictField(
	existingId: string,
	submitted: PartyIdentifiers,
): Promise<ConflictField> {
	try {
		const existing = await client.party.get({ id: existingId });
		// The API compares canonical values; so must this.
		const identifiers = normalizeIdentifiers(submitted);
		for (const key of ["siren", "siret", "vat"] as const) {
			const value = identifiers[key];
			if (value && existing.identifiers[key] === value) {
				return key;
			}
		}
		const domains = new Set(existing.identifiers.domain ?? []);
		if ((identifiers.domain ?? []).some((domain) => domains.has(domain))) {
			return "domain";
		}
	} catch {
		// Unreadable (archived, deleted since): the name is the safe guess.
	}
	return "name";
}

export interface PartyFormSheetProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Absent = create, present = edit. */
	party?: Party;
	onSaved?: (party: Party) => void;
}

/** Create / edit form of a party, rendered in a side sheet. */
export function PartyFormSheet({
	open,
	onOpenChange,
	party,
	onSaved,
}: PartyFormSheetProps) {
	const isEdit = Boolean(party);
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const fieldId = useId();
	const [logo, setLogo] = useState<LogoDraft>(KEEP_LOGO);
	const [conflict, setConflict] = useState<FieldConflict | null>(null);
	const [mergeOpen, setMergeOpen] = useState(false);

	// The sheet stays mounted: the logo draft and the last rejection are dropped
	// every time it reopens.
	useEffect(() => {
		if (open) {
			setLogo(KEEP_LOGO);
			setConflict(null);
		}
	}, [open]);

	const createParty = useMutation(orpc.party.create.mutationOptions());
	const updateParty = useMutation(orpc.party.update.mutationOptions());

	const form = useForm({
		defaultValues: party ? partyToFormValues(party) : EMPTY_PARTY_FORM,
		validators: { onSubmit: partyFormSchema },
		onSubmit: async ({ value }) => {
			const payload = toPartyPayload(value);
			setConflict(null);
			try {
				const saved = party
					? await updateParty.mutateAsync({
							id: party.id,
							...payload,
							// This form owns the whole identifiers block: without it the
							// patch semantics of `party.update` would keep a domain the
							// user just cleared.
							replaceIdentifiers: true,
						})
					: await createParty.mutateAsync(payload);
				// The logo needs an id, so it is always sent in a second step: on
				// create the party exists by now, on edit nothing changes.
				try {
					await applyLogoDraft(saved.id, logo, queryClient);
				} catch (error) {
					toastApiError(error, "The logo could not be saved.");
				}
				toast.success(
					isEdit ? "Party updated." : `Party "${saved.name}" created.`,
				);
				onOpenChange(false);
				form.reset();
				setLogo(KEEP_LOGO);
				onSaved?.(saved);
			} catch (error) {
				const existing = partyConflict(error);
				if (existing) {
					setConflict({
						...existing,
						field: await conflictField(existing.id, payload.identifiers),
					});
				}
				toastApiError(error, "The party could not be saved.");
			}
		},
	});

	/** The notice, rendered under the field the conflict is about. */
	const conflictFor = (field: ConflictField) =>
		conflict?.field === field ? (
			<ConflictNotice
				conflict={conflict}
				canMerge={isEdit}
				onMerge={() => {
					onOpenChange(false);
					setMergeOpen(true);
				}}
			/>
		) : null;

	return (
		<>
			<Sheet open={open} onOpenChange={onOpenChange}>
				<SheetContent side="right" className="w-full gap-0 sm:max-w-lg">
					<SheetHeader className="shrink-0 border-border border-b px-6 py-5">
						<SheetTitle>{isEdit ? "Edit party" : "New party"}</SheetTitle>
						<SheetDescription>
							A party is a person, a company, a public body or an association
							linked to your documents.
						</SheetDescription>
					</SheetHeader>

					<form
						id={`${fieldId}-form`}
						className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 py-6"
						onSubmit={(event) => {
							event.preventDefault();
							event.stopPropagation();
							form.handleSubmit();
						}}
					>
						<FormSection title="Identity">
							<form.Subscribe
								selector={(state) => ({
									name: state.values.name,
									domains: state.values.identifiers.domain,
								})}
							>
								{({ name, domains }) => (
									<FormField label="Logo">
										<PartyLogoField
											name={name || "?"}
											logoKey={party?.logoKey ?? null}
											partyId={party?.id}
											hasDomain={domains.length > 0}
											value={logo}
											onValueChange={setLogo}
										/>
									</FormField>
								)}
							</form.Subscribe>

							<form.Field name="type">
								{(field) => (
									<FormField label="Type" htmlFor={`${fieldId}-type`} required>
										<Select
											items={PARTY_TYPE_ITEMS}
											value={field.state.value}
											onValueChange={(value) =>
												field.handleChange(
													value as (typeof PARTY_TYPES)[number],
												)
											}
										>
											<SelectTrigger id={`${fieldId}-type`} className="w-full">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												{PARTY_TYPES.map((type) => (
													<SelectItem key={type} value={type}>
														<IconLabel
															icon={PARTY_TYPE_ICONS[type]}
															label={PARTY_TYPE_LABELS[type]}
														/>
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									</FormField>
								)}
							</form.Field>

							<form.Field name="name">
								{(field) => (
									<FormField
										label="Name"
										htmlFor={`${fieldId}-name`}
										required
										errors={field.state.meta.errors}
									>
										<Input
											id={`${fieldId}-name`}
											name={field.name}
											value={field.state.value}
											onBlur={field.handleBlur}
											onChange={(event) =>
												field.handleChange(event.target.value)
											}
										/>
										{conflictFor("name")}
									</FormField>
								)}
							</form.Field>

							<form.Field name="aliases">
								{(field) => (
									<FormField
										label="Alias"
										htmlFor={`${fieldId}-aliases`}
										hint="Other names: legal name, brand, former name."
									>
										<ChipsInput
											id={`${fieldId}-aliases`}
											values={field.state.value}
											onValuesChange={field.handleChange}
										/>
									</FormField>
								)}
							</form.Field>

							<form.Field name="isHouseholdMember">
								{(field) => (
									<div className="flex items-center justify-between gap-4">
										<div>
											<p className="text-sm">Household member</p>
											<p className="text-muted-foreground text-xs">
												Family members are parties too.
											</p>
										</div>
										<Switch
											checked={field.state.value}
											onCheckedChange={(checked) => field.handleChange(checked)}
											aria-label="Household member"
										/>
									</div>
								)}
							</form.Field>
						</FormSection>

						<FormSection title="Identifiers">
							<div className="grid grid-cols-2 gap-3">
								<form.Field name="identifiers.siren">
									{(field) => (
										<FormField label="SIREN" htmlFor={`${fieldId}-siren`}>
											<Input
												id={`${fieldId}-siren`}
												value={field.state.value}
												onChange={(event) =>
													field.handleChange(event.target.value)
												}
												onBlur={(event) =>
													field.handleChange(
														normalizeIdentifier("siren", event.target.value),
													)
												}
											/>
											{conflictFor("siren")}
										</FormField>
									)}
								</form.Field>
								<form.Field name="identifiers.siret">
									{(field) => (
										<FormField label="SIRET" htmlFor={`${fieldId}-siret`}>
											<Input
												id={`${fieldId}-siret`}
												value={field.state.value}
												onChange={(event) =>
													field.handleChange(event.target.value)
												}
												onBlur={(event) =>
													field.handleChange(
														normalizeIdentifier("siret", event.target.value),
													)
												}
											/>
											{conflictFor("siret")}
										</FormField>
									)}
								</form.Field>
								<form.Field name="identifiers.vat">
									{(field) => (
										<FormField label="VAT number" htmlFor={`${fieldId}-vat`}>
											<Input
												id={`${fieldId}-vat`}
												value={field.state.value}
												onChange={(event) =>
													field.handleChange(event.target.value)
												}
												onBlur={(event) =>
													field.handleChange(
														normalizeIdentifier("vat", event.target.value),
													)
												}
											/>
											{conflictFor("vat")}
										</FormField>
									)}
								</form.Field>
								<form.Field name="identifiers.customerRef">
									{(field) => (
										<FormField
											label="Customer number"
											htmlFor={`${fieldId}-customer-ref`}
										>
											<Input
												id={`${fieldId}-customer-ref`}
												value={field.state.value}
												onChange={(event) =>
													field.handleChange(event.target.value)
												}
												onBlur={(event) =>
													field.handleChange(
														normalizeIdentifier(
															"customerRef",
															event.target.value,
														),
													)
												}
											/>
										</FormField>
									)}
								</form.Field>
							</div>

							<form.Field name="identifiers.domain">
								{(field) => (
									<FormField
										label="Domains"
										htmlFor={`${fieldId}-domain`}
										hint="Used to recognise the issuer of a document."
									>
										<ChipsInput
											id={`${fieldId}-domain`}
											normalize={(value) =>
												normalizeIdentifier("domain", value)
											}
											values={field.state.value}
											onValuesChange={field.handleChange}
											placeholder="free.fr, then Enter"
										/>
										{conflictFor("domain")}
									</FormField>
								)}
							</form.Field>

							<form.Field name="identifiers.email">
								{(field) => (
									<FormField
										label="Email addresses"
										htmlFor={`${fieldId}-email`}
										errors={field.state.meta.errors}
									>
										<ChipsInput
											id={`${fieldId}-email`}
											normalize={(value) => normalizeIdentifier("email", value)}
											type="email"
											values={field.state.value}
											onValuesChange={field.handleChange}
										/>
									</FormField>
								)}
							</form.Field>

							<form.Field name="identifiers.phone">
								{(field) => (
									<FormField label="Phone numbers" htmlFor={`${fieldId}-phone`}>
										<ChipsInput
											id={`${fieldId}-phone`}
											normalize={(value) => normalizeIdentifier("phone", value)}
											values={field.state.value}
											onValuesChange={field.handleChange}
										/>
									</FormField>
								)}
							</form.Field>

							<form.Field name="identifiers.iban">
								{(field) => (
									<FormField label="IBAN" htmlFor={`${fieldId}-iban`}>
										<ChipsInput
											id={`${fieldId}-iban`}
											normalize={(value) => normalizeIdentifier("iban", value)}
											values={field.state.value}
											onValuesChange={field.handleChange}
										/>
									</FormField>
								)}
							</form.Field>
						</FormSection>

						<FormSection title="Notes">
							<form.Field name="notes">
								{(field) => (
									<FormField
										label="Free-form note"
										htmlFor={`${fieldId}-notes`}
									>
										<Textarea
											id={`${fieldId}-notes`}
											value={field.state.value}
											onChange={(event) =>
												field.handleChange(event.target.value)
											}
										/>
									</FormField>
								)}
							</form.Field>
						</FormSection>
					</form>

					<SheetFooter className="shrink-0 flex-row justify-end border-border border-t px-6 py-4">
						<Button variant="outline" onClick={() => onOpenChange(false)}>
							Cancel
						</Button>
						<form.Subscribe
							selector={(state) => ({
								canSubmit: state.canSubmit,
								isSubmitting: state.isSubmitting,
							})}
						>
							{({ canSubmit, isSubmitting }) => (
								<Button
									type="submit"
									form={`${fieldId}-form`}
									disabled={!canSubmit || isSubmitting}
								>
									{isSubmitting ? "Saving…" : isEdit ? "Save" : "Create party"}
								</Button>
							)}
						</form.Subscribe>
					</SheetFooter>
				</SheetContent>
			</Sheet>

			{party ? (
				<PartyMergeDialog
					open={mergeOpen}
					onOpenChange={setMergeOpen}
					sourceId={party.id}
					initialTargetId={conflict?.id ?? null}
					onMerged={(result) => {
						setConflict(null);
						navigate({
							to: "/parties/$partyId",
							params: { partyId: result.target.id },
						});
					}}
				/>
			) : null}
		</>
	);
}

/**
 * "This identifier already names another party": the offending field says who
 * holds it, links to that page and, when an existing party is being edited,
 * offers the merge rather than leaving the form stuck.
 */
function ConflictNotice({
	conflict,
	canMerge,
	onMerge,
}: {
	conflict: FieldConflict;
	canMerge: boolean;
	onMerge: () => void;
}) {
	return (
		<p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-destructive text-xs">
			<span>Already used by</span>
			<Link
				to="/parties/$partyId"
				params={{ partyId: conflict.id }}
				className="font-medium underline underline-offset-2"
			>
				{conflict.name}
			</Link>
			{canMerge ? (
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="h-auto px-1.5 py-0.5"
					onClick={onMerge}
				>
					Merge instead
				</Button>
			) : null}
		</p>
	);
}
