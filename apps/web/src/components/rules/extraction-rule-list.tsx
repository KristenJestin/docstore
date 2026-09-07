import type { ExtractionRule } from "@docstore/shared/extraction";
import { Badge } from "@docstore/ui/components/badge";
import { Button } from "@docstore/ui/components/button";
import { Skeleton } from "@docstore/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { PlusIcon, ScanTextIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { useConfirm } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { toastApiError } from "@/lib/api-error";
import { orpc } from "@/utils/orpc";

import { EXTRACTION_TARGET_LABELS } from "./rule-labels";

export interface LayoutExtractionRulesProps {
	/** Document type owning the layout: the editor lives under its route. */
	documentTypeId: string;
	layoutId: string;
}

/**
 * Extraction rules of one layout (SPEC §9). A rule only exists inside a layout:
 * there is no standalone list any more, and "Add extraction rule" opens the
 * full editor prefilled with this layout.
 */
export function LayoutExtractionRules({
	documentTypeId,
	layoutId,
}: LayoutExtractionRulesProps) {
	const confirm = useConfirm();
	const queryClient = useQueryClient();

	const rules = useQuery(
		orpc.extractionRule.list.queryOptions({ input: { layoutId } }),
	);
	const fields = useQuery(orpc.customField.list.queryOptions({ input: {} }));
	const remove = useMutation(orpc.extractionRule.delete.mutationOptions());

	const targetLabel = (rule: ExtractionRule): string => {
		if (rule.target.kind !== "field") {
			return EXTRACTION_TARGET_LABELS[rule.target.kind];
		}
		const fieldId = rule.target.fieldId;
		return (
			fields.data?.find((item) => item.id === fieldId)?.name ?? "Custom field"
		);
	};

	const onDelete = async (rule: ExtractionRule) => {
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
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: orpc.extractionRule.key() }),
				queryClient.invalidateQueries({ queryKey: orpc.documentType.key() }),
			]);
			toast.success("Extraction rule deleted.");
		} catch (error) {
			toastApiError(error, "The extraction rule could not be deleted.");
		}
	};

	const items = rules.data ?? [];

	return (
		<div className="flex flex-col gap-3">
			{rules.isLoading ? (
				<Skeleton className="h-16 w-full" />
			) : items.length === 0 ? (
				<EmptyState
					size="sm"
					icon={ScanTextIcon}
					title="No extraction rule"
					description="An extraction rule finds a value in the text — an amount, a date, a reference — and writes it into a field of this layout."
				/>
			) : (
				<ul className="divide-y divide-border rounded-lg ring-1 ring-border">
					{items.map((rule) => (
						<li
							key={rule.id}
							className="group/row row-in flex items-center gap-3 px-3 py-2"
						>
							<div className="min-w-0 flex-1">
								<Link
									to="/types/$typeId/extraction/$extractionRuleId"
									params={{
										typeId: documentTypeId,
										extractionRuleId: rule.id,
									}}
									className="block truncate rounded-md font-medium text-sm hover:underline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
								>
									{rule.name}
								</Link>
								<p className="truncate text-muted-foreground text-xs">
									{targetLabel(rule)}
								</p>
							</div>
							<Badge tone="outline">{rule.strategy.kind}</Badge>
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label={`Delete ${rule.name}`}
								className="opacity-0 transition-opacity focus-visible:opacity-100 group-hover/row:opacity-100"
								onClick={() => onDelete(rule)}
							>
								<Trash2Icon />
							</Button>
						</li>
					))}
				</ul>
			)}

			<Button
				variant="outline"
				size="sm"
				className="self-start"
				nativeButton={false}
				render={
					<Link
						to="/types/$typeId/extraction/new"
						params={{ typeId: documentTypeId }}
						search={{ layoutId }}
					/>
				}
			>
				<PlusIcon />
				Add extraction rule
			</Button>
		</div>
	);
}
