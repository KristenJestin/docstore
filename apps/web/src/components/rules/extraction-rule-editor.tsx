import type { CustomField } from "@docstore/shared/custom-field";
import type { DocumentListItem } from "@docstore/shared/document";
import type {
	AnchorPosition,
	ExtractionResult,
	ExtractionRule,
	ExtractionStrategy,
	ExtractionTarget,
	ExtractionTargetKind,
	PostprocessStep,
} from "@docstore/shared/extraction";
import {
	ANCHOR_POSITIONS,
	EXTRACTION_TARGET_KINDS,
} from "@docstore/shared/extraction";
import { Badge } from "@docstore/ui/components/badge";
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbSeparator,
} from "@docstore/ui/components/breadcrumb";
import { Button } from "@docstore/ui/components/button";
import { Card, CardContent, CardHeader } from "@docstore/ui/components/card";
import { Input } from "@docstore/ui/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@docstore/ui/components/select";
import { Switch } from "@docstore/ui/components/switch";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@docstore/ui/components/tabs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { FlaskConicalIcon, Trash2Icon } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";

import { useConfirm } from "@/components/confirm-dialog";
import { formatConfidence } from "@/components/documents/document-labels";
import { FormField } from "@/components/form-field";
import { MonoLabel } from "@/components/mono-label";
import { PageHeader } from "@/components/page-header";
import { toastApiError } from "@/lib/api-error";
import { orpc } from "@/utils/orpc";

import {
	LayoutLinesList,
	type ZoneRect,
	ZoneSelector,
} from "./extraction-layout";
import { PostprocessEditor } from "./postprocess-editor";
import {
	ANCHOR_POSITION_LABELS,
	EXTRACTION_TARGET_LABELS,
	regexError,
} from "./rule-labels";
import { TestDocumentPicker } from "./test-document-picker";

type StrategyKind = ExtractionStrategy["kind"];

interface ExtractionDraft {
	name: string;
	targetKind: ExtractionTargetKind;
	fieldId: string;
	strategyKind: StrategyKind;
	regexPattern: string;
	regexGroup: string;
	regexFlags: string;
	anchorLabel: string;
	anchorPosition: AnchorPosition;
	anchorMaxDistance: string;
	anchorValuePattern: string;
	anchorFlags: string;
	zone: ZoneRect;
	postprocess: PostprocessStep[];
	/** `true` blocks the document in Review when the rule finds nothing. */
	required: boolean;
	/** Layout the rule belongs to: a rule never exists outside one (SPEC §9). */
	layoutId: string;
}

const EMPTY_DRAFT: ExtractionDraft = {
	name: "",
	targetKind: "field",
	fieldId: "",
	strategyKind: "regex",
	regexPattern: "",
	regexGroup: "1",
	regexFlags: "i",
	anchorLabel: "",
	anchorPosition: "sameLine",
	anchorMaxDistance: "",
	anchorValuePattern: "",
	anchorFlags: "i",
	zone: { page: 1, x0: 0.1, y0: 0.1, x1: 0.5, y1: 0.2 },
	postprocess: [],
	required: false,
	layoutId: "",
};

function toDraft(rule: ExtractionRule): ExtractionDraft {
	const strategy = rule.strategy;
	return {
		...EMPTY_DRAFT,
		name: rule.name,
		targetKind: rule.target.kind,
		fieldId: rule.target.kind === "field" ? rule.target.fieldId : "",
		strategyKind: strategy.kind,
		regexPattern: strategy.kind === "regex" ? strategy.pattern : "",
		regexGroup: strategy.kind === "regex" ? String(strategy.group ?? 1) : "1",
		regexFlags: strategy.kind === "regex" ? (strategy.flags ?? "") : "i",
		anchorLabel: strategy.kind === "anchor" ? strategy.label : "",
		anchorPosition: strategy.kind === "anchor" ? strategy.position : "sameLine",
		anchorMaxDistance:
			strategy.kind === "anchor" && strategy.maxDistancePx !== undefined
				? String(strategy.maxDistancePx)
				: "",
		anchorValuePattern:
			strategy.kind === "anchor" ? (strategy.valuePattern ?? "") : "",
		anchorFlags: strategy.kind === "anchor" ? (strategy.flags ?? "") : "i",
		zone:
			strategy.kind === "zone"
				? {
						page: strategy.page ?? 1,
						x0: strategy.x0,
						y0: strategy.y0,
						x1: strategy.x1,
						y1: strategy.y1,
					}
				: EMPTY_DRAFT.zone,
		postprocess: rule.postprocess,
		required: rule.required,
		layoutId: rule.layoutId,
	};
}

