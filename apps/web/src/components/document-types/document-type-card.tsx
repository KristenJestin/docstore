import type { DocumentDetail } from "@docstore/shared/document";
import { Badge } from "@docstore/ui/components/badge";
import { Button } from "@docstore/ui/components/button";
import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	ArrowRightIcon,
	MinusIcon,
	PlusIcon,
	RotateCcwIcon,
	SparklesIcon,
} from "lucide-react";
import { useId } from "react";
import { toast } from "sonner";

import { AssignmentSourceBadge } from "@/components/documents/document-badges";
import { FormField } from "@/components/form-field";
import { useForceRetry } from "@/hooks/use-force-retry";
import { toastApiError } from "@/lib/api-error";
import { orpc } from "@/utils/orpc";

import { DocumentTypeMark, MembershipBadge } from "./document-type-badges";
import { DocumentTypePicker } from "./document-type-picker";

export interface DocumentTypeCardProps {
	document: DocumentDetail;
}

/**
 * "Type" card of the document page and of the review sheet: the type carried by
 * the document with its source, layout, period and membership, the
 * `DocumentTypePicker` (quick creation and "Create type from this document"
 * included) and the recurrence overrides.
 */
export function DocumentTypeCard({ document }: DocumentTypeCardProps) {
	const ids = useId();
	const forceRetry = useForceRetry();

	const apply = useMutation(orpc.documentType.apply.mutationOptions());
	const bulk = useMutation(orpc.document.bulk.mutationOptions());
	const setOverride = useMutation(
		orpc.documentType.setDocumentOverride.mutationOptions(),
	);

	const current = document.documentType;

	const onPick = async (documentTypeId: string | null) => {
		if (documentTypeId === (current?.id ?? null)) {
			return;
		}
		try {
			if (documentTypeId === null) {
				await bulk.mutateAsync({
					ids: [document.id],
					action: { type: "setDocumentType", documentTypeId: null },
				});
				toast.success("Document type removed.");
			} else {
				// A disabled type is refused unless the caller insists.
				const result = await forceRetry("type", (force) =>
					apply.mutateAsync({
						documentTypeId,
						documentIds: [document.id],
						force,
					}),
				);
				if (result === null) {
					return;
				}
				const first = result.results[0];
				toast.success(
					first && first.fieldsWritten > 0
						? `Document type applied, ${first.fieldsWritten} values extracted.`
						: "Document type applied.",
				);
			}
		} catch (error) {
			toastApiError(error, "The document type could not be applied.");
		}
	};

	const onReapply = async () => {
		if (!current) {
			return;
		}
		try {
			const result = await forceRetry("type", (force) =>
				apply.mutateAsync({
					documentTypeId: current.id,
					documentIds: [document.id],
					force,
				}),
			);
			if (result === null) {
				return;
			}
			toast.success("Document type re-applied.");
		} catch (error) {
			toastApiError(error, "The document type could not be applied.");
		}
	};

	const onOverride = async (included: boolean | null) => {
		if (!current) {
			return;
		}
		try {
			await setOverride.mutateAsync({
				documentTypeId: current.id,
				documentId: document.id,
				included,
			});
			toast.success(
				included === null
					? "Membership handed back to the computation."
					: included
						? "Document forced into the recurrence."
						: "Document excluded from the recurrence.",
			);
		} catch (error) {
			toastApiError(error, "The membership could not be changed.");
		}
	};

	const busy = apply.isPending || bulk.isPending || setOverride.isPending;

	return (
		<div className="flex flex-col gap-3">
			{current ? (
				<div className="flex flex-col gap-2 rounded-lg bg-muted/50 px-3 py-2.5 ring-1 ring-border">
					<div className="flex min-w-0 items-center gap-2">
						<DocumentTypeMark
							icon={current.icon}
							color={current.color}
							size="sm"
						/>
						<Link
							to="/types/$typeId"
							params={{ typeId: current.id }}
							search={{}}
							className="min-w-0 flex-1 truncate font-semibold text-sm hover:underline"
						>
							{current.name}
						</Link>
						<AssignmentSourceBadge
							source={current.source}
							confidence={current.confidence}
						/>
					</div>

					<div className="flex flex-wrap items-center gap-1.5">
						{current.layout ? (
							<Badge tone="info">{current.layout.name}</Badge>
						) : (
							<Badge tone="neutral">No layout</Badge>
						)}
						{current.period ? (
							<Badge tone="outline">{current.period}</Badge>
						) : null}
						<MembershipBadge membership={current.membership} />
					</div>

					<div className="flex flex-wrap items-center gap-1">
						<Button
							variant="ghost"
							size="sm"
							disabled={busy}
							onClick={onReapply}
						>
							<SparklesIcon />
							Re-apply
						</Button>
						{current.membership === "forced" ? null : (
							<Button
								variant="ghost"
								size="sm"
								disabled={busy}
								onClick={() => onOverride(true)}
							>
								<PlusIcon />
								Force in
							</Button>
						)}
						{current.membership === "excluded" ? null : (
							<Button
								variant="ghost"
								size="sm"
								disabled={busy}
								onClick={() => onOverride(false)}
							>
								<MinusIcon />
								Exclude
							</Button>
						)}
						{current.membership === "computed" ? null : (
							<Button
								variant="ghost"
								size="sm"
								disabled={busy}
								onClick={() => onOverride(null)}
							>
								<RotateCcwIcon />
								Reset
							</Button>
						)}
					</div>
				</div>
			) : null}

			<FormField
				label="Document type"
				htmlFor={`${ids}-picker`}
				hint="Applying a type files the document: category, parties, tags, title and the extraction of its layout."
			>
				<DocumentTypePicker
					id={`${ids}-picker`}
					value={current?.id ?? null}
					onValueChange={onPick}
					fromDocumentId={document.id}
					disabled={busy}
				/>
			</FormField>
		</div>
	);
}

