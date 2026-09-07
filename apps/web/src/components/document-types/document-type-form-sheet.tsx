import { renderTitleTemplate } from "@docstore/rules/title";
import type {
	DocumentTypeDto,
	DocumentTypeItem,
} from "@docstore/shared/document-type";
import { DEFAULT_RECURRING_TITLE_TEMPLATE } from "@docstore/shared/document-type";
import type { Periodicity } from "@docstore/shared/recurrence";
import {
	DEFAULT_GRACE_DAYS,
	PERIODICITIES,
	periodKeyOf,
} from "@docstore/shared/recurrence";
import type { RuleCondition } from "@docstore/shared/rule";
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
import { useMutation } from "@tanstack/react-query";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";

import { CategoryPicker } from "@/components/documents/category-picker";
import { TagInput } from "@/components/documents/tag-input";
import { FormField, FormSection } from "@/components/form-field";
import { IconLabel, iconLabelItems } from "@/components/icon-label";
import { PartyPicker } from "@/components/parties/party-picker";
import {
	asConditionGroup,
	ConditionBuilder,
	EMPTY_GROUP,
} from "@/components/rules/condition-builder";
import {
	ColorPicker,
	IconPicker,
} from "@/components/settings/taxonomy-pickers";
import { TitleTemplateInput } from "@/components/title-template-input";
import { toastApiError } from "@/lib/api-error";
import { orpc } from "@/utils/orpc";

import {
	PERIODICITY_ICONS,
	PERIODICITY_TITLES,
	TYPE_TITLE_PLACEHOLDERS,
} from "./document-type-labels";
import { PeriodHint, PeriodPicker, toPeriodStart } from "./period-picker";

const PERIODICITY_ITEMS = iconLabelItems(
	PERIODICITIES,
	PERIODICITY_TITLES,
	PERIODICITY_ICONS,
);

/** `YYYY-MM-DD` of today, in UTC. */
function todayIso(): string {
	return new Date().toISOString().slice(0, 10);
}

/**
 * Title the template would render, on a made-up document filed today. The
 * engine is the very same one the API runs, so what the field shows is what
 * the documents will get.
 */
function titleExample(draft: DocumentTypeDraft): string {
	const periodStart = toPeriodStart(todayIso(), draft.periodicity);
	return renderTitleTemplate(draft.titleTemplate, {
		type: draft.name.trim() || "Document type",
		date: todayIso(),
		issuer: "Nordwind Digital",
		subject: "Camille Report",
		category: "Invoice",
		title: "Scan 2026-03-17",
		filename: "scan-2026-03-17.pdf",
		ext: "pdf",
		periodStart,
		periodEnd: null,
		periodKey: draft.recurring
			? periodKeyOf(draft.periodicity, periodStart)
			: null,
	});
}

/**
 * Draft of the form. The two periods keep the API shape — the first day of the
 * period — so `PeriodPicker` and the payload speak the same language.
 */
export interface DocumentTypeDraft {
	name: string;
	description: string;
	icon: string | null;
	color: string | null;
	categoryId: string | null;
	issuerPartyId: string | null;
	subjectPartyId: string | null;
	tagIds: string[];
	sensitiveDefault: boolean;
	/** Numbers every document this type is applied to. */
	paperOriginal: boolean;
	titleTemplate: string;
	detection: RuleCondition | null;
	enabled: boolean;
	/** `false` = the type is not recurring; the block below is then ignored. */
	recurring: boolean;
	periodicity: Periodicity;
	startPeriod: string | null;
	endPeriod: string | null;
	expectedDay: string;
	graceDays: string;
}

export function emptyDocumentTypeDraft(): DocumentTypeDraft {
	return {
		name: "",
		description: "",
		icon: null,
		color: null,
		categoryId: null,
		issuerPartyId: null,
		subjectPartyId: null,
		tagIds: [],
		sensitiveDefault: false,
		paperOriginal: false,
		titleTemplate: "",
		detection: null,
		enabled: true,
		recurring: false,
		periodicity: "monthly",
		startPeriod: toPeriodStart(todayIso(), "monthly"),
		endPeriod: null,
		expectedDay: "",
		graceDays: String(DEFAULT_GRACE_DAYS),
	};
}