function toTarget(draft: ExtractionDraft): ExtractionTarget {
	return draft.targetKind === "field"
		? { kind: "field", fieldId: draft.fieldId }
		: { kind: draft.targetKind };
}

function toStrategy(draft: ExtractionDraft): ExtractionStrategy {
	if (draft.strategyKind === "regex") {
		return {
			kind: "regex",
			pattern: draft.regexPattern,
			group: Number(draft.regexGroup) || 0,
			flags: draft.regexFlags || undefined,
		};
	}
	if (draft.strategyKind === "anchor") {
		return {
			kind: "anchor",
			label: draft.anchorLabel,
			position: draft.anchorPosition,
			maxDistancePx: draft.anchorMaxDistance
				? Number(draft.anchorMaxDistance)
				: undefined,
			valuePattern: draft.anchorValuePattern || undefined,
			flags: draft.anchorFlags || undefined,
		};
	}
	return { kind: "zone", ...draft.zone };
}

/** A draft can only be tested or saved once its strategy carries a pattern. */
function isComplete(draft: ExtractionDraft): boolean {
	if (draft.name.trim().length === 0) {
		return false;
	}
	if (draft.targetKind === "field" && draft.fieldId.length === 0) {
		return false;
	}
	if (draft.layoutId.length === 0) {
		return false;
	}
	if (draft.strategyKind === "regex") {
		return draft.regexPattern.length > 0;
	}
	if (draft.strategyKind === "anchor") {
		return draft.anchorLabel.length > 0;
	}
	return true;
}

export interface ExtractionRuleEditorProps {
	/** Document type owning the layout: drives the wording and the return. */
	documentTypeId: string;
	/** Existing rule; absent when creating one from a layout. */
	rule?: ExtractionRule;
	/**
	 * Layout the new rule belongs to ("Add extraction rule" of the Layouts tab
	 * of a document type). Required at creation.
	 */
	layoutId?: string;
}

/**
 * Full-page editor of an extraction rule (SPEC §4): target, strategy (regex /
 * anchor / zone) and post-processing on the left, layout preview and live test
 * on the right. The rule always belongs to the layout it was opened from.
 */
