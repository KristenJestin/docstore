import type {
	CustomField,
	CustomFieldValue,
} from "@docstore/shared/custom-field";
import { customFieldCategoryIssue } from "@docstore/shared/custom-field";
import type {
	DatePrecision,
	DocumentDetail,
	ReviewReason,
	UpdateDocumentInput,
} from "@docstore/shared/document";
import { Badge } from "@docstore/ui/components/badge";
import { Button } from "@docstore/ui/components/button";
import { Card, CardContent, CardHeader } from "@docstore/ui/components/card";
import { Input } from "@docstore/ui/components/input";
import { Switch } from "@docstore/ui/components/switch";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@docstore/ui/components/tooltip";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	ArrowRightIcon,
	CircleHelpIcon,
	DownloadIcon,
	ExternalLinkIcon,
	HashIcon,
	LayoutTemplateIcon,
	RefreshCwIcon,
} from "lucide-react";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";

import { useConfirm } from "@/components/confirm-dialog";
import { DatePicker, DatePrecisionPicker } from "@/components/date-picker";
import {
	ApplyTypeFromReasonButton,
	CreateTypeFromReasonButton,
	DocumentTypeCard,
} from "@/components/document-types/document-type-card";
import { DocumentNotesCard } from "@/components/documents/document-notes-card";
import { DocumentDossiersCard } from "@/components/dossiers/document-dossiers-card";
import {
	shareRevocationWarning,
	useActiveShareLinks,
} from "@/components/share/sensitive-links";
import { useDocumentErrorToast } from "@/hooks/use-document-error-toast";
import { fileDownloadUrl } from "@/lib/file-urls";
import { countLabel } from "@/lib/plural";
import { orpc } from "@/utils/orpc";
import { FormField } from "../form-field";
import { MonoLabel } from "../mono-label";
import { CategoryPicker, useCategoryLineage } from "./category-picker";
import {
	AssignmentSourceBadge,
	DateSourceBadge,
	DocumentStatusBadge,
} from "./document-badges";
import {
	approvalBlockedReason,
	DOCUMENT_FILE_KIND_LABELS,
	FAILED_STATUS_HINT,
	formatFileSize,
	REVIEW_REASON_HINTS,
	REVIEW_REASON_ICONS,
	REVIEW_REASON_LABELS,
} from "./document-labels";
import { DocumentRelationsCard } from "./document-relations-card";
import { FieldExtractButton } from "./field-extract-button";
import { FieldValueEditor } from "./field-value-editor";
import { PartyRoleList } from "./party-role-list";
import { TagInput } from "./tag-input";

interface DateDraft {
	documentDate: string | null;
	datePrecision: DatePrecision;
	periodStart: string | null;
	periodEnd: string | null;
	receivedAt: string | null;
	validFrom: string | null;
	validUntil: string | null;
}

function toDraft(document: DocumentDetail): DateDraft {
	return {
		documentDate: document.documentDate,
		datePrecision: document.datePrecision ?? "day",
		periodStart: document.periodStart,
		periodEnd: document.periodEnd,
		receivedAt: document.receivedAt,
		validFrom: document.validFrom,
		validUntil: document.validUntil,
	};
}

/**
 * Same rules as `assertConsistentDates` on the API side, worded in English so
 * they can be shown under the matching fields.
 */
export function validateDateDraft(
	draft: DateDraft,
): Partial<Record<"documentDate" | "period" | "validity", string>> {
	const errors: Partial<
		Record<"documentDate" | "period" | "validity", string>
	> = {};
	if (draft.documentDate && !draft.datePrecision) {
		errors.documentDate = "A precision is required as soon as a date is set.";
	}
	if (
		draft.periodStart &&
		draft.periodEnd &&
		draft.periodEnd < draft.periodStart
	) {
		errors.period = "The period end must be on or after the period start.";
	}
	if (
		draft.validFrom &&
		draft.validUntil &&
		draft.validUntil < draft.validFrom
	) {
		errors.validity =
			"The validity end must be on or after the validity start.";
	}
	return errors;
}

/** Why a custom field is not offered here, word for word. */
const NOT_APPLICABLE_TOOLTIP = "Not applicable to this category";

