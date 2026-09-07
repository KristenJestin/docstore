import type {
	Rule,
	RuleAction,
	RuleCondition,
	RuleTrigger,
} from "@docstore/shared/rule";
import { RULE_TRIGGERS } from "@docstore/shared/rule";
import { Button } from "@docstore/ui/components/button";
import { Card, CardContent, CardHeader } from "@docstore/ui/components/card";
import { Checkbox } from "@docstore/ui/components/checkbox";
import { Input } from "@docstore/ui/components/input";
import { Switch } from "@docstore/ui/components/switch";
import { Textarea } from "@docstore/ui/components/textarea";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { CopyIcon, HistoryIcon, Trash2Icon } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";

import { useConfirm } from "@/components/confirm-dialog";
import { FormField } from "@/components/form-field";
import { MonoLabel } from "@/components/mono-label";
import { PageHeader } from "@/components/page-header";
import { toastApiError } from "@/lib/api-error";
import { orpc } from "@/utils/orpc";

import {
	asConditionGroup,
	ConditionBuilder,
	EMPTY_GROUP,
} from "./condition-builder";
import { RuleActionsEditor } from "./rule-actions-editor";
import { RULE_TRIGGER_HINTS, RULE_TRIGGER_LABELS } from "./rule-labels";
import { RuleRunsDrawer } from "./rule-runs-drawer";
import { RuleTestPanel } from "./rule-test-panel";

interface RuleDraftState {
	name: string;
	description: string;
	enabled: boolean;
	triggers: RuleTrigger[];
	stopOnMatch: boolean;
	condition: RuleCondition;
	actions: RuleAction[];
}

function toDraft(rule: Rule | undefined): RuleDraftState {
	if (!rule) {
		return {
			name: "",
			description: "",
			enabled: true,
			triggers: ["ingest", "manual"],
			stopOnMatch: false,
			condition: EMPTY_GROUP,
			actions: [],
		};
	}
	return {
		name: rule.name,
		description: rule.description ?? "",
		enabled: rule.enabled,
		triggers: rule.triggers,
		stopOnMatch: rule.stopOnMatch,
		condition: asConditionGroup(rule.condition),
		actions: rule.actions,
	};
}

export interface RuleEditorProps {
	/** Existing rule; absent for `/settings/automations/new`. */
	rule?: Rule;
}

/**
 * Full-page rule editor (SPEC §3): definition, condition tree and actions on
 * the left, live test on the right.
 */
