import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cn } from "@docstore/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";

/**
 * "Premium" theme button: yellow primary with night-blue text, a 1 px `ring`
 * rim, very light relief and the `ease-premium` transition.
 */
const buttonVariants = cva(
	"group/button inline-flex shrink-0 cursor-pointer select-none items-center justify-center whitespace-nowrap rounded-lg font-medium text-sm leading-none outline-none transition-all duration-200 ease-premium focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 active:scale-98 disabled:pointer-events-none disabled:opacity-50 aria-invalid:ring-1 aria-invalid:ring-destructive [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
	{
		variants: {
			variant: {
				default:
					"bg-primary text-primary-foreground shadow-btn hover:bg-primary-hover",
				outline:
					"bg-card text-foreground shadow-btn ring-1 ring-border hover:bg-accent hover:text-accent-foreground aria-expanded:bg-accent",
				secondary:
					"bg-secondary text-secondary-foreground shadow-btn ring-1 ring-border hover:bg-accent hover:text-accent-foreground aria-expanded:bg-accent",
				ghost:
					"text-muted-foreground hover:bg-accent hover:text-accent-foreground aria-expanded:bg-accent aria-expanded:text-accent-foreground",
				destructive:
					"bg-tone-danger text-tone-danger-foreground ring-1 ring-destructive/25 hover:bg-destructive hover:text-destructive-foreground focus-visible:outline-destructive",
				link: "text-foreground underline-offset-4 hover:underline",
			},
			size: {
				default: "h-9 gap-2 px-4",
				sm: "h-8 gap-1.5 rounded-md px-3 text-xs [&_svg:not([class*='size-'])]:size-3.5",
				lg: "h-10 gap-2 px-5",
				icon: "size-9",
				"icon-sm": "size-8 rounded-md [&_svg:not([class*='size-'])]:size-3.5",
				"icon-lg": "size-10",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	},
);

function Button({
	className,
	variant = "default",
	size = "default",
	...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
	return (
		<ButtonPrimitive
			data-slot="button"
			className={cn(buttonVariants({ variant, size, className }))}
			{...props}
		/>
	);
}

export { Button, buttonVariants };
