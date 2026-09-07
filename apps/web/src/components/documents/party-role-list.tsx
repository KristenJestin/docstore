import type {
	DocumentPartyLink,
	DocumentPartyRole,
} from "@docstore/shared/document";
import { DOCUMENT_PARTY_ROLES } from "@docstore/shared/document";
import { Badge } from "@docstore/ui/components/badge";
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
import { PlusIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { IconLabel, iconLabelItems } from "@/components/icon-label";
import { PartyPicker } from "@/components/parties/party-picker";
import { toastApiError } from "@/lib/api-error";
import { orpc } from "@/utils/orpc";

import { PartyAvatar } from "../party-avatar";
import { PARTY_TYPE_LABELS } from "../party-type-badge";
import { AssignmentSourceBadge } from "./document-badges";
import {
	DOCUMENT_PARTY_ROLE_ICONS,
	DOCUMENT_PARTY_ROLE_LABELS,
} from "./document-labels";

const ROLE_ITEMS = iconLabelItems(
	DOCUMENT_PARTY_ROLES,
	DOCUMENT_PARTY_ROLE_LABELS,
	DOCUMENT_PARTY_ROLE_ICONS,
);

export interface PartyRoleListProps {
	documentId: string;
	parties: DocumentPartyLink[];
}

/**
 * Parties linked to a document with their role (SPEC §2 "DocumentParty"):
 * add through a combobox + role, remove, and an "auto" badge when the
 * assignment comes from a rule or an MCP agent.
 */
export function PartyRoleList({ documentId, parties }: PartyRoleListProps) {
	const [adding, setAdding] = useState(false);
	const [targetId, setTargetId] = useState<string | null>(null);
	const [role, setRole] = useState<DocumentPartyRole>("issuer");

	const addParty = useMutation(orpc.document.addParty.mutationOptions());
	const removeParty = useMutation(orpc.document.removeParty.mutationOptions());

	const submit = async () => {
		if (!targetId) {
			return;
		}
		try {
			await addParty.mutateAsync({ id: documentId, partyId: targetId, role });
			toast.success("Party linked to the document.");
			setTargetId(null);
			setAdding(false);
		} catch (error) {
			toastApiError(error, "The party could not be linked.");
		}
	};

	const remove = async (link: DocumentPartyLink) => {
		try {
			await removeParty.mutateAsync({
				id: documentId,
				partyId: link.id,
				role: link.role,
			});
			toast.success("Party unlinked.");
		} catch (error) {
			toastApiError(error, "The party could not be unlinked.");
		}
	};

	return (
		<div className="flex flex-col gap-2">
			{parties.length === 0 ? (
				<p className="text-muted-foreground text-sm">
					No party linked to this document.
				</p>
			) : (
				<ul className="flex flex-col gap-2">
					{parties.map((link) => {
						const RoleIcon = DOCUMENT_PARTY_ROLE_ICONS[link.role];
						return (
							<li
								key={`${link.id}:${link.role}`}
								className="group/party flex items-center gap-3 rounded-lg bg-muted/50 px-3 py-2.5 ring-1 ring-border"
							>
								<PartyAvatar
									name={link.name}
									logoKey={link.logoKey}
									partyId={link.id}
								/>
								<div className="min-w-0 flex-1">
									<Link
										to="/parties/$partyId"
										params={{ partyId: link.id }}
										className="block truncate font-semibold text-sm hover:underline"
									>
										{link.name}
									</Link>
									<p className="truncate text-muted-foreground text-xs">
										{PARTY_TYPE_LABELS[link.type]}
									</p>
								</div>
								<AssignmentSourceBadge
									source={link.source}
									confidence={link.confidence}
								/>
								<Badge tone={link.role === "issuer" ? "primary" : "neutral"}>
									<RoleIcon aria-hidden />
									{DOCUMENT_PARTY_ROLE_LABELS[link.role]}
								</Badge>
								<Button
									variant="ghost"
									size="icon-sm"
									aria-label={`Unlink ${link.name}`}
									className="opacity-0 transition-opacity group-hover/party:opacity-100"
									onClick={() => remove(link)}
								>
									<XIcon />
								</Button>
							</li>
						);
					})}
				</ul>
			)}

			{adding ? (
				<div className="flex flex-col gap-3 rounded-xl border border-border bg-muted/40 p-3">
					<PartyPicker
						label="Party to link"
						placeholder="Search for a party…"
						value={targetId}
						onValueChange={setTargetId}
						excludeIds={parties
							.filter((link) => link.role === role)
							.map((link) => link.id)}
					/>

					<Select
						items={ROLE_ITEMS}
						value={role}
						onValueChange={(value) => setRole(value as DocumentPartyRole)}
					>
						<SelectTrigger className="w-full" aria-label="Party role">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{DOCUMENT_PARTY_ROLES.map((value) => (
								<SelectItem key={value} value={value}>
									<IconLabel
										icon={DOCUMENT_PARTY_ROLE_ICONS[value]}
										label={DOCUMENT_PARTY_ROLE_LABELS[value]}
									/>
								</SelectItem>
							))}
						</SelectContent>
					</Select>

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
							Link
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
					Link a party
				</Button>
			)}
		</div>
	);
}
