import type { DocumentListItem } from "@docstore/shared/document";
import type {
	DetectDocumentTypeResult,
	DocumentTypeDetail,
	PreviewDocumentTypeResult,
} from "@docstore/shared/document-type";
import { Badge } from "@docstore/ui/components/badge";
import { Button } from "@docstore/ui/components/button";
import { Card, CardContent, CardHeader } from "@docstore/ui/components/card";
import { useMutation, useQuery } from "@tanstack/react-query";
import { FlaskConicalIcon, ScanSearchIcon } from "lucide-react";
import { useState } from "react";
import { formatConfidence } from "@/components/documents/document-labels";
import { EmptyState } from "@/components/empty-state";
import { MonoLabel } from "@/components/mono-label";
import { ConditionBuilder } from "@/components/rules/condition-builder";
import { TestDocumentPicker } from "@/components/rules/test-document-picker";
import { toastApiError } from "@/lib/api-error";
import { orpc } from "@/utils/orpc";

import { LayoutReasonBadge } from "./document-type-badges";

export interface DocumentTypeDetectionProps {
	detail: DocumentTypeDetail;
}

/**
 * "Detection" tab: the read-only condition of the type, a dry run of
 * `documentType.detect` on a chosen document (every candidate type, not only
 * this one) and the `documentType.preview` of what applying it would write.
 */
export function DocumentTypeDetection({ detail }: DocumentTypeDetectionProps) {
	const [document, setDocument] = useState<DocumentListItem | null>(null);

	const detect = useQuery({
		...orpc.documentType.detect.queryOptions({
			input: { documentId: document?.id ?? "" },
		}),
		enabled: Boolean(document),
	});
	const preview = useMutation(orpc.documentType.preview.mutationOptions());
	const [previewResult, setPreviewResult] =
		useState<PreviewDocumentTypeResult | null>(null);

	const runPreview = async () => {
		if (!document) {
			return;
		}
		try {
			setPreviewResult(
				await preview.mutateAsync({ id: detail.id, documentId: document.id }),
			);
		} catch (error) {
			setPreviewResult(null);
			toastApiError(error, "The preview could not be computed.");
		}
	};

	return (
		<div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
			<div className="flex flex-col gap-6 xl:col-span-7">
				<Card>
					<CardHeader className="flex flex-wrap items-center justify-between gap-2">
						<MonoLabel>Detection condition</MonoLabel>
						<Badge tone="outline">
							confidence {formatConfidence(detail.detectionConfidence)}
						</Badge>
					</CardHeader>
					<CardContent>
						{detail.detection ? (
							// Read-only view: editing goes through the "Edit" sheet, which
							// owns the whole draft of the type.
							<div className="pointer-events-none opacity-90">
								<ConditionBuilder
									value={detail.detection}
									onChange={() => undefined}
								/>
							</div>
						) : (
							<EmptyState
								size="sm"
								icon={ScanSearchIcon}
								title="No detection condition"
								description="This type is only applied by hand, in bulk or by a rule action."
							/>
						)}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<MonoLabel>Dry run</MonoLabel>
					</CardHeader>
					<CardContent className="flex flex-col gap-3">
						<TestDocumentPicker
							label="Document to analyse"
							value={document}
							onValueChange={(next) => {
								setDocument(next);
								setPreviewResult(null);
							}}
						/>
						{document ? (
							<DetectResults result={detect.data} typeId={detail.id} />
						) : (
							<p className="text-muted-foreground text-xs">
								Pick a document to see which types would claim it.
							</p>
						)}
					</CardContent>
				</Card>
			</div>

			<div className="flex flex-col gap-6 xl:col-span-5">
				<Card>
					<CardHeader className="flex flex-wrap items-center justify-between gap-2">
						<MonoLabel>Preview</MonoLabel>
						<Button
							size="sm"
							variant="outline"
							disabled={!document || preview.isPending}
							onClick={runPreview}
						>
							<FlaskConicalIcon />
							Preview
						</Button>
					</CardHeader>
					<CardContent className="flex flex-col gap-2 text-sm">
						{previewResult ? (
							<PreviewBody result={previewResult} />
						) : (
							<p className="text-muted-foreground text-xs">
								What applying this type to the document would write, without
								writing a single row.
							</p>
						)}
					</CardContent>
				</Card>
			</div>
		</div>
	);
}

function DetectResults({
	result,
	typeId,
}: {
	result: DetectDocumentTypeResult | undefined;
	typeId: string;
}) {
	const candidates = result?.candidates ?? [];
	if (candidates.length === 0) {
		return (
			<p className="text-muted-foreground text-xs">
				No document type matches this document.
			</p>
		);
	}
	return (
		<ul className="divide-y divide-border rounded-lg ring-1 ring-border">
			{candidates.map((candidate) => (
				<li
					key={candidate.documentTypeId}
					className="row-in flex flex-wrap items-center gap-2 px-3 py-2"
				>
					<span className="min-w-0 flex-1 truncate font-medium text-sm">
						{candidate.name}
					</span>
					{candidate.documentTypeId === typeId ? (
						<Badge tone="primary">This type</Badge>
					) : null}
					<LayoutReasonBadge reason={candidate.layoutReason} />
					<Badge tone="outline">{formatConfidence(candidate.confidence)}</Badge>
				</li>
			))}
		</ul>
	);
}

function PreviewBody({ result }: { result: PreviewDocumentTypeResult }) {
	return (
		<>
			<PreviewRow label="Title" value={result.title ?? "Left as it is"} />
			<PreviewRow
				label="Category"
				value={result.category?.name ?? "Unchanged"}
			/>
			<PreviewRow
				label="Parties"
				value={
					result.parties.length === 0
						? "Unchanged"
						: result.parties
								.map((party) => `${party.name} (${party.role})`)
								.join(", ")
				}
			/>
			<PreviewRow
				label="Tags"
				value={
					result.tags.length === 0
						? "None"
						: result.tags.map((tag) => tag.name).join(", ")
				}
			/>
			<PreviewRow
				label="Sensitive"
				value={
					result.sensitive === null
						? "Untouched"
						: result.sensitive
							? "Yes"
							: "No"
				}
			/>
			<PreviewRow label="Period" value={result.period ?? "—"} />
			<div className="flex items-center justify-between gap-3">
				<span className="text-muted-foreground text-xs">Layout</span>
				{result.layout ? (
					<span className="flex items-center gap-1.5">
						<span className="font-mono text-xs">{result.layout.name}</span>
						<LayoutReasonBadge reason={result.layout.reason} />
					</span>
				) : (
					<span className="font-mono text-xs">No layout</span>
				)}
			</div>

			{result.extractions.length > 0 ? (
				<ul className="mt-2 divide-y divide-border rounded-lg ring-1 ring-border">
					{result.extractions.map((item) => (
						<li
							key={item.extractionRuleId}
							className="flex items-center gap-3 px-3 py-2"
						>
							<span className="min-w-0 flex-1 truncate text-xs">
								{item.extractionRuleName}
							</span>
							<span className="truncate font-mono text-muted-foreground text-xs">
								{item.raw === null ? "No value" : String(item.value)}
							</span>
							<Badge tone={item.raw === null ? "danger" : "success"}>
								{formatConfidence(item.confidence)}
							</Badge>
						</li>
					))}
				</ul>
			) : null}
		</>
	);
}

function PreviewRow({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex items-center justify-between gap-3">
			<span className="text-muted-foreground text-xs">{label}</span>
			<span className="min-w-0 truncate text-right font-mono text-xs">
				{value}
			</span>
		</div>
	);
}
