import { cn } from "@docstore/ui/lib/utils";

import { partyLogoUrl } from "@/lib/file-urls";

const SIZE_CLASSES = {
	sm: "size-6 text-xs",
	md: "size-8 text-xs",
	lg: "size-16 text-2xl",
} as const;

/** One or two capitals taken from the name: "Free" → F, "Nordwind Digital" → ND. */
export function initialsForName(name: string, max = 2): string {
	const words = name
		.trim()
		.split(/[\s—–-]+/)
		.filter((word) => word.length > 0);
	const [first, second] = words;
	if (!first) {
		return "?";
	}
	if (!second || max === 1) {
		return first.slice(0, max).toUpperCase();
	}
	return `${first.slice(0, 1)}${second.slice(0, 1)}`.toUpperCase();
}

export interface PartyAvatarProps {
	name: string;
	/**
	 * Logo key: either an absolute URL or a storage key written by
	 * `party.uploadLogo` / `party.fetchLogo`. A storage key is served by
	 * `GET /parties/:id/logo`, so `partyId` is required to render it.
	 */
	logoKey?: string | null;
	/** Id of the party carrying `logoKey`, needed for stored logos. */
	partyId?: string;
	size?: keyof typeof SIZE_CLASSES;
	className?: string;
}

/** Absolute URL of the logo, or `null` when the initials must be used. */
function logoSrc(
	logoKey: string | null | undefined,
	partyId: string | undefined,
): string | null {
	if (!logoKey) {
		return null;
	}
	if (logoKey.startsWith("http")) {
		return logoKey;
	}
	return partyId ? partyLogoUrl(partyId, logoKey) : null;
}

/**
 * Round chip: the logo when available, otherwise the initials on a `muted`
 * background ringed by a 1 px rim. Initials use `selection-foreground`: yellow
 * in dark mode, dark ink in light mode.
 */
export function PartyAvatar({
	name,
	logoKey,
	partyId,
	size = "md",
	className,
}: PartyAvatarProps) {
	const src = logoSrc(logoKey, partyId);

	if (src) {
		return (
			<img
				src={src}
				alt=""
				aria-hidden
				className={cn(
					"shrink-0 rounded-full bg-card object-contain ring-1 ring-border",
					SIZE_CLASSES[size],
					className,
				)}
			/>
		);
	}

	return (
		<span
			aria-hidden
			className={cn(
				"flex shrink-0 select-none items-center justify-center rounded-full bg-muted font-bold text-selection-foreground tracking-tight ring-1 ring-border",
				SIZE_CLASSES[size],
				className,
			)}
		>
			{initialsForName(name, size === "sm" ? 1 : 2)}
		</span>
	);
}