/** Question mark carrying {@link NOT_APPLICABLE_TOOLTIP}. */
function NotApplicableHint() {
	return (
		<Tooltip>
			<TooltipTrigger
				className="cursor-default rounded-full focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
				render={<span />}
			>
				<CircleHelpIcon
					aria-label={NOT_APPLICABLE_TOOLTIP}
					className="size-3.5 text-muted-foreground"
				/>
			</TooltipTrigger>
			<TooltipContent>{NOT_APPLICABLE_TOOLTIP}</TooltipContent>
		</Tooltip>
	);
}

export interface DocumentMetaPanelProps {
	document: DocumentDetail;
	/** Review sheet: the notes are shown but not editable from there. */
	readOnlyNotes?: boolean;
}

/**
 * Metadata column of the document page: processing status, dates, parties,
 * filing, custom fields, physical archiving and files. Every control saves
 * immediately through the `document` router.
 */
export function DocumentMetaPanel({
	document,
	readOnlyNotes = false,
}: DocumentMetaPanelProps) {
	const confirm = useConfirm();
	const activeShareLinks = useActiveShareLinks();
	const documentError = useDocumentErrorToast();
	const ids = useId();

	const update = useMutation(orpc.document.update.mutationOptions());
	const setCategory = useMutation(orpc.document.setCategory.mutationOptions());
	const setTags = useMutation(orpc.document.setTags.mutationOptions());
	const setFieldValue = useMutation(
		orpc.document.setFieldValue.mutationOptions(),
	);
	const clearFieldValue = useMutation(
		orpc.document.clearFieldValue.mutationOptions(),
	);
	const reprocess = useMutation(orpc.document.reprocess.mutationOptions());
	const approve = useMutation(orpc.review.approve.mutationOptions());
	const assignAsn = useMutation(orpc.document.assignAsn.mutationOptions());

	const customFields = useQuery(
		orpc.customField.list.queryOptions({ input: {} }),
	);
	const categoryLineage = useCategoryLineage(document.categoryId);

	const [dates, setDates] = useState<DateDraft>(() => toDraft(document));
	const [asn, setAsn] = useState(document.asn ? String(document.asn) : "");
	const [location, setLocation] = useState(document.physicalLocation ?? "");

	useEffect(() => {
		setDates(toDraft(document));
		setAsn(document.asn ? String(document.asn) : "");
		setLocation(document.physicalLocation ?? "");
	}, [document]);

	const errors = validateDateDraft(dates);
	const approvalBlocked = approvalBlockedReason(document.status);

	const applyPatch = async (patch: UpdateDocumentInput, message?: string) => {
		try {
			await update.mutateAsync({ id: document.id, ...patch });
			if (message) {
				toast.success(message);
			}
		} catch (error) {
			documentError(error, "The change could not be saved.", document.id);
		}
	};

	/** Updates the local draft and only sends the patch when it is valid. */
	const patchDates = (next: Partial<DateDraft>) => {
		const draft = { ...dates, ...next };
		setDates(draft);
		if (Object.keys(validateDateDraft(draft)).length > 0) {
			return;
		}
		void applyPatch(next as UpdateDocumentInput);
	};

	const onToggleSensitive = async (checked: boolean) => {
		// Raising the flag closes the public windows on the document and on the
		// dossiers holding it: count them before asking.
		const dossierIds = new Set(document.dossiers.map((dossier) => dossier.id));
		const revoked = checked
			? await activeShareLinks(
					(link) =>
						link.documentId === document.id ||
						(link.dossierId !== null && dossierIds.has(link.dossierId)),
				)
			: [];
		const warning = shareRevocationWarning(revoked.length);
		const ok = await confirm({
			title: checked
				? "Mark this document as sensitive?"
				: "Remove the sensitive flag?",
			description: checked ? (
				<>
					It will be encrypted at rest and hidden from MCP answers.
					{warning ? <span className="mt-2 block">{warning}</span> : null}
				</>
			) : (
				"The document will become visible to external agents again."
			),
			confirmLabel: checked ? "Mark sensitive" : "Remove",
			destructive: !checked,
		});
		if (ok) {
			await applyPatch(
				{ sensitive: checked },
				checked ? "Document marked sensitive." : "Sensitive flag removed.",
			);
		}
	};

	const onApprove = async () => {
		try {
			await approve.mutateAsync({ id: document.id });
			toast.success("Document approved.");
		} catch (error) {
			documentError(error, "The document could not be approved.", document.id);
		}
	};

	const onReprocess = async () => {
		try {
			await reprocess.mutateAsync({ id: document.id });
			toast.success("Processing restarted.");
		} catch (error) {
			documentError(error, "Processing could not be restarted.", document.id);
		}
	};

	const onAssignAsn = async () => {
		try {
			const updated = await assignAsn.mutateAsync({ id: document.id });
			toast.success(`Archive serial number ${updated.asn} assigned.`);
		} catch (error) {
			documentError(
				error,
				"No archive serial number could be assigned.",
				document.id,
			);
		}
	};

	const valueByFieldId = new Map(
		document.fieldValues.map((value) => [value.fieldId, value]),
	);

	/**
	 * Only the fields the category of the document offers are editable — the
	 * same rule the API enforces (`customFieldCategoryIssue`), ancestors
	 * included. A field that does not apply but already holds a value is still
	 * shown, read-only, so the data never disappears silently; the rest is
	 * summed up under the card.
	 */
	const fields = customFields.data ?? [];
	const applies = (field: CustomField) =>
		customFieldCategoryIssue(field, categoryLineage) === null;
	const applicableFields = fields.filter(applies);
	const strandedFields = fields.filter(
		(field) => !applies(field) && valueByFieldId.has(field.id),
	);
	const hiddenFields = fields.filter(
		(field) => !applies(field) && !valueByFieldId.has(field.id),
	);

	return (
		<div className="flex flex-col gap-5">
			<Card>
				<CardHeader>
					<MonoLabel>Status</MonoLabel>
				</CardHeader>
				<CardContent className="flex flex-col gap-3">
					<div className="flex flex-wrap items-center gap-2">
						<DocumentStatusBadge status={document.status} />
						{document.sensitive ? (
							<Badge tone="sensitive">Sensitive</Badge>
						) : null}
						<Button
							variant="ghost"
							size="sm"
							className="ml-auto"
							onClick={onReprocess}
						>
							<RefreshCwIcon />
							Reprocess
						</Button>
					</div>

					{document.processingError || document.status === "failed" ? (
						<div className="rounded-lg bg-tone-danger px-3 py-2 text-tone-danger-foreground text-xs">
							<p className="font-semibold">
								{document.status === "failed"
									? "Processing failed"
									: "Processing error"}
							</p>
							<p className="mt-1 break-words">
								{document.processingError ?? FAILED_STATUS_HINT}
							</p>
							<Button
								variant="outline"
								size="sm"
								className="mt-2"
								onClick={onReprocess}
							>
								<RefreshCwIcon />
								Reprocess
							</Button>
						</div>
					) : null}

					{document.reviewReasons.length > 0 ? (
						<div className="flex flex-col gap-2">
							<ul className="flex flex-col gap-1.5">
								{document.reviewReasons.map((reason) => {
									const ReasonIcon = REVIEW_REASON_ICONS[reason.code];
									return (
										<li
											key={`${reason.code}:${reason.field ?? ""}`}
											className="row-in flex flex-wrap items-start gap-2 text-xs"
										>
											<Badge tone="warning">
												<ReasonIcon aria-hidden />
												{REVIEW_REASON_LABELS[reason.code]}
											</Badge>
											<span className="min-w-0 flex-1 text-muted-foreground">
												{reason.message}
												{REVIEW_REASON_HINTS[reason.code] ? (
													<span className="block">
														{REVIEW_REASON_HINTS[reason.code]}
													</span>
												) : null}
											</span>
											<ReviewReasonAction
												documentId={document.id}
												reason={reason}
											/>
										</li>
									);
								})}
							</ul>
							{/* The API refuses to approve a document the pipeline has
							    not finished with (`CONFLICT`): say so instead. */}
							{approvalBlocked ? (
								<p className="text-muted-foreground text-xs">
									{approvalBlocked}
								</p>
							) : null}
							<Button
								size="sm"
								className="self-start"
								disabled={approvalBlocked !== null || approve.isPending}
								onClick={onApprove}
							>
								Approve
							</Button>
						</div>
					) : null}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<MonoLabel>Type</MonoLabel>
				</CardHeader>
				<CardContent>
					<DocumentTypeCard document={document} />
				</CardContent>
			</Card>

			<DocumentNotesCard
				notes={document.notes}
				readOnly={readOnlyNotes}
				onSave={(notes) => applyPatch({ notes }, "Notes saved.")}
			/>

			<Card>
				<CardHeader>
					<MonoLabel>Dates</MonoLabel>
				</CardHeader>
				<CardContent className="flex flex-col gap-4">
					<FormField
						label={
							<span className="flex items-center gap-2">
								Document date
								<DateSourceBadge
									source={document.dateSource}
									confidence={document.dateConfidence}
								/>
							</span>
						}
						htmlFor={`${ids}-date`}
						errors={errors.documentDate ? [errors.documentDate] : undefined}
					>
						<DatePrecisionPicker
							id={`${ids}-date`}
							value={dates.documentDate}
							precision={dates.datePrecision}
							onChange={(value, precision) =>
								patchDates({ documentDate: value, datePrecision: precision })
							}
						/>
					</FormField>

					<FormField
						label="Covered period"
						errors={errors.period ? [errors.period] : undefined}
						hint="Recurring documents: payslip, subscription invoice…"
					>
						<DateRangeFields
							fromLabel="Period start"
							toLabel="Period end"
							from={dates.periodStart}
							to={dates.periodEnd}
							onFromChange={(periodStart) => patchDates({ periodStart })}
							onToChange={(periodEnd) => patchDates({ periodEnd })}
						/>
					</FormField>

					<FormField label="Received on" htmlFor={`${ids}-received`}>
						<DatePicker
							id={`${ids}-received`}
							label="Received on"
							value={dates.receivedAt}
							onValueChange={(receivedAt) => patchDates({ receivedAt })}
						/>
					</FormField>

					<FormField
						label="Validity"
						errors={errors.validity ? [errors.validity] : undefined}
					>
						<DateRangeFields
							fromLabel="Valid from"
							toLabel="Valid until"
							from={dates.validFrom}
							to={dates.validUntil}
							onFromChange={(validFrom) => patchDates({ validFrom })}
							onToChange={(validUntil) => patchDates({ validUntil })}
						/>
					</FormField>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<MonoLabel>Parties</MonoLabel>
				</CardHeader>
				<CardContent>
					<PartyRoleList documentId={document.id} parties={document.parties} />
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<MonoLabel>Filing</MonoLabel>
				</CardHeader>
				<CardContent className="flex flex-col gap-4">
					<FormField label="Category" htmlFor={`${ids}-category`}>
						<CategoryPicker
							id={`${ids}-category`}
							value={document.categoryId}
							onValueChange={async (categoryId) => {
								try {
									await setCategory.mutateAsync({
										id: document.id,
										categoryId,
									});
								} catch (error) {
									documentError(
										error,
										"The category could not be applied.",
										document.id,
									);
								}
							}}
						/>
					</FormField>

					<FormField label="Tags" htmlFor={`${ids}-tags`}>
						<TagInput
							id={`${ids}-tags`}
							value={document.tags.map((tag) => tag.id)}
							onValueChange={async (tagIds) => {
								try {
									await setTags.mutateAsync({ id: document.id, tagIds });
								} catch (error) {
									documentError(
										error,
										"The tags could not be updated.",
										document.id,
									);
								}
							}}
						/>
					</FormField>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<MonoLabel>Dossiers</MonoLabel>
				</CardHeader>
				<CardContent>
					<DocumentDossiersCard
						documentId={document.id}
						dossiers={document.dossiers}
					/>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<MonoLabel>Related documents</MonoLabel>
				</CardHeader>
				<CardContent>
					<DocumentRelationsCard
						documentId={document.id}
						relations={document.relations}
					/>
				</CardContent>
			</Card>

			{applicableFields.length + strandedFields.length + hiddenFields.length >
			0 ? (
				<Card>
					<CardHeader>
						<MonoLabel>Custom fields</MonoLabel>
					</CardHeader>
					<CardContent className="flex flex-col gap-4">
						{applicableFields.map((field) => {
							const current = valueByFieldId.get(field.id) ?? null;
							return (
								<FormField
									key={field.id}
									label={
										<span className="flex items-center gap-2">
											{field.name}
											{current ? (
												<AssignmentSourceBadge
													source={current.source}
													confidence={current.confidence}
													confirmedAt={current.confirmedAt}
												/>
											) : null}
											<FieldExtractButton document={document} field={field} />
										</span>
									}
									htmlFor={`${ids}-field-${field.id}`}
								>
									<FieldValueEditor
										id={`${ids}-field-${field.id}`}
										field={field}
										value={current?.value ?? null}
										onCommit={async (value: CustomFieldValue | null) => {
											try {
												if (value === null) {
													await clearFieldValue.mutateAsync({
														id: document.id,
														fieldId: field.id,
													});
												} else {
													await setFieldValue.mutateAsync({
														id: document.id,
														fieldId: field.id,
														value,
													});
												}
											} catch (error) {
												documentError(
													error,
													"The value could not be saved.",
													document.id,
												);
											}
										}}
									/>
								</FormField>
							);
						})}

						{/* Values left behind by a category change: read-only, never lost. */}
						{strandedFields.map((field) => {
							const current = valueByFieldId.get(field.id) ?? null;
							return (
								<FormField
									key={field.id}
									label={
										<span className="flex items-center gap-2">
											{field.name}
											<NotApplicableHint />
										</span>
									}
									htmlFor={`${ids}-field-${field.id}`}
								>
									<FieldValueEditor
										id={`${ids}-field-${field.id}`}
										field={field}
										value={current?.value ?? null}
										disabled
										onCommit={() => undefined}
									/>
								</FormField>
							);
						})}

						{hiddenFields.length > 0 ? (
							<Tooltip>
								<TooltipTrigger
									render={<p />}
									className="cursor-default text-left text-muted-foreground text-xs"
								>
									{countLabel(hiddenFields.length, "field")} not shown:{" "}
									{hiddenFields.map((field) => field.name).join(", ")}.
								</TooltipTrigger>
								<TooltipContent>{NOT_APPLICABLE_TOOLTIP}</TooltipContent>
							</Tooltip>
						) : null}
					</CardContent>
				</Card>
			) : null}

			<Card>
				<CardHeader>
					<MonoLabel>Archiving</MonoLabel>
				</CardHeader>
				<CardContent className="flex flex-col gap-4">
					<div className="flex items-center justify-between gap-4">
						<div>
							<p className="font-medium text-sm">Sensitive document</p>
							<p className="text-muted-foreground text-xs">
								Encrypted at rest and hidden from MCP.
							</p>
						</div>
						<Switch
							aria-label="Sensitive document"
							checked={document.sensitive}
							onCheckedChange={onToggleSensitive}
						/>
					</div>

					<FormField
						label={
							<span className="flex items-center gap-2">
								ASN
								{document.asn !== null && document.asnSource === "auto" ? (
									<Badge
										tone="success"
										title="Number handed out by the automatic numbering"
									>
										auto
									</Badge>
								) : null}
							</span>
						}
						htmlFor={`${ids}-asn`}
						hint="Physical archive number, unique. “Assign next” takes the first free one."
					>
						<div className="flex items-center gap-2">
							<Input
								id={`${ids}-asn`}
								type="number"
								min={1}
								className="font-mono tabular-nums"
								value={asn}
								onChange={(event) => setAsn(event.target.value)}
								onBlur={() => {
									const next = asn.trim() ? Number(asn) : null;
									if (next !== document.asn) {
										void applyPatch({ asn: next });
									}
								}}
							/>
							<Button
								variant="outline"
								size="sm"
								disabled={document.asn !== null || assignAsn.isPending}
								onClick={onAssignAsn}
							>
								<HashIcon />
								Assign next
							</Button>
						</div>
					</FormField>

					<FormField label="Physical location" htmlFor={`${ids}-location`}>
						<Input
							id={`${ids}-location`}
							value={location}
							placeholder='Blue "Payroll" binder — 2025 divider'
							onChange={(event) => setLocation(event.target.value)}
							onBlur={() => {
								const next = location.trim() || null;
								if (next !== document.physicalLocation) {
									void applyPatch({ physicalLocation: next });
								}
							}}
						/>
					</FormField>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<MonoLabel>Files</MonoLabel>
				</CardHeader>
				<CardContent>
					<ul className="flex flex-col gap-2">
						{document.files.map((file) => (
							<li
								key={file.id}
								className="row-in flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-muted/50 px-3 py-2.5 ring-1 ring-border"
							>
								<div className="min-w-0 flex-1">
									<p className="truncate font-mono text-sm">{file.filename}</p>
									<p className="flex flex-wrap items-center gap-1.5 text-muted-foreground text-xs">
										<Badge tone="outline">
											{DOCUMENT_FILE_KIND_LABELS[file.kind]}
										</Badge>
										{file.pageCount
											? `${countLabel(file.pageCount, "page")} ·`
											: null}
										<span className="font-mono tabular-nums">
											{formatFileSize(file.size)}
										</span>
									</p>
								</div>
								<div className="flex shrink-0 items-center gap-1">
									<Button
										variant="outline"
										size="sm"
										nativeButton={false}
										render={
											<a
												href={fileDownloadUrl(file.id, { inline: true })}
												target="_blank"
												rel="noreferrer"
											/>
										}
									>
										<ExternalLinkIcon />
										Open
									</Button>
									<Button
										variant="ghost"
										size="sm"
										nativeButton={false}
										render={
											<a
												href={fileDownloadUrl(file.id)}
												download={file.filename}
											/>
										}
									>
										<DownloadIcon />
										Download
									</Button>
								</div>
							</li>
						))}
					</ul>
				</CardContent>
			</Card>
		</div>
	);
}

