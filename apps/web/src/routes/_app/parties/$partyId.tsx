import type { PartyIdentifiers } from "@docstore/shared/party";
import { Badge } from "@docstore/ui/components/badge";
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "@docstore/ui/components/breadcrumb";
import { Button } from "@docstore/ui/components/button";
import { Card, CardContent, CardHeader } from "@docstore/ui/components/card";
import { Skeleton } from "@docstore/ui/components/skeleton";
import { Textarea } from "@docstore/ui/components/textarea";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
	ArchiveIcon,
	ArchiveRestoreIcon,
	ImageDownIcon,
	ImageOffIcon,
	MergeIcon,
	PencilIcon,
	Trash2Icon,
} from "lucide-react";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { useConfirm } from "@/components/confirm-dialog";
import { formatDate } from "@/components/date-text";
import { DocumentListForParty } from "@/components/documents/document-list-for-party";
import { EmptyState } from "@/components/empty-state";
import { MonoLabel } from "@/components/mono-label";
import { DetailSkeleton } from "@/components/page-skeletons";
import { PartyMergeDialog } from "@/components/parties/party-merge-dialog";
import { PartyAvatar } from "@/components/party-avatar";
import { PartyFormSheet } from "@/components/party-form-sheet";
import { PartyRelations } from "@/components/party-relations";
import { PartyTypeBadge } from "@/components/party-type-badge";
import { CopyButton } from "@/components/settings/copy-button";
import { isPartyInUseError, toastApiError } from "@/lib/api-error";
import {
	PARTY_IDENTIFIER_LABELS,
	PARTY_IDENTIFIER_ORDER,
} from "@/lib/party-form";
import { countLabel } from "@/lib/plural";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_app/parties/$partyId")({
	component: PartyDetailPage,
	pendingComponent: DetailSkeleton,
	loader: ({ context, params }) =>
		context.queryClient.ensureQueryData(
			context.orpc.party.get.queryOptions({ input: { id: params.partyId } }),
		),
});

