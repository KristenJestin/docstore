import { cn } from "@docstore/ui/lib/utils";
import type * as React from "react";

/**
 * Section label: mono, spaced small caps (`.mono-label`). Used for page
 * kickers, card headings and column headers.
 */
export function MonoLabel({
	className,
	...props
}: React.ComponentProps<"span">) {
	return <span className={cn("mono-label", className)} {...props} />;
}