export interface CreateTypeFromReasonButtonProps {
	documentId: string;
	/** `meta` of the `recurringCandidate` review reason. */
	meta: Record<string, unknown>;
}

/**
 * "Create document type" of a `recurringCandidate` reason: the meta of the
 * reason carries exactly what `documentType.createFromSuggestion` expects.
 */
export function CreateTypeFromReasonButton({
	meta,
}: CreateTypeFromReasonButtonProps) {
	const create = useMutation(
		orpc.documentType.createFromSuggestion.mutationOptions(),
	);

	const partyId = typeof meta.partyId === "string" ? meta.partyId : null;
	const categoryId =
		typeof meta.categoryId === "string" ? meta.categoryId : null;
	const periodicity = meta.periodicity;
	const startPeriod =
		typeof meta.startPeriod === "string" ? meta.startPeriod : null;
	const endPeriod = typeof meta.endPeriod === "string" ? meta.endPeriod : null;

	const usable =
		partyId !== null &&
		categoryId !== null &&
		startPeriod !== null &&
		(periodicity === "weekly" ||
			periodicity === "monthly" ||
			periodicity === "quarterly" ||
			periodicity === "semiannual" ||
			periodicity === "yearly");

	if (!usable) {
		return null;
	}

	const onCreate = async () => {
		try {
			const created = await create.mutateAsync({
				partyId,
				categoryId,
				periodicity,
				startPeriod,
				endPeriod,
			});
			toast.success(`Document type "${created.name}" created.`);
		} catch (error) {
			toastApiError(error, "The document type could not be created.");
		}
	};

	return (
		<Button
			size="sm"
			variant="outline"
			disabled={create.isPending}
			onClick={onCreate}
		>
			<PlusIcon />
			Create document type
		</Button>
	);
}

export interface ApplyTypeFromReasonButtonProps {
	documentId: string;
	/** `meta` of the `typeCandidate` review reason. */
	meta: Record<string, unknown>;
}

/** "Apply" of a `typeCandidate` reason: applies the detected type as it is. */
export function ApplyTypeFromReasonButton({
	documentId,
	meta,
}: ApplyTypeFromReasonButtonProps) {
	const forceRetry = useForceRetry();
	const apply = useMutation(orpc.documentType.apply.mutationOptions());

	const documentTypeId =
		typeof meta.documentTypeId === "string" ? meta.documentTypeId : null;
	const layoutId = typeof meta.layoutId === "string" ? meta.layoutId : null;

	if (documentTypeId === null) {
		return null;
	}

	const onApply = async () => {
		try {
			const result = await forceRetry("type", (force) =>
				apply.mutateAsync({
					documentTypeId,
					documentIds: [documentId],
					layoutId,
					force,
				}),
			);
			if (result === null) {
				return;
			}
			toast.success("Document type applied.");
		} catch (error) {
			toastApiError(error, "The document type could not be applied.");
		}
	};

	return (
		<Button size="sm" disabled={apply.isPending} onClick={onApply}>
			<ArrowRightIcon />
			Apply
		</Button>
	);
}
