import type { DocumentListItem } from "@docstore/shared/document";
import type {
	RuleAction,
	RuleCondition,
	TestRuleResult,
} from "@docstore/shared/rule";
import { Badge } from "@docstore/ui/components/badge";
import { Button } from "@docstore/ui/components/button";
import { Card, CardContent, CardHeader } from "@docstore/ui/components/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@docstore/ui/components/dialog";
import { useMutation } from "@tanstack/react-query";
import { FlaskConicalIcon, PlayIcon, ZapIcon } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";

import { formatConfidence } from "@/components/documents/document-labels";
import { FormField } from "@/components/form-field";
import { MonoLabel } from "@/components/mono-label";
import { useForceRetry } from "@/hooks/use-force-retry";
import { toastApiError } from "@/lib/api-error";
import { countLabel } from "@/lib/plural";
import { orpc } from "@/utils/orpc";
import { ConditionTrace } from "./condition-trace";
import { PlannedOperationList } from "./planned-operations";
import { TestDocumentPicker } from "./test-document-picker";

export interface RuleTestPanelProps {
	/** Draft currently edited: what `rule.test` evaluates. */
	name: string;
	condition: RuleCondition;
	actions: RuleAction[];
	/** Saved rule, when there is one: unlocks the "run" buttons. */
	ruleId?: string;
}

/**
 * Live test column of the rule editor: pick a document, evaluate the draft
 * without writing anything, then apply the saved rule to that document or to
 * every matching one.
 */
export function RuleTestPanel({
	name,
	condition,
	actions,
	ruleId,
}: RuleTestPanelProps) {
	const ids = useId();

	const [target, setTarget] = useState<DocumentListItem | null>(null);
	const [result, setResult] = useState<TestRuleResult | null>(null);
	const [runAllOpen, setRunAllOpen] = useState(false);
	const [runAllResult, setRunAllResult] = useState<{
		processed: number;
		matched: number;
	} | null>(null);

	const test = useMutation(orpc.rule.test.mutationOptions());
	const run = useMutation(orpc.rule.run.mutationOptions());
	const forceRetry = useForceRetry();

	const onTest = async () => {
		if (!target) {
			return;
		}
		try {
			const outcome = await test.mutateAsync({
				rule: { name: name.trim() || "Draft", condition, actions },
				documentId: target.id,
			});
			setResult(outcome);
		} catch (error) {
			toastApiError(error, "The rule could not be evaluated.");
		}
	};

	const onRunHere = async () => {
		if (!ruleId || !target) {
			return;
		}
		try {
			const outcome = await forceRetry("automation", (force) =>
				run.mutateAsync({ ruleId, documentIds: [target.id], force }),
			);
			if (outcome === null) {
				return;
			}
			toast.success(
				`${outcome.matched} of ${countLabel(outcome.processed, "document")} matched.`,
			);
		} catch (error) {
			toastApiError(error, "The rule could not be applied.");
		}
	};

	const onRunAll = async () => {
		if (!ruleId) {
			return;
		}
		try {
			const outcome = await forceRetry("automation", (force) =>
				run.mutateAsync({ ruleId, all: true, force }),
			);
			if (outcome === null) {
				return;
			}
			setRunAllResult(outcome);
		} catch (error) {
			toastApiError(error, "The rule could not be applied.");
		}
	};

	return (
		<Card>
			<CardHeader className="flex flex-wrap items-center justify-between gap-2">
				<MonoLabel>Test</MonoLabel>
				{ruleId ? (
					<div className="flex items-center gap-2">
						<Button
							variant="outline"
							size="sm"
							disabled={!target || run.isPending}
							onClick={onRunHere}
						>
							<PlayIcon />
							Run on this document
						</Button>
						<Button
							variant="outline"
							size="sm"
							onClick={() => {
								setRunAllResult(null);
								setRunAllOpen(true);
							}}
						>
							<ZapIcon />
							Run on all matching
						</Button>
					</div>
				) : null}
			</CardHeader>

			<CardContent className="flex flex-col gap-4">
				<FormField
					label="Document"
					htmlFor={`${ids}-document`}
					hint="Nothing is written: the rule is only simulated."
				>
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
					disabled={!target || test.isPending}
					onClick={onTest}
				>
					<FlaskConicalIcon />
					{test.isPending ? "Testing…" : "Test"}
				</Button>

				{result ? (
					<div className="flex flex-col gap-4">
						<div className="flex flex-wrap items-center gap-2">
							<Badge
								data-testid="rule-test-matched"
								tone={result.matched ? "success" : "danger"}
							>
								{result.matched ? "matched" : "not matched"}
							</Badge>
							{/* A disabled automation stays testable, and says so. */}
							<Badge
								data-testid="rule-test-enabled"
								tone={result.enabled ? "outline" : "warning"}
							>
								{result.enabled ? "Enabled" : "Disabled"}
							</Badge>
							<span className="text-muted-foreground text-xs">
								{countLabel(result.plannedActions.length, "planned operation")}
							</span>
						</div>

						<section className="flex flex-col gap-2">
							<MonoLabel>Condition</MonoLabel>
							<ConditionTrace condition={condition} trace={result.trace} />
						</section>

						<section className="flex flex-col gap-2">
							<MonoLabel>Planned actions</MonoLabel>
							{/*
							 * An automation without a single action matches and writes
							 * nothing: an empty plan would read like a failed evaluation.
							 */}
							{result.hasActions ? (
								<PlannedOperationList operations={result.plannedActions} />
							) : (
								<p
									data-testid="rule-test-no-actions"
									className="rounded-lg bg-muted/40 px-3 py-2 text-muted-foreground text-xs ring-1 ring-border"
								>
									This automation has no actions: it would change nothing. Add
									one below the condition.
								</p>
							)}
						</section>

						{result.extractions.length > 0 ? (
							<section className="flex flex-col gap-2">
								<MonoLabel>Extractions</MonoLabel>
								<ul className="flex flex-col gap-1.5">
									{result.extractions.map((extraction) => (
										<li
											key={extraction.extractionRuleId}
											className="rounded-lg bg-muted/40 px-3 py-2 ring-1 ring-border"
										>
											<p className="flex items-center gap-2 text-sm">
												<span className="min-w-0 flex-1 truncate font-semibold">
													{extraction.extractionRuleName}
												</span>
												<Badge
													tone={
														extraction.value === null ? "danger" : "success"
													}
												>
													{formatConfidence(extraction.confidence) ?? "0.00"}
												</Badge>
											</p>
											<p className="mt-1 break-words font-mono text-xs">
												{extraction.value === null
													? "no value"
													: String(extraction.value)}
											</p>
											{extraction.raw ? (
												<p className="mt-0.5 break-words text-muted-foreground text-xs">
													raw: {extraction.raw}
												</p>
											) : null}
										</li>
									))}
								</ul>
							</section>
						) : null}
					</div>
				) : null}
			</CardContent>

			<Dialog open={runAllOpen} onOpenChange={setRunAllOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Run this rule on every document?</DialogTitle>
						<DialogDescription>
							Up to 500 documents are processed per run. Matching documents are
							updated for real.
						</DialogDescription>
					</DialogHeader>

					{runAllResult ? (
						<p className="font-mono text-sm tabular-nums">
							{runAllResult.matched} matched · {runAllResult.processed}{" "}
							processed
						</p>
					) : null}

					<DialogFooter>
						<Button variant="outline" onClick={() => setRunAllOpen(false)}>
							Cancel
						</Button>
						<Button disabled={run.isPending} onClick={onRunAll}>
							{run.isPending ? "Running…" : "Run now"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</Card>
	);
}
