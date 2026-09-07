import type {
	ShareLink,
	ShareLinkRevokedReason,
} from "@docstore/shared/share-link";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { countLabel } from "@/lib/plural";
import { orpc } from "@/utils/orpc";

/**
 * Raising `sensitive` closes every public window on the document (see
 * `docs/security.md` §3): the API revokes the links of the document **and** of
 * the dossiers holding it, with the reason `sensitive`. The interface counts
 * them first so the confirmation says what is about to be lost.
 */

/** Why a link was revoked, as shown next to it in the share dialog. */
export const SHARE_REVOKED_REASON_LABELS: Record<
	ShareLinkRevokedReason,
	string
> = {
	manual: "Revoked by hand",
	sensitive: "Revoked automatically: document became sensitive",
};

/** Reads the still-active links and keeps the ones the caller cares about. */
export function useActiveShareLinks() {
	const queryClient = useQueryClient();
	return useCallback(
		async (matches: (link: ShareLink) => boolean): Promise<ShareLink[]> => {
			try {
				const links = await queryClient.fetchQuery(
					orpc.shareLink.list.queryOptions({
						input: { includeInactive: false },
					}),
				);
				return links.filter(matches);
			} catch {
				// The warning is a courtesy: a failed probe must not block the flag.
				return [];
			}
		},
		[queryClient],
	);
}

/** Extra line of the confirmation; `null` when no link would be revoked. */
export function shareRevocationWarning(count: number): string | null {
	if (count === 0) {
		return null;
	}
	return `${countLabel(count, "active share link")} will be revoked: a sensitive document never leaves the store through a public URL.`;
}