export function RuleEditor({ rule }: RuleEditorProps) {
	const ids = useId();
	const navigate = useNavigate();
	const confirm = useConfirm();
	const queryClient = useQueryClient();

	const [draft, setDraft] = useState<RuleDraftState>(() => toDraft(rule));
	const [runsOpen, setRunsOpen] = useState(false);

	const create = useMutation(orpc.rule.create.mutationOptions());
	const update = useMutation(orpc.rule.update.mutationOptions());
	const remove = useMutation(orpc.rule.delete.mutationOptions());

	const patch = (next: Partial<RuleDraftState>) =>
		setDraft((current) => ({ ...current, ...next }));

	const invalidate = () =>
		queryClient.invalidateQueries({ queryKey: orpc.rule.key() });

	const canSave =
		draft.name.trim().length > 0 &&
		draft.triggers.length > 0 &&
		!create.isPending;

	const save = async () => {
		const payload = {
			name: draft.name.trim(),
			description: draft.description.trim() || null,
			enabled: draft.enabled,
			triggers: draft.triggers,
			condition: draft.condition,
			actions: draft.actions,
			stopOnMatch: draft.stopOnMatch,
		};
		try {
			if (rule) {
				await update.mutateAsync({ id: rule.id, ...payload });
				await invalidate();
				toast.success("Rule saved.");
				return;
			}
			const created = await create.mutateAsync(payload);
			await invalidate();
			toast.success(`Rule "${created.name}" created.`);
			navigate({
				to: "/settings/automations/$ruleId",
				params: { ruleId: created.id },
			});
		} catch (error) {
			toastApiError(error, "The rule could not be saved.");
		}
	};

	const duplicate = async () => {
		try {
			const created = await create.mutateAsync({
				name: `${draft.name.trim()} (copy)`,
				description: draft.description.trim() || null,
				enabled: false,
				triggers: draft.triggers,
				condition: draft.condition,
				actions: draft.actions,
				stopOnMatch: draft.stopOnMatch,
			});
			await invalidate();
			toast.success(`Rule "${created.name}" created.`);
			navigate({
				to: "/settings/automations/$ruleId",
				params: { ruleId: created.id },
			});
		} catch (error) {
			toastApiError(error, "The rule could not be duplicated.");
		}
	};

	const destroy = async () => {
		if (!rule) {
			return;
		}
		const ok = await confirm({
			title: `Delete the automation "${rule.name}"?`,
			description: "Its run history is deleted with it.",
			confirmLabel: "Delete",
			destructive: true,
		});
		if (!ok) {
			return;
		}
		try {
			await remove.mutateAsync({ id: rule.id });
			// Leave the page before invalidating: refetching `rule.get` on an id
			// that no longer exists would raise an error.
			queryClient.removeQueries({
				queryKey: orpc.rule.get.queryKey({ input: { id: rule.id } }),
			});
			toast.success("Automation deleted.");
			navigate({ to: "/settings/automations" });
			await invalidate();
		} catch (error) {
			toastApiError(error, "The rule could not be deleted.");
		}
	};

	const toggleTrigger = (trigger: RuleTrigger, checked: boolean) => {
		patch({
			triggers: checked
				? [...draft.triggers, trigger]
				: draft.triggers.filter((item) => item !== trigger),
		});
	};

	return (
		<>
			<PageHeader
				kicker="Automations"
				title={rule ? rule.name : "New automation"}
				description="Triggers, condition and actions applied to a document."
				actions={
					<>
						{rule ? (
							<>
								<Button variant="ghost" onClick={() => setRunsOpen(true)}>
									<HistoryIcon />
									History
								</Button>
								<Button variant="ghost" onClick={duplicate}>
									<CopyIcon />
									Duplicate
								</Button>
								<Button variant="ghost" onClick={destroy}>
									<Trash2Icon />
									Delete
								</Button>
							</>
						) : null}
						<Button onClick={save} disabled={!canSave}>
							{rule ? "Save" : "Create automation"}
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
									placeholder="Invoices"
									onChange={(event) => patch({ name: event.target.value })}
								/>
							</FormField>

							<FormField label="Description" htmlFor={`${ids}-description`}>
								<Textarea
									id={`${ids}-description`}
									rows={2}
									value={draft.description}
									placeholder="What this rule is for."
									onChange={(event) =>
										patch({ description: event.target.value })
									}
								/>
							</FormField>

							<div className="flex items-center justify-between gap-4">
								<div>
									<label htmlFor={`${ids}-enabled`} className="text-sm">
										Enabled
									</label>
									<p className="text-muted-foreground text-xs">
										A disabled automation is never evaluated.
									</p>
								</div>
								<Switch
									id={`${ids}-enabled`}
									checked={draft.enabled}
									onCheckedChange={(enabled) => patch({ enabled })}
								/>
							</div>

							<FormField label="Triggers">
								<ul className="flex flex-col gap-2">
									{RULE_TRIGGERS.map((trigger) => (
										<li key={trigger} className="flex items-start gap-2.5">
											<Checkbox
												id={`${ids}-trigger-${trigger}`}
												checked={draft.triggers.includes(trigger)}
												onCheckedChange={(checked) =>
													toggleTrigger(trigger, checked === true)
												}
											/>
											<div className="min-w-0">
												<label
													htmlFor={`${ids}-trigger-${trigger}`}
													className="text-sm"
												>
													{RULE_TRIGGER_LABELS[trigger]}
												</label>
												<p className="text-muted-foreground text-xs">
													{RULE_TRIGGER_HINTS[trigger]}
												</p>
											</div>
										</li>
									))}
								</ul>
							</FormField>

							<div className="flex items-center justify-between gap-4">
								<div>
									<label htmlFor={`${ids}-stop`} className="text-sm">
										Stop on match
									</label>
									<p className="text-muted-foreground text-xs">
										Skip the automations with a lower priority once this one
										matches.
									</p>
								</div>
								<Switch
									id={`${ids}-stop`}
									checked={draft.stopOnMatch}
									onCheckedChange={(stopOnMatch) => patch({ stopOnMatch })}
								/>
							</div>
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<MonoLabel>Condition</MonoLabel>
						</CardHeader>
						<CardContent>
							<ConditionBuilder
								value={draft.condition}
								onChange={(condition) => patch({ condition })}
							/>
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<MonoLabel>Actions</MonoLabel>
						</CardHeader>
						<CardContent>
							<RuleActionsEditor
								value={draft.actions}
								onChange={(actions) => patch({ actions })}
							/>
						</CardContent>
					</Card>
				</div>

				{/* Sticks under the shell header, never behind it (`--spacing-header`). */}
				<div className="flex flex-col gap-5 lg:sticky lg:top-header lg:self-start">
					<RuleTestPanel
						name={draft.name}
						condition={draft.condition}
						actions={draft.actions}
						ruleId={rule?.id}
					/>
				</div>
			</div>

			{rule ? (
				<RuleRunsDrawer
					open={runsOpen}
					onOpenChange={setRunsOpen}
					ruleId={rule.id}
					ruleName={rule.name}
				/>
			) : null}
		</>
	);
}
