import { Input as InputPrimitive } from "@base-ui/react/input";
import { cn } from "@docstore/ui/lib/utils";
import type * as React from "react";

/** Text input: `card` background, 1 px rim, yellow focus ring. */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
	return (
		<InputPrimitive
			type={type}
			data-slot="input"
			className={cn(
				"h-9 w-full min-w-0 rounded-lg bg-card px-3 py-2 text-foreground text-sm outline-none ring-1 ring-border transition-all duration-200 ease-premium file:inline-flex file:h-6 file:border-0 file:bg-transparent file:font-medium file:text-foreground file:text-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:ring-2 aria-invalid:ring-destructive md:text-sm",
				className,
			)}
			{...props}
		/>
	);
}

export { Input };