function toDraft(type: DocumentTypeDto | DocumentTypeItem): DocumentTypeDraft {
	return {
		name: type.name,
		description: type.description ?? "",
		icon: type.icon,
		color: type.color,
		categoryId: type.categoryId,
		issuerPartyId: type.issuerPartyId,
		subjectPartyId: type.subjectPartyId,
		tagIds: type.tagIds,
		sensitiveDefault: type.sensitiveDefault,
		paperOriginal: type.paperOriginal,
		titleTemplate: type.titleTemplate ?? "",
		detection: type.detection,
		enabled: type.enabled,
		recurring: type.periodicity !== null,
		periodicity: type.periodicity ?? "monthly",
		startPeriod: type.startPeriod ?? toPeriodStart(todayIso(), "monthly"),
		endPeriod: type.endPeriod,
		expectedDay: type.expectedDay === null ? "" : String(type.expectedDay),
		graceDays: String(type.graceDays ?? DEFAULT_GRACE_DAYS),
	};
}

export interface DocumentTypeFormSheetProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Absent = create, present = edit. */
	documentType?: DocumentTypeDto | DocumentTypeItem;
	/** Values prefilled by a suggestion or by the "Recurring" tab. */
	initial?: Partial<DocumentTypeDraft>;
	onSaved?: (documentType: DocumentTypeDto) => void;
}

/**
 * Create / edit form of a document type in a side sheet: identity (name,
 * description, icon, colour), filing (category, issuer, subject, tags,
 * sensitivity, title template), the collapsible "Auto-detect" condition and
 * the optional recurrence block.
 */