function PartyDetailPage() {
	const { partyId } = Route.useParams();
	const navigate = useNavigate();
	const confirm = useConfirm();
	const [editOpen, setEditOpen] = useState(false);
	const [mergeOpen, setMergeOpen] = useState(false);

	const party = useQuery(
		orpc.party.get.queryOptions({ input: { id: partyId } }),
	);

	const archive = useMutation(orpc.party.archive.mutationOptions());
	const unarchive = useMutation(orpc.party.unarchive.mutationOptions());
	const remove = useMutation(orpc.party.delete.mutationOptions());
	const fetchLogo = useMutation(orpc.party.fetchLogo.mutationOptions());
	const removeLogo = useMutation(orpc.party.removeLogo.mutationOptions());

	if (party.isLoading) {
		return (
			<div className="flex flex-col gap-4 px-6 py-8 lg:px-8">
				<Skeleton className="h-10 w-64" />
				<Skeleton className="h-40 w-full" />
			</div>
		);
	}

	if (party.isError || !party.data) {
		return (
			<div className="px-6 py-8 lg:px-8">
				<EmptyState
					title="Party not found"
					description="This party may have been deleted."
					action={
						<Link to="/parties">
							<Button variant="outline">Back to parties</Button>
						</Link>
					}
				/>
			</div>
		);
	}

	const detail = party.data;
	const archived = detail.archivedAt !== null;
	const relationCount = detail.relationsFrom.length + detail.relationsTo.length;
	/** `party.fetchLogo` reads the favicon of the first declared domain. */
	const hasDomain = (detail.identifiers.domain ?? []).length > 0;

	const onArchive = async () => {
		try {
			if (archived) {
				await unarchive.mutateAsync({ id: detail.id });
				toast.success("Party unarchived.");
			} else {
				const ok = await confirm({
					title: "Archive this party?",
					description:
						"It will be hidden from the lists but its documents stay linked.",
					confirmLabel: "Archive",
				});
				if (!ok) {
					return;
				}
				await archive.mutateAsync({ id: detail.id });
				toast.success("Party archived.");
			}
		} catch (error) {
			toastApiError(error, "The operation failed.");
		}
	};

	const onFetchLogo = async () => {
		try {
			await fetchLogo.mutateAsync({ id: detail.id });
			toast.success("Logo fetched from the domain.");
		} catch (error) {
			toastApiError(error, "No logo could be fetched for this domain.");
		}
	};

	const onRemoveLogo = async () => {
		try {
			await removeLogo.mutateAsync({ id: detail.id });
			toast.success("Logo removed.");
		} catch (error) {
			toastApiError(error, "The logo could not be removed.");
		}
	};

	const onDelete = async () => {
		const ok = await confirm({
			title: "Delete this party?",
			description:
				"Deletion is permanent. It is refused while documents are still linked.",
			confirmLabel: "Delete",
			destructive: true,
		});
		if (!ok) {
			return;
		}
		try {
			await remove.mutateAsync({ id: detail.id });
			toast.success("Party deleted.");
			navigate({ to: "/parties" });
		} catch (error) {
			// Deleting is refused while documents point at it, and the way out is
			// usually not to detach them one by one but to merge the two parties.
			toastApiError(error, "The party could not be deleted.", {
				action: isPartyInUseError(error)
					? {
							label: "Merge into another party",
							onClick: () => setMergeOpen(true),
						}
					: undefined,
			});
		}
	};

	const identifiers = identifierChips(detail.identifiers);
	const stats = `${countLabel(detail.documentCount, "document")} · ${countLabel(
		relationCount,
		"relation",
	)} · Added ${formatDate(detail.createdAt)}`;

	return (
		<>
			<div className="flex flex-col gap-4 px-6 py-6 lg:px-8">
				<Breadcrumb>
					<BreadcrumbList className="font-mono text-xs">
						<BreadcrumbItem>
							<BreadcrumbLink render={<Link to="/parties" />}>
								Parties
							</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbPage>{detail.name}</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>

				<Card>
					<CardContent className="flex flex-col gap-5">
						<div className="flex flex-wrap items-start justify-between gap-4">
							<div className="flex min-w-0 items-start gap-4">
								<PartyAvatar
									name={detail.name}
									logoKey={detail.logoKey}
									partyId={detail.id}
									size="lg"
								/>
								<div className="flex min-w-0 flex-col gap-2">
									<h1 className="font-extrabold text-3xl leading-tight tracking-tight">
										{detail.name}
									</h1>
									<div className="flex flex-wrap items-center gap-2">
										<PartyTypeBadge type={detail.type} />
										{detail.isHouseholdMember ? (
											<Badge tone="info">Household member</Badge>
										) : null}
										{archived ? <Badge tone="neutral">Archived</Badge> : null}
										{detail.aliases.map((alias) => (
											<Badge key={alias} tone="outline">
												{alias}
											</Badge>
										))}
									</div>
									<p className="text-muted-foreground text-sm tabular-nums">
										{stats}
									</p>
								</div>
							</div>

							<div className="flex flex-wrap items-center gap-2">
								{detail.logoKey ? (
									<Button
										variant="ghost"
										size="sm"
										disabled={removeLogo.isPending}
										onClick={onRemoveLogo}
									>
										<ImageOffIcon />
										Remove logo
									</Button>
								) : hasDomain ? (
									<Button
										variant="ghost"
										size="sm"
										disabled={fetchLogo.isPending}
										onClick={onFetchLogo}
									>
										<ImageDownIcon />
										{fetchLogo.isPending ? "Fetching…" : "Fetch logo"}
									</Button>
								) : null}
								<Button variant="ghost" size="sm" onClick={onDelete}>
									<Trash2Icon />
									Delete
								</Button>
								<Button
									variant="outline"
									size="sm"
									onClick={() => setMergeOpen(true)}
								>
									<MergeIcon />
									Merge into…
								</Button>
								<Button variant="outline" size="sm" onClick={onArchive}>
									{archived ? <ArchiveRestoreIcon /> : <ArchiveIcon />}
									{archived ? "Unarchive" : "Archive"}
								</Button>
								<Button size="sm" onClick={() => setEditOpen(true)}>
									<PencilIcon />
									Edit
								</Button>
							</div>
						</div>

						{identifiers.length > 0 ? (
							<ul className="flex flex-wrap items-center gap-2 border-border border-t pt-4">
								{identifiers.map((chip) => (
									<li
										key={chip.id}
										className="flex min-w-0 items-center gap-2 rounded-lg bg-muted/60 py-1 pr-1 pl-2.5"
									>
										<span className="mono-label shrink-0">{chip.label}</span>
										<span className="min-w-0 truncate font-mono text-sm">
											{chip.value}
										</span>
										<CopyButton
											value={chip.value}
											label={`Copy the ${chip.label} of ${detail.name}`}
										/>
									</li>
								))}
							</ul>
						) : null}
					</CardContent>
				</Card>

				<PartyNotesCard partyId={detail.id} notes={detail.notes} />

				<Card>
					<CardHeader>
						<MonoLabel>Related parties</MonoLabel>
					</CardHeader>
					<CardContent>
						<PartyRelations party={detail} />
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<MonoLabel>Documents</MonoLabel>
					</CardHeader>
					<CardContent>
						<DocumentListForParty partyId={detail.id} partyName={detail.name} />
					</CardContent>
				</Card>
			</div>

			<PartyFormSheet
				open={editOpen}
				onOpenChange={setEditOpen}
				party={detail}
			/>

			<PartyMergeDialog
				open={mergeOpen}
				onOpenChange={setMergeOpen}
				sourceId={detail.id}
				onMerged={(result) =>
					navigate({
						to: "/parties/$partyId",
						params: { partyId: result.target.id },
					})
				}
			/>
		</>
	);
}

