import type {
	DocumentTypeDetail,
	DocumentTypeTitlePreview,
} from "@docstore/shared/document-type";
import { Button } from "@docstore/ui/components/button";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { TypeIcon } from "lucide-react";
import { toast } from "sonner";

import { useConfirm } from "@/components/confirm-dialog";
import { toastApiError } from "@/lib/api-error";
import { countLabel } from "@/lib/plural";
import { orpc } from "@/utils/orpc";

/** How many sample titles the confirmation shows. */
const PREVIEW_LIMIT = 5;

function PreviewList({ items }: { items: DocumentTypeTitlePreview[] }) {
	if (items.length === 0) {
		return (
			<span className="mt-2 block">
				No document of this type would be renamed.
			</span>
		);
	}
	return (
		<span className="mt-3 flex flex-col gap-1.5">
			{items.map((item) => (
				<span key={item.documentId} className="flex flex-col font-mono text-xs">
					<span className="text-muted-foreground line-through">
						{item.currentTitle}
					</span>
					<span>
						{item.title ?? "(the template renders nothing)"}
						{item.manual ? " — set by hand, kept" : ""}
					</span>
				</span>
			))}
		</span>
	);
}

export interface RegenerateTitlesButtonProps {
	detail: DocumentTypeDetail;
}

/**
 * "Regenerate titles" on the Overview tab of a document type: shows the first
 * {@link PREVIEW_LIMIT} titles the template would produce, then rewrites them.
 * Titles someone typed by hand are always kept.
 */
export function RegenerateTitlesButton({
	detail,
}: RegenerateTitlesButtonProps) {
	const queryClient = useQueryClient();
	const confirm = useConfirm();
	const regenerate = useMutation(
		orpc.documentType.regenerateTitles.mutationOptions(),
	);

	if (!detail.titleTemplate) {
		return null;
	}

	const onClick = async () => {
		let preview: DocumentTypeTitlePreview[] = [];
		try {
			preview = await queryClient.fetchQuery(
				orpc.documentType.previewTitles.queryOptions({
					input: { id: detail.id, limit: PREVIEW_LIMIT },
				}),
			);
		} catch (error) {
			toastApiError(error, "The titles could not be previewed.");
			return;
		}

		const ok = await confirm({
			title: `Regenerate the titles of "${detail.name}"?`,
			description: (
				<>
					<span className="block">
						Every document of this type is renamed from{" "}
						<span className="font-mono">{detail.titleTemplate}</span>. Titles
						set by hand are kept.
					</span>
					<PreviewList items={preview} />
				</>
			),
			confirmLabel: "Regenerate titles",
		});
		if (!ok) {
			return;
		}

		try {
			const result = await regenerate.mutateAsync({ id: detail.id });
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: orpc.documentType.key() }),
				queryClient.invalidateQueries({ queryKey: orpc.document.key() }),
			]);
			toast.success(
				`${countLabel(result.updated, "title")} rewritten, ${result.skipped} left alone.`,
			);
		} catch (error) {
			toastApiError(error, "The titles could not be regenerated.");
		}
	};

	return (
		<Button
			variant="outline"
			size="sm"
			disabled={regenerate.isPending}
			onClick={onClick}
		>
			<TypeIcon />
			Regenerate titles
		</Button>
	);
}