export function DocumentTypeFormSheet({
	open,
	onOpenChange,
	documentType,
	initial,
	onSaved,
}: DocumentTypeFormSheetProps) {
	const isEdit = Boolean(documentType);
	const ids = useId();

	const [draft, setDraft] = useState<DocumentTypeDraft>(() => ({
		...emptyDocumentTypeDraft(),
		...initial,
	}));
	const [detectionOpen, setDetectionOpen] = useState(false);

	// The sheet stays mounted: the draft is rebuilt every time it reopens, so
	// editing a second type never shows the previous values.
	useEffect(() => {
		if (open) {
			const next = documentType
				? toDraft(documentType)
				: { ...emptyDocumentTypeDraft(), ...(initial ?? {}) };
			setDraft(next);
			setDetectionOpen(next.detection !== null);
		}
	}, [open, documentType, initial]);

	const create = useMutation(orpc.documentType.create.mutationOptions());
	const update = useMutation(orpc.documentType.update.mutationOptions());

	const patch = (next: Partial<DocumentTypeDraft>) =>
		setDraft((current) => ({ ...current, ...next }));

	const nameError =
		draft.name.trim().length === 0 ? "A name is required." : null;
	const startError =
		draft.recurring && draft.startPeriod === null
			? "A start period is required."
			: null;
	const canSubmit = !nameError && !startError;

	/** Switching the periodicity re-snaps both bounds to the new period. */
	const setPeriodicity = (periodicity: Periodicity) => {
		const snap = (value: string | null) =>
			value === null ? null : toPeriodStart(value, periodicity);
		patch({
			periodicity,
			startPeriod: snap(draft.startPeriod),
			endPeriod: snap(draft.endPeriod),
		});
	};

	const submit = async () => {
		if (!canSubmit) {
			return;
		}
		const payload = {
			name: draft.name.trim(),
			description: draft.description.trim() || null,
			icon: draft.icon,
			color: draft.color,
			categoryId: draft.categoryId,
			issuerPartyId: draft.issuerPartyId,
			subjectPartyId: draft.subjectPartyId,
			tagIds: draft.tagIds,
			sensitiveDefault: draft.sensitiveDefault,
			paperOriginal: draft.paperOriginal,
			titleTemplate: draft.titleTemplate.trim() || null,
			detection: detectionOpen ? draft.detection : null,
			enabled: draft.enabled,
			recurrence:
				draft.recurring && draft.startPeriod
					? {
							periodicity: draft.periodicity,
							startPeriod: draft.startPeriod,
							endPeriod: draft.endPeriod,
							expectedDay: draft.expectedDay.trim()
								? Number(draft.expectedDay)
								: null,
							graceDays: draft.graceDays.trim()
								? Number(draft.graceDays)
								: DEFAULT_GRACE_DAYS,
						}
					: null,
		};
		try {
			const saved = documentType
				? await update.mutateAsync({ id: documentType.id, ...payload })
				: await create.mutateAsync(payload);
			toast.success(
				isEdit
					? "Document type updated."
					: `Document type "${saved.name}" created.`,
			);
			onOpenChange(false);
			onSaved?.(saved);
		} catch (error) {
			toastApiError(error, "The document type could not be saved.");
		}
	};

	const pending = create.isPending || update.isPending;

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent side="right" size="md" className="w-full gap-0">
				<SheetHeader className="shrink-0 border-border border-b px-6 py-5">
					<SheetTitle>
						{isEdit ? "Edit document type" : "New document type"}
					</SheetTitle>
					<SheetDescription>
						A document type is “the same document we keep receiving”: its
						issuer, its filing, its layouts, and optionally the period it comes
						back on.
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
							<div className="flex items-center gap-2">
								<IconPicker
									value={draft.icon}
									onValueChange={(icon) => patch({ icon })}
								/>
								<Input
									id={`${ids}-name`}
									value={draft.name}
									placeholder="EDF electricity bill"
									onChange={(event) => patch({ name: event.target.value })}
								/>
							</div>
						</FormField>

						<FormField label="Colour">
							<ColorPicker
								value={draft.color}
								onValueChange={(color) => patch({ color })}
							/>
						</FormField>

						<FormField label="Description" htmlFor={`${ids}-description`}>
							<Textarea
								id={`${ids}-description`}
								rows={2}
								value={draft.description}
								placeholder="What this type covers, for the household."
								onChange={(event) => patch({ description: event.target.value })}
							/>
						</FormField>
					</FormSection>

					<FormSection
						title="Filing"
						description="Applied to every document carrying this type: category, parties, tags, sensitivity and title."
					>
						<FormField label="Category" htmlFor={`${ids}-category`}>
							<CategoryPicker
								id={`${ids}-category`}
								value={draft.categoryId}
								onValueChange={(categoryId) => patch({ categoryId })}
								placeholder="No category"
							/>
						</FormField>

						<FormField
							label="Issuer"
							htmlFor={`${ids}-issuer`}
							hint="Who sends the document."
						>
							<PartyPicker
								id={`${ids}-issuer`}
								label="Issuer"
								value={draft.issuerPartyId}
								onValueChange={(issuerPartyId) => patch({ issuerPartyId })}
							/>
						</FormField>

						<FormField
							label="Subject"
							htmlFor={`${ids}-subject`}
							hint="Who the document is about, when it differs from the issuer."
						>
							<PartyPicker
								id={`${ids}-subject`}
								label="Subject"
								value={draft.subjectPartyId}
								onValueChange={(subjectPartyId) => patch({ subjectPartyId })}
							/>
						</FormField>

						<FormField label="Tags" htmlFor={`${ids}-tags`}>
							<TagInput
								id={`${ids}-tags`}
								value={draft.tagIds}
								onValueChange={(tagIds) => patch({ tagIds })}
							/>
						</FormField>

						<FormField
							label="Title template"
							htmlFor={`${ids}-title`}
							hint={
								draft.titleTemplate.trim() ? (
									<span className="inline-flex flex-wrap items-center gap-1">
										Example:
										<span className="font-mono">{titleExample(draft)}</span>
									</span>
								) : (
									"Leave empty to keep the title the document arrived with."
								)
							}
						>
							<TitleTemplateInput
								id={`${ids}-title`}
								value={draft.titleTemplate}
								placeholder={DEFAULT_RECURRING_TITLE_TEMPLATE}
								placeholders={TYPE_TITLE_PLACEHOLDERS}
								onValueChange={(titleTemplate) => patch({ titleTemplate })}
							/>
						</FormField>

						<div className="flex items-center justify-between gap-4">
							<div>
								<p className="text-sm">Sensitive by default</p>
								<p className="text-muted-foreground text-xs">
									Raises the flag on every document of this type; never lowers
									it.
								</p>
							</div>
							<Switch
								aria-label="Sensitive by default"
								checked={draft.sensitiveDefault}
								onCheckedChange={(sensitiveDefault) =>
									patch({ sensitiveDefault })
								}
							/>
						</div>

						<div className="flex items-center justify-between gap-4">
							<div>
								<p className="text-sm">Paper original</p>
								<p className="text-muted-foreground text-xs">
									Assign an archive number when this type is applied.
								</p>
							</div>
							<Switch
								aria-label="Paper original"
								checked={draft.paperOriginal}
								onCheckedChange={(paperOriginal) => patch({ paperOriginal })}
							/>
						</div>
					</FormSection>

					<FormSection
						title="Auto-detect"
						description="Same condition tree as the rules. Without it the type is only applied by hand."
					>
						<div className="flex items-center justify-between gap-4">
							<Button
								type="button"
								variant="ghost"
								size="sm"
								aria-expanded={detectionOpen}
								onClick={() => {
									const next = !detectionOpen;
									setDetectionOpen(next);
									if (next && draft.detection === null) {
										patch({ detection: EMPTY_GROUP });
									}
								}}
							>
								{detectionOpen ? <ChevronDownIcon /> : <ChevronRightIcon />}
								{detectionOpen ? "Detection condition" : "Add a condition"}
							</Button>
						</div>
						{detectionOpen ? (
							<ConditionBuilder
								value={asConditionGroup(draft.detection ?? EMPTY_GROUP)}
								onChange={(detection) => patch({ detection })}
							/>
						) : null}
					</FormSection>

					<FormSection
						title="Recurrence"
						description="Turn it on for a document that comes back every period; the missing periods then feed the timeline and the reminders."
					>
						<div className="flex items-center justify-between gap-4">
							<div>
								<p className="text-sm">Recurring document</p>
								<p className="text-muted-foreground text-xs">
									Payslip, rent receipt, subscription invoice…
								</p>
							</div>
							<Switch
								aria-label="Recurring document"
								checked={draft.recurring}
								onCheckedChange={(recurring) =>
									patch({
										recurring,
										// A recurring type names its documents after their
										// period: the default template comes with the switch,
										// and an emptied field stays empty.
										titleTemplate:
											recurring && draft.titleTemplate.trim().length === 0
												? DEFAULT_RECURRING_TITLE_TEMPLATE
												: draft.titleTemplate,
									})
								}
							/>
						</div>

						{draft.recurring ? (
							<>
								<FormField label="Periodicity" htmlFor={`${ids}-periodicity`}>
									<Select
										items={PERIODICITY_ITEMS}
										value={draft.periodicity}
										onValueChange={(value) =>
											setPeriodicity(value as Periodicity)
										}
									>
										<SelectTrigger id={`${ids}-periodicity`} className="w-full">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{PERIODICITIES.map((value) => (
												<SelectItem key={value} value={value}>
													<IconLabel
														icon={PERIODICITY_ICONS[value]}
														label={PERIODICITY_TITLES[value]}
													/>
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</FormField>

								<div className="grid grid-cols-2 gap-3">
									<FormField
										label="First period"
										htmlFor={`${ids}-start`}
										required
										errors={startError ? [startError] : undefined}
										hint={
											<PeriodHint
												value={draft.startPeriod}
												periodicity={draft.periodicity}
											/>
										}
									>
										<PeriodPicker
											id={`${ids}-start`}
											label="First period"
											periodicity={draft.periodicity}
											value={draft.startPeriod}
											onValueChange={(startPeriod) => patch({ startPeriod })}
										/>
									</FormField>
									<FormField
										label="Last period"
										htmlFor={`${ids}-end`}
										hint={
											<PeriodHint
												value={draft.endPeriod}
												periodicity={draft.periodicity}
												fallback="Leave empty for an open recurrence."
											/>
										}
									>
										<PeriodPicker
											id={`${ids}-end`}
											label="Last period"
											periodicity={draft.periodicity}
											value={draft.endPeriod}
											onValueChange={(endPeriod) => patch({ endPeriod })}
										/>
									</FormField>
								</div>

								<div className="grid grid-cols-2 gap-3">
									<FormField
										label="Expected day"
										htmlFor={`${ids}-expected-day`}
										hint={
											draft.periodicity === "weekly"
												? "Day of the week, 1 = Monday."
												: "Day of the last month of the period."
										}
									>
										<Input
											id={`${ids}-expected-day`}
											type="number"
											min={1}
											max={31}
											className="font-mono tabular-nums"
											value={draft.expectedDay}
											placeholder="End of period"
											onChange={(event) =>
												patch({ expectedDay: event.target.value })
											}
										/>
									</FormField>
									<FormField
										label="Grace days"
										htmlFor={`${ids}-grace`}
										hint="Delay tolerated before the period is flagged."
									>
										<Input
											id={`${ids}-grace`}
											type="number"
											min={0}
											max={365}
											className="font-mono tabular-nums"
											value={draft.graceDays}
											onChange={(event) =>
												patch({ graceDays: event.target.value })
											}
										/>
									</FormField>
								</div>
							</>
						) : null}

						<div className="flex items-center justify-between gap-4">
							<div>
								<p className="text-sm">Enabled</p>
								<p className="text-muted-foreground text-xs">
									A disabled type is never detected and produces no reminder.
								</p>
							</div>
							<Switch
								aria-label="Enabled"
								checked={draft.enabled}
								onCheckedChange={(enabled) => patch({ enabled })}
							/>
						</div>
					</FormSection>
				</form>

				<SheetFooter className="shrink-0 flex-row justify-end border-border border-t px-6 py-4">
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button
						type="submit"
						form={`${ids}-form`}
						disabled={!canSubmit || pending}
					>
						{pending ? "Saving…" : isEdit ? "Save" : "Create document type"}
					</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}
