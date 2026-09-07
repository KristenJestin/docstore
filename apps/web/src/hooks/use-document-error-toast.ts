import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { toast } from "sonner";

import { isTrashedDocumentError, toastApiError } from "@/lib/api-error";
import { orpc } from "@/utils/orpc";

/**
 * `toastApiError` for the writes of a document, with the way out attached: a
 * document in the trash refuses every edit (`CONFLICT`), so the toast carries
 * a "Restore" button rather than leaving the user to find the trash filter.
 */
export function useDocumentErrorToast() {
	const queryClient = useQueryClient();
	const restore = useMutation(orpc.document.restore.mutationOptions());

	return useCallback(
		(error: unknown, fallback: string, documentId?: string) => {
			if (!documentId || !isTrashedDocumentError(error)) {
				toastApiError(error, fallback);
				return;
			}
			toastApiError(error, fallback, {
				action: {
					label: "Restore",
					onClick: () => {
						void restore
							.mutateAsync({ id: documentId })
							.then(async () => {
								await queryClient.invalidateQueries({
									queryKey: orpc.document.key(),
								});
								toast.success("Document restored.");
							})
							.catch((restoreError: unknown) => {
								toastApiError(
									restoreError,
									"The document could not be restored.",
								);
							});
					},
				},
			});
		},
		[queryClient, restore],
	);
}