export function ExtractionRuleEditor({
	documentTypeId,
	rule,
	layoutId,
}: ExtractionRuleEditorProps) {
	const ids = useId();
	const navigate = useNavigate();
	const confirm = useConfirm();
	const queryClient = useQueryClient();

	const [draft, setDraft] = useState<ExtractionDraft>(() =>
		rule ? toDraft(rule) : { ...EMPTY_DRAFT, layoutId: layoutId ?? "" },
	);
	const [target, setTarget] = useState<DocumentListItem | null>(null);
	const [result, setResult] = useState<ExtractionResult | null>(null);

	const fields = useQuery(orpc.customField.list.queryOptions({ input: {} }));
	const type = useQuery(
		orpc.documentType.get.queryOptions({ input: { id: documentTypeId } }),
	);
	const create = useMutation(orpc.extractionRule.create.mutationOptions());
	const update = useMutation(orpc.extractionRule.update.mutationOptions());
	const remove = useMutation(orpc.extractionRule.delete.mutationOptions());
	const test = useMutation(orpc.extractionRule.test.mutationOptions());

	const customFields: CustomField[] = fields.data ?? [];
	const fieldLabels = Object.fromEntries(
		customFields.map((field) => [field.id, field.name]),
	);
	const patch = (next: Partial<ExtractionDraft>) =>
		setDraft((current) => ({ ...current, ...next }));

	const layoutName =
		type.data?.layouts.find((item) => item.id === draft.layoutId)?.name ?? null;

	const save = async () => {
		try {
			if (rule) {
				await update.mutateAsync({
					id: rule.id,
					name: draft.name.trim(),
					target: toTarget(draft),
					strategy: toStrategy(draft),
					postprocess: draft.postprocess,
					required: draft.required,
					layoutId: draft.layoutId,
				});
				toast.success("Extraction rule saved.");
				return;
			}
			const created = await create.mutateAsync({
				name: draft.name.trim(),
				target: toTarget(draft),
				strategy: toStrategy(draft),
				postprocess: draft.postprocess,
				required: draft.required,
				layoutId: draft.layoutId,
			});
			toast.success(`Extraction rule "${created.name}" created.`);
			navigate({
				to: "/types/$typeId/extraction/$extractionRuleId",
				params: { typeId: documentTypeId, extractionRuleId: created.id },
			});
		} catch (error) {
			toastApiError(error, "The extraction rule could not be saved.");
		}
	};

	const destroy = async () => {
		if (!rule) {
			return;
		}
		const ok = await confirm({
			title: `Delete "${rule.name}"?`,
			description: "This layout will stop filling the target it fills.",
			confirmLabel: "Delete",
			destructive: true,
		});
		if (!ok) {
			return;
		}
		try {
			await remove.mutateAsync({ id: rule.id });
			// Leave the page before invalidating: refetching `extractionRule.get` on
			// an id that no longer exists would raise an error.
			queryClient.removeQueries({
				queryKey: orpc.extractionRule.get.queryKey({ input: { id: rule.id } }),
			});
			toast.success("Extraction rule deleted.");
			navigate({
				to: "/types/$typeId",
				params: { typeId: documentTypeId },
				search: { tab: "layouts" },
			});
		} catch (error) {
			toastApiError(error, "The extraction rule could not be deleted.");
		}
	};

	const runTest = async () => {
		if (!target) {
			return;
		}
		try {
			const outcome = await test.mutateAsync({
				rule: {
					name: draft.name.trim() || "Draft",
					target: toTarget(draft),
					strategy: toStrategy(draft),
					postprocess: draft.postprocess,
				},
				documentId: target.id,
			});
			setResult(outcome);
		} catch (error) {
			toastApiError(error, "The extraction could not be tested.");
		}
	};

	return (
		<>
			<PageHeader
				kicker="Document type"
				title={rule ? rule.name : "New extraction rule"}
				description="Locate a value in the text or in the OCR layer, then clean it up."
				breadcrumb={
					<Breadcrumb>
						<BreadcrumbList className="font-mono text-xs">
							<BreadcrumbItem>
								<BreadcrumbLink render={<Link to="/types" search={{}} />}>
									Document types
								</BreadcrumbLink>
							</BreadcrumbItem>
							<BreadcrumbSeparator />
							<BreadcrumbItem>
								<BreadcrumbLink
									render={
										<Link
											to="/types/$typeId"
											params={{ typeId: documentTypeId }}
											search={{ tab: "layouts" }}
										/>
									}
								>
									{type.data?.name ?? "Layouts"}
								</BreadcrumbLink>
							</BreadcrumbItem>
						</BreadcrumbList>
					</Breadcrumb>
				}
				actions={
					<>
						{rule ? (
							<Button variant="ghost" onClick={destroy}>
								<Trash2Icon />
								Delete
							</Button>
						) : null}
						<Button
							onClick={save}
							disabled={
								!isComplete(draft) || create.isPending || update.isPending
							}
						>
							{rule ? "Save" : "Create extraction rule"}
						</Button>
					</>
				}
			/>

			<div className="grid gap-6 px-6 py-6 lg:grid-cols-2 lg:px-8">
				<div className="flex flex-col gap-5">
					<Card>
						<CardHeader>
							<MonoLabel>Definition</MonoLabel>
						</CardHeader>
						<CardContent className="flex flex-col gap-4">
							<FormField label="Name" htmlFor={`${ids}-name`} required>
								<Input
									id={`${ids}-name`}
									value={draft.name}
									placeholder="Invoice total"
									onChange={(event) => patch({ name: event.target.value })}
								/>
							</FormField>

							<FormField label="Target" htmlFor={`${ids}-target`}>
								<Select
									items={EXTRACTION_TARGET_LABELS}
									value={draft.targetKind}
									onValueChange={(kind) =>
										patch({ targetKind: kind as ExtractionTargetKind })
									}
								>
									<SelectTrigger
										id={`${ids}-target`}
										aria-label="Target"
										className="w-full"
									>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{EXTRACTION_TARGET_KINDS.map((kind) => (
											<SelectItem key={kind} value={kind}>
												{EXTRACTION_TARGET_LABELS[kind]}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</FormField>

							{draft.targetKind === "field" ? (
								<FormField
									label="Custom field"
									htmlFor={`${ids}-field`}
									required
								>
									<Select
										items={fieldLabels}
										value={draft.fieldId}
										onValueChange={(fieldId) =>
											patch({ fieldId: fieldId ?? "" })
										}
									>
										<SelectTrigger
											id={`${ids}-field`}
											aria-label="Custom field"
											className="w-full"
										>
											<SelectValue placeholder="Choose a field…" />
										</SelectTrigger>
										<SelectContent>
											{customFields.map((field) => (
												<SelectItem key={field.id} value={field.id}>
													{field.name}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</FormField>
							) : null}

							<div className="flex items-center justify-between gap-4">
								<div>
									<p className="font-medium text-sm">Required value</p>
									<p className="text-muted-foreground text-xs">
										Off: a miss leaves the field empty. On: the document waits
										in Review until someone fills it.
									</p>
								</div>
								<Switch
									aria-label="Required value"
									checked={draft.required}
									onCheckedChange={(required) => patch({ required })}
								/>
							</div>

							<div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-xs ring-1 ring-border">
								<Badge tone="info">{layoutName ?? "Layout"}</Badge>
								<span className="min-w-0 flex-1 text-muted-foreground">
									The rule only runs when this layout of{" "}
									{type.data?.name ?? "the document type"} is selected.
								</span>
							</div>
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<MonoLabel>Strategy</MonoLabel>
						</CardHeader>
						<CardContent>
							<Tabs
								value={draft.strategyKind}
								onValueChange={(kind) =>
									patch({ strategyKind: kind as StrategyKind })
								}
							>
								<TabsList variant="line">
									<TabsTrigger value="regex">Regex</TabsTrigger>
									<TabsTrigger value="anchor">Anchor</TabsTrigger>
									<TabsTrigger value="zone">Zone</TabsTrigger>
								</TabsList>

								<TabsContent value="regex" className="flex flex-col gap-4 pt-4">
									<FormField
										label="Pattern"
										htmlFor={`${ids}-pattern`}
										errors={
											regexError(draft.regexPattern, draft.regexFlags)
												? [
														regexError(draft.regexPattern, draft.regexFlags) ??
															"",
													]
												: undefined
										}
										hint="Applied to the whole text of the document."
									>
										<Input
											id={`${ids}-pattern`}
											value={draft.regexPattern}
											placeholder={"Total\\s*:?\\s*([\\d\\s.,]+)"}
											className="font-mono"
											onChange={(event) =>
												patch({ regexPattern: event.target.value })
											}
										/>
									</FormField>
									<div className="grid grid-cols-2 gap-3">
										<FormField
											label="Capture group"
											htmlFor={`${ids}-group`}
											hint="0 = the whole match."
										>
											<Input
												id={`${ids}-group`}
												type="number"
												min={0}
												max={20}
												className="font-mono tabular-nums"
												value={draft.regexGroup}
												onChange={(event) =>
													patch({ regexGroup: event.target.value })
												}
											/>
										</FormField>
										<FormField
											label="Flags"
											htmlFor={`${ids}-flags`}
											hint="Empty = case-sensitive. Add i to ignore case."
										>
											<Input
												id={`${ids}-flags`}
												maxLength={8}
												className="font-mono"
												value={draft.regexFlags}
												onChange={(event) =>
													patch({
														regexFlags: event.target.value.replace(
															/[^dgimsuvy]/g,
															"",
														),
													})
												}
											/>
										</FormField>
									</div>
								</TabsContent>

								<TabsContent
									value="anchor"
									className="flex flex-col gap-4 pt-4"
								>
									<FormField
										label="Label regex"
										htmlFor={`${ids}-label`}
										hint="Searched line by line in the OCR layer."
										errors={
											regexError(draft.anchorLabel, draft.anchorFlags)
												? [
														regexError(draft.anchorLabel, draft.anchorFlags) ??
															"",
													]
												: undefined
										}
									>
										<Input
											id={`${ids}-label`}
											value={draft.anchorLabel}
											placeholder="Net à payer"
											className="font-mono"
											onChange={(event) =>
												patch({ anchorLabel: event.target.value })
											}
										/>
									</FormField>

									<div className="grid gap-3">
										<FormField label="Position" htmlFor={`${ids}-position`}>
											<Select
												items={ANCHOR_POSITION_LABELS}
												value={draft.anchorPosition}
												onValueChange={(position) =>
													patch({ anchorPosition: position as AnchorPosition })
												}
											>
												<SelectTrigger
													id={`${ids}-position`}
													aria-label="Position"
													className="w-full"
												>
													<SelectValue />
												</SelectTrigger>
												<SelectContent>
													{ANCHOR_POSITIONS.map((position) => (
														<SelectItem key={position} value={position}>
															{ANCHOR_POSITION_LABELS[position]}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
										</FormField>
										<FormField
											label="Max distance"
											htmlFor={`${ids}-distance`}
											hint="In page pixels. Empty = no limit."
										>
											<Input
												id={`${ids}-distance`}
												type="number"
												min={1}
												className="font-mono tabular-nums"
												value={draft.anchorMaxDistance}
												onChange={(event) =>
													patch({ anchorMaxDistance: event.target.value })
												}
											/>
										</FormField>
									</div>

									<FormField
										label="Value pattern"
										htmlFor={`${ids}-value-pattern`}
										hint="Optional: narrows the candidate text to a capture group."
									>
										<Input
											id={`${ids}-value-pattern`}
											value={draft.anchorValuePattern}
											placeholder={"(\\d[\\d\\s.,]*\\d)"}
											className="font-mono"
											onChange={(event) =>
												patch({ anchorValuePattern: event.target.value })
											}
										/>
									</FormField>
								</TabsContent>

								<TabsContent value="zone" className="pt-4">
									<ZoneSelector
										documentId={target?.id ?? null}
										value={draft.zone}
										onChange={(zone) => patch({ zone })}
										matchedWords={result?.matchedWords}
									/>
								</TabsContent>
							</Tabs>
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<MonoLabel>Post-processing</MonoLabel>
						</CardHeader>
						<CardContent>
							<PostprocessEditor
								value={draft.postprocess}
								onChange={(postprocess) => patch({ postprocess })}
							/>
						</CardContent>
					</Card>
				</div>

				<div className="flex flex-col gap-5">
					<Card>
						<CardHeader>
							<MonoLabel>Test</MonoLabel>
						</CardHeader>
						<CardContent className="flex flex-col gap-4">
							<FormField label="Document" htmlFor={`${ids}-document`}>
								<TestDocumentPicker
									id={`${ids}-document`}
									value={target}
									onValueChange={(document) => {
										setTarget(document);
										setResult(null);
									}}
								/>
							</FormField>

							<Button
								className="self-start"
								disabled={!target || !isComplete(draft) || test.isPending}
								onClick={runTest}
							>
								<FlaskConicalIcon />
								{test.isPending ? "Testing…" : "Test"}
							</Button>

							{result ? (
								<dl
									data-testid="extraction-test-result"
									className="flex flex-col gap-2 rounded-lg bg-muted/40 p-3 ring-1 ring-border"
								>
									<div className="flex items-center gap-2">
										<dt className="mono-label">Value</dt>
										<dd
											data-testid="extraction-value"
											className="min-w-0 flex-1 break-words font-mono text-sm"
										>
											{result.value === null || result.value === undefined
												? "no value"
												: String(result.value)}
										</dd>
										<Badge tone={result.value === null ? "danger" : "success"}>
											{formatConfidence(result.confidence) ?? "0.00"}
										</Badge>
									</div>
									<div className="flex items-baseline gap-2">
										<dt className="mono-label">Raw</dt>
										<dd className="min-w-0 flex-1 break-words font-mono text-muted-foreground text-xs">
											{result.raw ?? "—"}
										</dd>
									</div>
									{result.precision ? (
										<div className="flex items-baseline gap-2">
											<dt className="mono-label">Precision</dt>
											<dd className="font-mono text-xs">{result.precision}</dd>
										</div>
									) : null}
								</dl>
							) : null}
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<MonoLabel>Text layout</MonoLabel>
						</CardHeader>
						<CardContent>
							<LayoutLinesList
								documentId={target?.id ?? null}
								onPickLine={(text) =>
									patch({ strategyKind: "anchor", anchorLabel: text.trim() })
								}
							/>
						</CardContent>
					</Card>
				</div>
			</div>
		</>
	);
}
