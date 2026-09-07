import type {
	DocumentListItem,
	DocumentRelationLink,
} from "@docstore/shared/document";
import type { DocumentRelationKind } from "@docstore/shared/relation";
import { DOCUMENT_RELATION_KINDS } from "@docstore/shared/relation";
import { Badge } from "@docstore/ui/components/badge";
import { Button } from "@docstore/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@docstore/ui/components/dialog";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@docstore/ui/components/select";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { PlusIcon, XIcon } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";

import { useConfirm } from "@/components/confirm-dialog";
import { DateText } from "@/components/date-text";
import { FormField } from "@/components/form-field";
import { IconLabel, iconLabelItems } from "@/components/icon-label";
import { TestDocumentPicker } from "@/components/rules/test-document-picker";
import { toastApiError } from "@/lib/api-error";
import { orpc } from "@/utils/orpc";

import {
	DOCUMENT_RELATION_KIND_ICONS,
	DOCUMENT_RELATION_KIND_TITLES,
} from "./document-labels";

const RELATION_KIND_ITEMS = iconLabelItems(
	DOCUMENT_RELATION_KINDS,
	DOCUMENT_RELATION_KIND_TITLES,
	DOCUMENT_RELATION_KIND_ICONS,
);

/**
 * Sentence form of a relation seen from the current document: the outgoing
 * direction reads as written, the incoming one is prefixed.
 */
function relationLabel(relation: DocumentRelationLink): string {
	const kind = DOCUMENT_RELATION_KIND_TITLES[relation.kind];
	return relation.direction === "outgoing" ? kind : `${kind} (incoming)`;
}

export interface DocumentRelationsCardProps {
	documentId: string;
	relations: DocumentRelationLink[];
}

/** "Related documents" card: list, add through a picker, remove. */
export function DocumentRelationsCard({
	documentId,
	relations,
}: DocumentRelationsCardProps) {
	const ids = useId();
	const queryClient = useQueryClient();
	const confirm = useConfirm();

	const [adding, setAdding] = useState(false);
	const [target, setTarget] = useState<DocumentListItem | null>(null);
	const [kind, setKind] = useState<DocumentRelationKind>("related_to");

	const addRelation = useMutation(orpc.document.addRelation.mutationOptions());
	const removeRelation = useMutation(
		orpc.document.removeRelation.mutationOptions(),
	);

	const invalidate = () =>
		queryClient.invalidateQueries({ queryKey: orpc.document.key() });

	const submit = async () => {
		if (!target) {
			return;
		}
		try {
			await addRelation.mutateAsync({
				fromDocumentId: documentId,
				toDocumentId: target.id,
				kind,
			});
			await invalidate();
			toast.success("Relation added.");
			setAdding(false);
			setTarget(null);
		} catch (error) {
			toastApiError(error, "The relation could not be added.");
		}
	};

	const remove = async (relation: DocumentRelationLink) => {
		const ok = await confirm({
			title: "Remove this relation?",
			description: `The link with "${relation.document.title}" will be removed.`,
			confirmLabel: "Remove",
			destructive: true,
		});
		if (!ok) {
			return;
		}
		try {
			await removeRelation.mutateAsync({ id: relation.id });
			await invalidate();
			toast.success("Relation removed.");
		} catch (error) {
			toastApiError(error, "The relation could not be removed.");
		}
	};

	return (
		<div className="flex flex-col gap-3">
			{relations.length === 0 ? (
				<p className="text-muted-foreground text-xs">
					This document is not linked to any other one.
				</p>
			) : (
				<ul className="flex flex-col divide-y divide-border border-border border-t">
					{relations.map((relation) => {
						const RelationIcon = DOCUMENT_RELATION_KIND_ICONS[relation.kind];
						return (
							<li key={relation.id} className="flex items-center gap-2 py-2.5">
								<div className="min-w-0 flex-1">
									<Link
										to="/documents/$documentId"
										params={{ documentId: relation.document.id }}
										className="block truncate text-sm hover:underline"
									>
										{relation.document.title}
									</Link>
									<span className="flex items-center gap-2">
										<Badge tone="outline">
											<RelationIcon aria-hidden />
											{relationLabel(relation)}
										</Badge>
										<DateText
											value={relation.document.documentDate}
											precision={relation.document.datePrecision}
										/>
									</span>
								</div>
								<Button
									variant="ghost"
									size="icon-sm"
									aria-label={`Remove the relation with ${relation.document.title}`}
									onClick={() => remove(relation)}
								>
									<XIcon />
								</Button>
							</li>
						);
					})}
				</ul>
			)}

			<Button
				variant="outline"
				size="sm"
				className="self-start"
				onClick={() => setAdding(true)}
			>
				<PlusIcon />
				Add a relation
			</Button>

			<Dialog open={adding} onOpenChange={setAdding}>
				<DialogContent className="sm:max-w-lg">
					<DialogHeader>
						<DialogTitle>Add a relation</DialogTitle>
						<DialogDescription>
							Link this document to another one: a newer version, a page, a
							replacement or the invoice that fulfills a contract.
						</DialogDescription>
					</DialogHeader>

					<FormField label="Relation" htmlFor={`${ids}-kind`}>
						<Select
							items={RELATION_KIND_ITEMS}
							value={kind}
							onValueChange={(value) => setKind(value as DocumentRelationKind)}
						>
							<SelectTrigger id={`${ids}-kind`} className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{DOCUMENT_RELATION_KINDS.map((value) => (
									<SelectItem key={value} value={value}>
										<IconLabel
											icon={DOCUMENT_RELATION_KIND_ICONS[value]}
											label={DOCUMENT_RELATION_KIND_TITLES[value]}
										/>
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</FormField>

					<FormField label="Other document" htmlFor={`${ids}-document`}>
						<TestDocumentPicker
							id={`${ids}-document`}
							label="Other document"
							excludeId={documentId}
							value={target}
							onValueChange={setTarget}
						/>
					</FormField>

					<DialogFooter>
						<Button variant="outline" onClick={() => setAdding(false)}>
							Cancel
						</Button>
						<Button
							disabled={!target || target.id === documentId}
							onClick={submit}
						>
							Add relation
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
