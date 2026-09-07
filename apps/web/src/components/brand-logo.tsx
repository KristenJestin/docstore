import { cn } from "@docstore/ui/lib/utils";

/**
 * Brand mark (proposal 05 "Onglet jaune" of `prototypes/logos.html`): a plain
 * document card marked by a yellow tab protruding from its right edge — the
 * tag one sticks on a document to file and retrieve it, which is the promise
 * of automatic classification and extraction.
 *
 * The document body and its cut lines follow the theme (`--foreground` /
 * `--background`) so the mark reads on both dark and light surfaces; the tab
 * stays the single yellow accent (`--primary`).
 *
 * Everything about the identity lives in this single file — symbol, wordmark
 * and the favicon copy in `public/favicon.svg` — so swapping the mark later is
 * a one-file change.
 */

const SYMBOL_SIZES = {
	sm: "size-6",
	md: "size-8",
	lg: "size-12",
	xl: "size-16",
} as const;

const WORDMARK_SIZES = {
	sm: "text-sm",
	md: "text-base",
	lg: "text-2xl",
	xl: "text-4xl",
} as const;

const GAP_SIZES = {
	sm: "gap-2",
	md: "gap-2.5",
	lg: "gap-3",
	xl: "gap-4",
} as const;

export type BrandLogoSize = keyof typeof SYMBOL_SIZES;

export interface BrandSymbolProps {
	size?: BrandLogoSize;
	/** Set when the wordmark next to it already carries the name. */
	decorative?: boolean;
	className?: string;
}

/** Symbol alone: document card, yellow tab. Square, readable down to 16 px. */
export function BrandSymbol({
	size = "md",
	decorative = false,
	className,
}: BrandSymbolProps) {
	return (
		<svg
			viewBox="0 0 64 64"
			xmlns="http://www.w3.org/2000/svg"
			role={decorative ? "presentation" : "img"}
			aria-hidden={decorative || undefined}
			aria-label={decorative ? undefined : "docstore"}
			className={cn("shrink-0", SYMBOL_SIZES[size], className)}
		>
			<rect
				x="9"
				y="4"
				width="40"
				height="56"
				rx="6"
				fill="var(--foreground)"
			/>
			<rect
				x="18"
				y="38"
				width="20"
				height="5"
				rx="2.5"
				fill="var(--background)"
				opacity=".55"
			/>
			<rect
				x="18"
				y="48"
				width="13"
				height="5"
				rx="2.5"
				fill="var(--background)"
				opacity=".55"
			/>
			<rect
				x="35"
				y="14"
				width="26"
				height="16"
				rx="4"
				fill="var(--background)"
			/>
			<rect
				x="38"
				y="17"
				width="20"
				height="10"
				rx="2.5"
				fill="var(--primary)"
			/>
		</svg>
	);
}

export interface BrandLogoProps {
	size?: BrandLogoSize;
	/** Hides the "docstore" wordmark and keeps the symbol alone. */
	symbolOnly?: boolean;
	/** Line shown under the wordmark ("Document management"). */
	tagline?: string;
	className?: string;
}

/** Lockup: symbol + "docstore" wordmark, optionally a tagline underneath. */
export function BrandLogo({
	size = "md",
	symbolOnly = false,
	tagline,
	className,
}: BrandLogoProps) {
	if (symbolOnly) {
		return <BrandSymbol size={size} className={className} />;
	}
	return (
		<span className={cn("flex items-center", GAP_SIZES[size], className)}>
			<BrandSymbol size={size} decorative />
			<span className="min-w-0">
				<span
					className={cn(
						"block truncate font-extrabold tracking-tight",
						WORDMARK_SIZES[size],
					)}
				>
					docstore
				</span>
				{tagline ? (
					<span className="block truncate text-muted-foreground text-xs">
						{tagline}
					</span>
				) : null}
			</span>
		</span>
	);
}