/**
 * Action offered next to a review reason, when the reason carries enough in its
 * `meta` to resolve it in one click (SPEC §9).
 */
function ReviewReasonAction({
	documentId,
	reason,
}: {
	documentId: string;
	reason: ReviewReason;
}) {
	const meta = reason.meta ?? {};

	if (reason.code === "recurringCandidate") {
		return <CreateTypeFromReasonButton documentId={documentId} meta={meta} />;
	}
	if (reason.code === "typeCandidate") {
		return <ApplyTypeFromReasonButton documentId={documentId} meta={meta} />;
	}
	if (reason.code === "unknownLayout") {
		const documentTypeId =
			typeof meta.documentTypeId === "string" ? meta.documentTypeId : null;
		if (!documentTypeId) {
			return null;
		}
		return (
			<Button
				variant="outline"
				size="sm"
				nativeButton={false}
				render={
					<Link
						to="/types/$typeId"
						params={{ typeId: documentTypeId }}
						search={{ tab: "layouts" }}
					/>
				}
			>
				<LayoutTemplateIcon />
				Create layout from this document
			</Button>
		);
	}
	return null;
}

/** Two `DatePicker`s joined by an arrow: covered period, validity. */
function DateRangeFields({
	fromLabel,
	toLabel,
	from,
	to,
	onFromChange,
	onToChange,
}: {
	fromLabel: string;
	toLabel: string;
	from: string | null;
	to: string | null;
	onFromChange: (value: string | null) => void;
	onToChange: (value: string | null) => void;
}) {
	return (
		<div className="flex items-center gap-2">
			<DatePicker
				label={fromLabel}
				value={from}
				onValueChange={onFromChange}
				className="min-w-0 flex-1"
			/>
			<ArrowRightIcon
				aria-hidden
				className="size-4 shrink-0 text-muted-foreground"
			/>
			<DatePicker
				label={toLabel}
				value={to}
				onValueChange={onToChange}
				className="min-w-0 flex-1"
			/>
		</div>
	);
}
