import { cn } from "@docstore/ui/lib/utils";
import type * as React from "react";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
	return (
		<textarea
			data-slot="textarea"
			className={cn(
				"field-sizing-content flex min-h-16 w-full rounded-lg bg-card px-3 py-2 text-foreground text-sm outline-none ring-1 ring-border transition-all duration-200 ease-premium placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:ring-2 aria-invalid:ring-destructive md:text-sm",
				className,
			)}
			{...props}
		/>
	);
}

export { Textarea };
