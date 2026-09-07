import { cn } from "@docstore/ui/lib/utils";
import { FileTextIcon, LockIcon } from "lucide-react";
import { useState } from "react";

import { fileIdFromThumbnailKey, fileThumbnailUrl } from "@/lib/file-urls";

const SIZE_CLASSES = {
	sm: "size-8",
	md: "size-10",
	lg: "size-14",
} as const;

export interface DocumentThumbnailProps {
	/** `thumbnailKey` from `document.list`; the file id is derived from it. */
	thumbnailKey?: string | null;
	/** Direct file id (detail page). Takes precedence. */
	fileId?: string | null;
	/** A padlock replaces the default icon for a sensitive document. */
	sensitive?: boolean;
	size?: keyof typeof SIZE_CLASSES;
	className?: string;
}

/**
 * Square rimmed thumbnail from prototype B: the first file image when it
 * exists, otherwise a fallback icon (padlock when the document is sensitive).
 */
export function DocumentThumbnail({
	thumbnailKey,
	fileId,
	sensitive = false,
	size = "md",
	className,
}: DocumentThumbnailProps) {
	const resolvedId = fileId ?? fileIdFromThumbnailKey(thumbnailKey);
	// Remembering the failed id (instead of a boolean) resets the fallback on
	// its own whenever the thumbnail changes.
	const [failedId, setFailedId] = useState<string | null>(null);

	const frame = cn(
		"flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted ring-1 ring-border",
		SIZE_CLASSES[size],
		className,
	);

	if (!resolvedId || failedId === resolvedId) {
		const Icon = sensitive ? LockIcon : FileTextIcon;
		return (
			<span aria-hidden className={frame}>
				<Icon className="size-4 text-muted-foreground" strokeWidth={1.5} />
			</span>
		);
	}

	return (
		<img
			src={fileThumbnailUrl(resolvedId)}
			alt=""
			aria-hidden
			loading="lazy"
			onError={() => setFailedId(resolvedId)}
			className={cn(frame, "object-cover")}
		/>
	);
}
