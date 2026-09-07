import type { DocumentListItem } from "@docstore/shared/document";
import type {
	DocumentTypeDetail,
	DocumentTypeLayoutDto,
	TestDocumentTypeLayoutResult,
} from "@docstore/shared/document-type";
import { Badge } from "@docstore/ui/components/badge";
import { Button } from "@docstore/ui/components/button";
import { Card, CardContent, CardHeader } from "@docstore/ui/components/card";
import { Input } from "@docstore/ui/components/input";
import { useMutation } from "@tanstack/react-query";
import {
	FlaskConicalIcon,
	LayoutTemplateIcon,
	PencilIcon,
	PlusIcon,
	Trash2Icon,
} from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";

import { useConfirm } from "@/components/confirm-dialog";
import { DateText } from "@/components/date-text";
import {
	DragHandle,
	SortableList,
	SortableRow,
} from "@/components/dnd/sortable";
import { formatConfidence } from "@/components/documents/document-labels";
import { EmptyState } from "@/components/empty-state";
import { FormField } from "@/components/form-field";
import { MonoLabel } from "@/components/mono-label";
import { LayoutExtractionRules } from "@/components/rules/extraction-rule-list";
import { TestDocumentPicker } from "@/components/rules/test-document-picker";
import { toastApiError } from "@/lib/api-error";
import { orpc } from "@/utils/orpc";

import { LayoutFormSheet } from "./layout-form-sheet";

export interface DocumentTypeLayoutsProps {
	detail: DocumentTypeDetail;
}

/**
 * "Layouts" tab of a document type: the ordered list (drag and drop, the order
 * is the signature evaluation order), the create / edit sheet, "Create layout
 * from document", "Test layout" on a document — and, under each layout, its
 * extraction rules, which is now the only place they are created and edited
 * (SPEC §9).
 *
 * A type always carries at least one layout. While the default one is alone,
 * the layout machinery is noise: only its extraction rules are shown, and a
 * layout is added when the look of the document changes.
 */
