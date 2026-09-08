import type {
	DocumentListItem,
	DocumentPartyLink,
} from "@docstore/shared/document";
import { cn } from "@docstore/ui/lib/utils";
import { LockIcon } from "lucide-react";
import type { ReactNode } from "react";

import { PartyAvatar } from "../party-avatar";
import { DocumentStatusBadge } from "./document-badges";
import { DocumentThumbnail } from "./document-thumbnail";

/** Issuing party when it exists, otherwise the first linked party. */
export function documentIssuer(
	item: DocumentListItem,
): DocumentPartyLink | null {
	return (
		item.parties.find((party) => party.role === "issuer") ??
		item.parties[0] ??
		null
	);
}

export interface DocumentTitleCellProps {
	item: DocumentListItem;
	/** Thumbnail size (`sm` in compact lists). */
	size?: "sm" | "md";
}

/**
 * Thumbnail + title + issuing party: the identity block of a document, shared
 * by the main list and the compact lists.
 */
export function DocumentTitleCell({
	item,
	size = "md",
}: DocumentTitleCellProps) {
	const issuer = documentIssuer(item);

	return (
		<div className="flex min-w-0 items-center gap-3">
			<DocumentThumbnail
				thumbnailKey={item.thumbnailKey}
				sensitive={item.sensitive}
				mime={item.mime}
				size={size}
			/>
			<div className="min-w-0">
				<p className="flex items-center gap-1.5 truncate font-semibold text-sm">
					<span className="truncate">{item.title}</span>
					{item.sensitive ? (
						<LockIcon
							aria-label="Sensitive document"
							className="size-3.5 shrink-0 text-tone-danger-foreground"
						/>
					) : null}
					{item.status === "processing" || item.status === "review" ? (
						<DocumentStatusBadge status={item.status} />
					) : null}
				</p>
				{issuer ? (
					<span className="mt-0.5 flex items-center gap-1.5 text-muted-foreground text-xs">
						<PartyAvatar
							name={issuer.name}
							logoKey={issuer.logoKey}
							partyId={issuer.id}
							size="sm"
							className="size-4 text-xs"
						/>
						<span className="truncate">{issuer.name}</span>
					</span>
				) : (
					<span className="mt-0.5 block truncate text-muted-foreground text-xs">
						No party
					</span>
				)}
			</div>
		</div>
	);
}

export interface DocumentRowProps {
	item: DocumentListItem;
	onOpen: (item: DocumentListItem) => void;
	/** Block aligned to the right: date, confidence badge, action… */
	trailing?: ReactNode;
	className?: string;
}

/**
 * Compact clickable document row (dashboard, review queue, documents of a
 * party). The main list uses `DataList` instead.
 */
export function DocumentRow({
	item,
	onOpen,
	trailing,
	className,
}: DocumentRowProps) {
	return (
		<button
			type="button"
			aria-label={`Open ${item.title}`}
			onClick={() => onOpen(item)}
			className={cn(
				"flex w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left transition-colors duration-200 ease-premium hover:bg-muted/70 focus-visible:bg-accent focus-visible:outline-none",
				className,
			)}
		>
			<span className="min-w-0 flex-1">
				<DocumentTitleCell item={item} size="sm" />
			</span>
			{trailing ? <span className="shrink-0">{trailing}</span> : null}
		</button>
	);
}