interface IdentifierChip {
	/** Stable key: the same value may be recorded under two kinds. */
	id: string;
	label: string;
	value: string;
}

/**
 * One chip per recorded value — the multi-valued kinds (domains, e-mail
 * addresses, phone numbers, IBANs) get one chip each so every one of them is
 * copyable on its own. A party without any identifier yields an empty list and
 * the band simply shows nothing there.
 */
function identifierChips(identifiers: PartyIdentifiers): IdentifierChip[] {
	return PARTY_IDENTIFIER_ORDER.flatMap((key) => {
		const raw = identifiers[key];
		if (!raw) {
			return [];
		}
		const label = PARTY_IDENTIFIER_LABELS[key];
		const values = Array.isArray(raw) ? raw : [raw];
		return values.map((value) => ({ id: `${key}:${value}`, label, value }));
	});
}

/** Free-text note of a party, saved through `party.update` when the field loses focus. */
function PartyNotesCard({
	partyId,
	notes,
}: {
	partyId: string;
	notes: string | null;
}) {
	const fieldId = useId();
	const update = useMutation(orpc.party.update.mutationOptions());
	const [draft, setDraft] = useState(notes ?? "");

	// The stored note wins whenever it changes elsewhere (edit sheet, refetch).
	useEffect(() => {
		setDraft(notes ?? "");
	}, [notes]);

	const save = async () => {
		const next = draft.trim();
		if (next === (notes ?? "")) {
			return;
		}
		setDraft(next);
		try {
			await update.mutateAsync({
				id: partyId,
				notes: next.length > 0 ? next : null,
			});
			toast.success("Notes saved.");
		} catch (error) {
			toastApiError(error, "The notes could not be saved.");
		}
	};

	return (
		<Card>
			<CardHeader>
				<label className="mono-label" htmlFor={fieldId}>
					Notes
				</label>
			</CardHeader>
			<CardContent>
				<Textarea
					id={fieldId}
					value={draft}
					onChange={(event) => setDraft(event.target.value)}
					onBlur={save}
					disabled={update.isPending}
					placeholder="Anything worth remembering about this party…"
					className="min-h-24"
				/>
			</CardContent>
		</Card>
	);
}
