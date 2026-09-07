import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cn } from "@docstore/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import { LockIcon } from "lucide-react";

/**
 * Prototype B "pill" badge: rounded, ~12% tinted background, inner rim in the
 * same hue. Allowed tones: neutral, success (emerald), warning (amber), info
 * (sky), danger (red) and the yellow accent.
 */
const badgeVariants = cva(
	"group/badge inset-ring inset-ring-current/20 inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden whitespace-nowrap rounded-full px-2 py-0.5 font-medium text-xs leading-5 transition-colors focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 [&>svg]:pointer-events-none [&>svg]:size-3!",
	{
		variants: {
			tone: {
				neutral: "bg-tone-neutral text-tone-neutral-foreground",
				success: "bg-tone-success text-tone-success-foreground",
				warning: "bg-tone-warning text-tone-warning-foreground",
				danger: "bg-tone-danger text-tone-danger-foreground",
				info: "bg-tone-info text-tone-info-foreground",
				primary: "bg-selection text-selection-foreground",
				sensitive: "bg-tone-danger text-tone-danger-foreground",
				outline: "inset-ring-border bg-card text-muted-foreground",
				solid: "inset-ring-transparent bg-primary text-primary-foreground",
			},
		},
		defaultVariants: {
			tone: "neutral",
		},
	},
);

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>["tone"]>;

function Badge({
	className,
	tone = "neutral",
	render,
	children,
	...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
	return useRender({
		defaultTagName: "span",
		props: mergeProps<"span">(
			{
				className: cn(badgeVariants({ tone }), className),
				children: (
					<>
						{tone === "sensitive" ? <LockIcon aria-hidden /> : null}
						{children}
					</>
				),
			},
			props,
		),
		render,
		state: {
			slot: "badge",
			tone,
		},
	});
}

export { Badge, badgeVariants };
