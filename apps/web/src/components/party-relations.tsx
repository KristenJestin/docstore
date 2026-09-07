import type {
	PartyDetail,
	PartyRelationKind,
	PartyRelationWithParty,
} from "@docstore/shared/party";
import { PARTY_RELATION_KINDS } from "@docstore/shared/party";
import { Button } from "@docstore/ui/components/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@docstore/ui/components/select";
import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	BabyIcon,
	BriefcaseIcon,
	ContactIcon,
	HeartIcon,
	type LucideIcon,
	NetworkIcon,
	PlusIcon,
	XIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { toastApiError } from "@/lib/api-error";
import { orpc } from "@/utils/orpc";

import { useConfirm } from "./confirm-dialog";
import { EmptyState } from "./empty-state";
import { IconLabel, iconLabelItems } from "./icon-label";
import { PartyPicker } from "./parties/party-picker";
import { PartyAvatar } from "./party-avatar";

/** English labels of the party relation kinds, capitalised. */
export const PARTY_RELATION_KIND_LABELS: Record<PartyRelationKind, string> = {
	works_at: "Works at",
	child_of: "Child of",
	spouse_of: "Spouse of",
	subsidiary_of: "Subsidiary of",
	contact_of: "Contact of",
};

export const PARTY_RELATION_KIND_ICONS: Record<PartyRelationKind, LucideIcon> =
	{
		works_at: BriefcaseIcon,
		child_of: BabyIcon,
		spouse_of: HeartIcon,
		subsidiary_of: NetworkIcon,
		contact_of: ContactIcon,
	};

const RELATION_KIND_ITEMS = iconLabelItems(
	PARTY_RELATION_KINDS,
	PARTY_RELATION_KIND_LABELS,
	PARTY_RELATION_KIND_ICONS,
);

export interface PartyRelationsProps {
	party: PartyDetail;
}

/** Outgoing and incoming relations of a party, with add and remove. */
export function PartyRelations({ party }: PartyRelationsProps) {
	const confirm = useConfirm();
	const [adding, setAdding] = useState(false);
	const [targetId, setTargetId] = useState<string | null>(null);
	const [kind, setKind] = useState<PartyRelationKind>("contact_of");

	const addRelation = useMutation(orpc.party.addRelation.mutationOptions());
	const removeRelation = useMutation(
		orpc.party.removeRelation.mutationOptions(),
	);

	const submit = async () => {
		if (!targetId) {
			return;
		}
		try {
			await addRelation.mutateAsync({
				fromPartyId: party.id,
				toPartyId: targetId,
				kind,
			});
			toast.success("Relation added.");
			setTargetId(null);
			setAdding(false);
		} catch (error) {
			toastApiError(error, "The relation could not be added.");
		}
	};

	const remove = async (relation: PartyRelationWithParty) => {
		const ok = await confirm({
			title: "Remove this relation?",
			description: `The link with "${relation.otherParty.name}" will be removed.`,
			confirmLabel: "Remove",
			destructive: true,
		});
		if (!ok) {
			return;
		}
		try {
			await removeRelation.mutateAsync({ id: relation.id });
			toast.success("Relation removed.");
		} catch (error) {
			toastApiError(error, "The relation could not be removed.");
		}
	};

	const hasRelations =
		party.relationsFrom.length > 0 || party.relationsTo.length > 0;

	return (
		<div className="flex flex-col gap-4">
			{hasRelations ? (
				<ul className="flex flex-col divide-y divide-border border-border border-t">
					{party.relationsFrom.map((relation) => (
						<RelationRow
							key={relation.id}
							relation={relation}
							prefix={PARTY_RELATION_KIND_LABELS[relation.kind]}
							onRemove={() => remove(relation)}
						/>
					))}
					{party.relationsTo.map((relation) => (
						<RelationRow
							key={relation.id}
							relation={relation}
							prefix={`${PARTY_RELATION_KIND_LABELS[relation.kind]} (incoming)`}
							onRemove={() => remove(relation)}
						/>
					))}
				</ul>
			) : (
				<EmptyState
					title="No relation"
					description={`No link recorded for ${party.name}.`}
				/>
			)}

			{adding ? (
				<div className="flex flex-col gap-3 rounded-xl border border-border bg-muted/40 p-3">
					<Select
						items={RELATION_KIND_ITEMS}
						value={kind}
						onValueChange={(value) => setKind(value as PartyRelationKind)}
					>
						<SelectTrigger className="w-full" aria-label="Relation kind">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{PARTY_RELATION_KINDS.map((value) => (
								<SelectItem key={value} value={value}>
									<IconLabel
										icon={PARTY_RELATION_KIND_ICONS[value]}
										label={PARTY_RELATION_KIND_LABELS[value]}
									/>
								</SelectItem>
							))}
						</SelectContent>
					</Select>

					<PartyPicker
						label="Related party"
						placeholder="Search for a party…"
						value={targetId}
						onValueChange={setTargetId}
						excludeIds={[party.id]}
					/>

					<div className="flex justify-end gap-2">
						<Button
							variant="ghost"
							size="sm"
							onClick={() => {
								setAdding(false);
								setTargetId(null);
							}}
						>
							Cancel
						</Button>
						<Button size="sm" disabled={!targetId} onClick={submit}>
							Add
						</Button>
					</div>
				</div>
			) : (
				<Button
					variant="outline"
					size="sm"
					className="self-start"
					onClick={() => setAdding(true)}
				>
					<PlusIcon />
					Add a relation
				</Button>
			)}
		</div>
	);
}

function RelationRow({
	relation,
	prefix,
	onRemove,
}: {
	relation: PartyRelationWithParty;
	prefix: string;
	onRemove: () => void;
}) {
	return (
		<li className="flex items-center gap-3 py-2.5">
			<PartyAvatar
				name={relation.otherParty.name}
				logoKey={relation.otherParty.logoKey}
				partyId={relation.otherParty.id}
				size="sm"
			/>
			<div className="min-w-0 flex-1">
				<Link
					to="/parties/$partyId"
					params={{ partyId: relation.otherParty.id }}
					className="block truncate text-sm hover:underline"
				>
					{relation.otherParty.name}
				</Link>
				<p className="mono-label">{prefix}</p>
			</div>
			<Button
				variant="ghost"
				size="icon-sm"
				aria-label={`Remove the relation with ${relation.otherParty.name}`}
				onClick={onRemove}
			>
				<XIcon />
			</Button>
		</li>
	);
}
