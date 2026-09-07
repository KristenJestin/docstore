import type {
	PartyDuplicate,
	PartyDuplicateReason,
} from "@docstore/shared/party";
import { Badge } from "@docstore/ui/components/badge";
import { Button } from "@docstore/ui/components/button";
import { Skeleton } from "@docstore/ui/components/skeleton";
import { Switch } from "@docstore/ui/components/switch";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CopyCheckIcon } from "lucide-react";
import { useId, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { MonoLabel } from "@/components/mono-label";
import { PartyMergeDialog } from "@/components/parties/party-merge-dialog";
import { PartyAvatar } from "@/components/party-avatar";
import { countLabel } from "@/lib/plural";
import { orpc } from "@/utils/orpc";

/** Why the pair is flagged. */
export const PARTY_DUPLICATE_REASON_LABELS: Record<
	PartyDuplicateReason,
	string
> = {
	sameDomain: "Same domain",
	sameName: "Same name",
};

function pairKey(pair: PartyDuplicate): string {
	return `${pair.partyId}:${pair.otherPartyId}`;
}

/** Which way round a merge goes, once a direction has been picked. */
interface MergeDraft {
	sourceId: string;
	targetId: string;
}

/**
 * "Duplicates" panel of `/parties`: pairs returned by `party.duplicates` with
 * the reason they were flagged (a shared domain, or the same name), then
 * "Merge A into B", "Merge B into A" — both opening `PartyMergeDialog` — and
 * "Ignore".
 *
 * Ignoring is deliberately local: there is no API for it, so a dismissed pair
 * only stays hidden for as long as the panel is open. "Show ignored" brings
 * them back.
 */
export function PartyDuplicatesPanel({ onClose }: { onClose: () => void }) {
	const ids = useId();
	const [ignored, setIgnored] = useState<string[]>([]);
	const [showIgnored, setShowIgnored] = useState(false);
	const [merging, setMerging] = useState<MergeDraft | null>(null);

	const duplicates = useQuery(
		orpc.party.duplicates.queryOptions({ input: {} }),
	);

	const all = duplicates.data ?? [];
	const pairs = showIgnored
		? all
		: all.filter((pair) => !ignored.includes(pairKey(pair)));

	return (
		<div className="shell mx-6 mt-6 lg:mx-8">
			<div className="overflow-hidden rounded-xl bg-card shadow-soft ring-1 ring-border">
				<div className="flex flex-wrap items-center gap-2 border-border border-b px-4 py-3">
					<CopyCheckIcon
						aria-hidden
						className="size-4 text-muted-foreground"
						strokeWidth={1.5}
					/>
					<MonoLabel>Duplicates</MonoLabel>
					<p className="text-muted-foreground text-xs">
						Parties sharing a domain, or carrying the same name.
					</p>
					<div className="ml-auto flex items-center gap-2">
						<label
							htmlFor={`${ids}-ignored`}
							className="text-muted-foreground text-xs"
						>
							Show ignored
						</label>
						<Switch
							id={`${ids}-ignored`}
							aria-label="Show ignored"
							checked={showIgnored}
							onCheckedChange={setShowIgnored}
						/>
						<Button variant="ghost" size="sm" onClick={onClose}>
							Hide
						</Button>
					</div>
				</div>

				{duplicates.isLoading ? (
					<div className="flex flex-col gap-2 p-4">
						{[0, 1].map((index) => (
							<Skeleton key={index} className="h-12 w-full" />
						))}
					</div>
				) : pairs.length === 0 ? (
					<div className="p-3">
						<EmptyState
							size="sm"
							title="No duplicate"
							description="Every party in the directory looks unique."
						/>
					</div>
				) : (
					<ul className="divide-y divide-border">
						{pairs.map((pair) => {
							const key = pairKey(pair);
							return (
								<li
									key={key}
									className="flex flex-wrap items-center gap-3 px-4 py-3"
								>
									<div className="flex min-w-0 flex-1 items-center gap-2">
										<DuplicateSide
											side="A"
											partyId={pair.partyId}
											name={pair.partyName}
											documentCount={pair.partyDocumentCount}
										/>
										<DuplicateSide
											side="B"
											partyId={pair.otherPartyId}
											name={pair.otherPartyName}
											documentCount={pair.otherPartyDocumentCount}
										/>
									</div>
									<Badge tone="warning">
										{PARTY_DUPLICATE_REASON_LABELS[pair.reason]}
									</Badge>
									<Badge tone="outline">{pair.value}</Badge>
									{ignored.includes(key) ? (
										<Badge tone="neutral">Ignored</Badge>
									) : null}
									<Button
										variant="outline"
										size="sm"
										// The visible label opens the accessible one (WCAG 2.5.3),
										// which then says which party is which.
										aria-label={`Merge A into B: ${pair.partyName} into ${pair.otherPartyName}`}
										onClick={() =>
											setMerging({
												sourceId: pair.partyId,
												targetId: pair.otherPartyId,
											})
										}
									>
										Merge A into B
									</Button>
									<Button
										variant="outline"
										size="sm"
										aria-label={`Merge B into A: ${pair.otherPartyName} into ${pair.partyName}`}
										onClick={() =>
											setMerging({
												sourceId: pair.otherPartyId,
												targetId: pair.partyId,
											})
										}
									>
										Merge B into A
									</Button>
									{ignored.includes(key) ? (
										<Button
											variant="ghost"
											size="sm"
											onClick={() =>
												setIgnored((current) =>
													current.filter((entry) => entry !== key),
												)
											}
										>
											Unignore
										</Button>
									) : (
										<Button
											variant="ghost"
											size="sm"
											onClick={() => setIgnored((current) => [...current, key])}
										>
											Ignore
										</Button>
									)}
								</li>
							);
						})}
					</ul>
				)}
			</div>

			{merging ? (
				<PartyMergeDialog
					open
					onOpenChange={(open) => {
						if (!open) {
							setMerging(null);
						}
					}}
					sourceId={merging.sourceId}
					initialTargetId={merging.targetId}
				/>
			) : null}
		</div>
	);
}

/** One side of a pair: everything comes from `party.duplicates`. */
function DuplicateSide({
	side,
	partyId,
	name,
	documentCount,
}: {
	side: "A" | "B";
	partyId: string;
	name: string;
	documentCount: number;
}) {
	return (
		<div className="flex min-w-0 flex-1 items-center gap-2">
			<span className="mono-label shrink-0">{side}</span>
			<PartyAvatar name={name} partyId={partyId} size="sm" />
			<div className="min-w-0">
				<Link
					to="/parties/$partyId"
					params={{ partyId }}
					className="block truncate text-sm hover:underline"
				>
					{name}
				</Link>
				<p className="text-muted-foreground text-xs tabular-nums">
					{countLabel(documentCount, "document")}
				</p>
			</div>
		</div>
	);
}