export function DocumentTypeLayouts({ detail }: DocumentTypeLayoutsProps) {
	const confirm = useConfirm();
	const ids = useId();

	const [editing, setEditing] = useState<DocumentTypeLayoutDto | null>(null);
	const [creating, setCreating] = useState(false);
	const [seedDocument, setSeedDocument] = useState<DocumentListItem | null>(
		null,
	);
	const [seedName, setSeedName] = useState("");
	const [testDocument, setTestDocument] = useState<DocumentListItem | null>(
		null,
	);
	const [testLayoutId, setTestLayoutId] = useState<string | null>(null);
	const [result, setResult] = useState<TestDocumentTypeLayoutResult | null>(
		null,
	);

	const reorder = useMutation(
		orpc.documentType.reorderLayouts.mutationOptions(),
	);
	const remove = useMutation(orpc.documentType.removeLayout.mutationOptions());
	const fromDocument = useMutation(
		orpc.documentType.createLayoutFromDocument.mutationOptions(),
	);
	const test = useMutation(orpc.documentType.testLayout.mutationOptions());

	const layouts = detail.layouts;
	/** The default layout is on its own: no layout choice to make yet. */
	const soleDefault =
		layouts.length === 1 && layouts[0]?.isDefault ? layouts[0] : null;

	const onReorder = async (nextIds: string[]) => {
		try {
			await reorder.mutateAsync({
				documentTypeId: detail.id,
				ids: nextIds,
			});
		} catch (error) {
			toastApiError(error, "The layouts could not be reordered.");
		}
	};

	const onDelete = async (layout: DocumentTypeLayoutDto) => {
		const ok = await confirm({
			title: `Delete the layout "${layout.name}"?`,
			description:
				"Its extraction rules are deleted with it; no document is touched.",
			confirmLabel: "Delete",
			destructive: true,
		});
		if (!ok) {
			return;
		}
		try {
			await remove.mutateAsync({ id: layout.id });
			toast.success("Layout deleted.");
		} catch (error) {
			toastApiError(error, "The layout could not be deleted.");
		}
	};

	const onCreateFromDocument = async () => {
		if (!seedDocument) {
			return;
		}
		try {
			const created = await fromDocument.mutateAsync({
				documentTypeId: detail.id,
				documentId: seedDocument.id,
				name: seedName.trim() || seedDocument.title,
			});
			toast.success(
				`Layout "${created.name}" created; edit its signature to refine it.`,
			);
			setSeedDocument(null);
			setSeedName("");
		} catch (error) {
			toastApiError(error, "The layout could not be created.");
		}
	};

	const onTest = async (layoutId: string) => {
		if (!testDocument) {
			return;
		}
		setTestLayoutId(layoutId);
		try {
			setResult(
				await test.mutateAsync({ layoutId, documentId: testDocument.id }),
			);
		} catch (error) {
			setResult(null);
			toastApiError(error, "The layout could not be tested.");
		}
	};

	return (
		<div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
			<div className="flex flex-col gap-6 xl:col-span-7">
				{soleDefault ? (
					<Card>
						<CardHeader className="flex flex-wrap items-center justify-between gap-2">
							<MonoLabel>Extraction rules</MonoLabel>
							<Button
								variant="outline"
								size="sm"
								onClick={() => setCreating(true)}
							>
								<PlusIcon />
								New layout
							</Button>
						</CardHeader>
						<CardContent className="flex flex-col gap-3">
							<p className="text-muted-foreground text-xs">
								Add a layout when the document’s look changes.
							</p>
							<LayoutExtractionRules
								documentTypeId={detail.id}
								layoutId={soleDefault.id}
							/>
						</CardContent>
					</Card>
				) : (
					<Card>
						<CardHeader className="flex flex-wrap items-center justify-between gap-2">
							<MonoLabel>Layouts</MonoLabel>
							<Button size="sm" onClick={() => setCreating(true)}>
								<PlusIcon />
								New layout
							</Button>
						</CardHeader>
						<CardContent className="px-0">
							{layouts.length === 0 ? (
								// A type always opens with a "Default" layout; this only
								// covers a row migrated before that rule existed.
								<div className="px-4">
									<EmptyState
										size="sm"
										icon={LayoutTemplateIcon}
										title="No layout"
										description="Add a layout to attach extraction rules to a page design."
										action={
											<Button
												variant="outline"
												onClick={() => setCreating(true)}
											>
												<PlusIcon />
												New layout
											</Button>
										}
									/>
								</div>
							) : (
								<SortableList
									ids={layouts.map((layout) => layout.id)}
									onReorder={onReorder}
									label="Reorder the layouts of the document type"
								>
									<ul className="divide-y divide-border border-border border-t">
										{layouts.map((layout) => (
											<SortableRow key={layout.id} id={layout.id}>
												{({ handleProps }) => (
													<div className="group/row flex flex-col gap-3 px-4 py-3 transition-colors duration-200 ease-premium hover:bg-muted/40">
														<div className="flex items-center gap-3">
															<DragHandle
																handleProps={handleProps}
																label={`Reorder ${layout.name}`}
															/>
															<div className="min-w-0 flex-1">
																<p className="flex min-w-0 items-center gap-2 truncate font-medium text-sm">
																	{layout.name}
																	{layout.isDefault ? (
																		<Badge tone="primary">Default</Badge>
																	) : null}
																</p>
																<p className="flex flex-wrap items-center gap-1 truncate text-muted-foreground text-xs">
																	{layout.validFrom || layout.validUntil ? (
																		<>
																			<DateText
																				value={layout.validFrom}
																				fallback="Always"
																			/>
																			<span>→</span>
																			<DateText
																				value={layout.validUntil}
																				fallback="Always"
																			/>
																		</>
																	) : (
																		"No date range"
																	)}
																</p>
															</div>
															<Badge
																tone={layout.signature ? "info" : "neutral"}
																className="shrink-0"
															>
																{layout.signature
																	? "Signature"
																	: "No signature"}
															</Badge>
															<div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/row:opacity-100">
																<Button
																	variant="ghost"
																	size="icon-sm"
																	aria-label={`Test ${layout.name}`}
																	disabled={!testDocument || test.isPending}
																	onClick={() => onTest(layout.id)}
																>
																	<FlaskConicalIcon />
																</Button>
																<Button
																	variant="ghost"
																	size="icon-sm"
																	aria-label={`Edit ${layout.name}`}
																	onClick={() => setEditing(layout)}
																>
																	<PencilIcon />
																</Button>
																{/* A type always keeps at least one layout. */}
																{layouts.length > 1 ? (
																	<Button
																		variant="ghost"
																		size="icon-sm"
																		aria-label={`Delete ${layout.name}`}
																		onClick={() => onDelete(layout)}
																	>
																		<Trash2Icon />
																	</Button>
																) : null}
															</div>
														</div>

														<div className="pl-9">
															<LayoutExtractionRules
																documentTypeId={detail.id}
																layoutId={layout.id}
															/>
														</div>
													</div>
												)}
											</SortableRow>
										))}
									</ul>
								</SortableList>
							)}
						</CardContent>
					</Card>
				)}

				<Card>
					<CardHeader>
						<MonoLabel>Create layout from document</MonoLabel>
					</CardHeader>
					<CardContent className="flex flex-col gap-3">
						<p className="text-muted-foreground text-xs">
							The signature is seeded with the rarest words of the document — a
							starting point, meant to be edited.
						</p>
						<TestDocumentPicker
							label="Sample document"
							value={seedDocument}
							onValueChange={(document) => {
								setSeedDocument(document);
								setSeedName(document?.title ?? "");
							}}
						/>
						<FormField label="Layout name" htmlFor={`${ids}-seed-name`}>
							<Input
								id={`${ids}-seed-name`}
								value={seedName}
								placeholder="2024 redesign"
								onChange={(event) => setSeedName(event.target.value)}
							/>
						</FormField>
						<Button
							size="sm"
							className="self-start"
							disabled={!seedDocument || fromDocument.isPending}
							onClick={onCreateFromDocument}
						>
							<PlusIcon />
							Create layout
						</Button>
					</CardContent>
				</Card>
			</div>

			<div className="flex flex-col gap-6 xl:col-span-5">
				<Card>
					<CardHeader>
						<MonoLabel>Test a layout</MonoLabel>
					</CardHeader>
					<CardContent className="flex flex-col gap-3">
						<p className="text-muted-foreground text-xs">
							Pick a document, then press the flask on a layout row: its
							extraction rules run without writing anything.
						</p>
						<TestDocumentPicker
							label="Document to test"
							value={testDocument}
							onValueChange={(document) => {
								setTestDocument(document);
								setResult(null);
							}}
						/>
						{soleDefault ? (
							<Button
								size="sm"
								className="self-start"
								disabled={!testDocument || test.isPending}
								onClick={() => onTest(soleDefault.id)}
							>
								<FlaskConicalIcon />
								{test.isPending ? "Testing…" : "Test the extraction rules"}
							</Button>
						) : null}

						{result ? (
							<div className="flex flex-col gap-2">
								<div className="flex flex-wrap items-center gap-2">
									<Badge tone="primary">{result.layoutName}</Badge>
									{result.signatureMatched === null ? null : (
										<Badge
											tone={result.signatureMatched ? "success" : "danger"}
										>
											{result.signatureMatched
												? "Signature matches"
												: "Signature does not match"}
										</Badge>
									)}
									<span className="font-mono text-muted-foreground text-xs tabular-nums">
										avg {formatConfidence(result.averageConfidence)}
									</span>
								</div>

								{result.results.length === 0 ? (
									<p className="text-muted-foreground text-xs">
										No extraction rule is attached to this layout.
									</p>
								) : (
									<ul
										data-testid="layout-test-results"
										className="divide-y divide-border rounded-lg ring-1 ring-border"
									>
										{result.results.map((item) => (
											<li
												key={item.extractionRuleId}
												className="row-in flex items-center gap-3 px-3 py-2"
											>
												<div className="min-w-0 flex-1">
													<p className="truncate font-medium text-sm">
														{item.extractionRuleName}
													</p>
													<p className="truncate font-mono text-muted-foreground text-xs">
														{item.raw === null
															? "No value"
															: String(item.value)}
													</p>
												</div>
												<Badge tone={item.raw === null ? "danger" : "success"}>
													{formatConfidence(item.confidence)}
												</Badge>
											</li>
										))}
									</ul>
								)}
							</div>
						) : testLayoutId && test.isPending ? (
							<p className="text-muted-foreground text-xs">Testing…</p>
						) : null}
					</CardContent>
				</Card>
			</div>

			<LayoutFormSheet
				open={creating || editing !== null}
				onOpenChange={(open) => {
					if (!open) {
						setCreating(false);
						setEditing(null);
					}
				}}
				documentTypeId={detail.id}
				layout={editing ?? undefined}
			/>
		</div>
	);
}
