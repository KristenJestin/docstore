import { cn } from "@docstore/ui/lib/utils";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export interface IconLabelProps {
	icon: LucideIcon;
	label: ReactNode;
	className?: string;
}

/**
 * Lucide icon followed by its label, the shape every enum takes inside a
 * `Select` option, a `Combobox` option or a `Badge`.
 */
export function IconLabel({ icon: Icon, label, className }: IconLabelProps) {
	return (
		<span className={cn("flex min-w-0 items-center gap-2", className)}>
			<Icon aria-hidden className="size-4 shrink-0" />
			<span className="truncate">{label}</span>
		</span>
	);
}

/**
 * Builds the `items` record a Base UI `Select` needs so that the closed trigger
 * shows the same icon + label as the open list.
 */
export function iconLabelItems<T extends string>(
	values: readonly T[],
	labels: Record<T, string>,
	icons: Record<T, LucideIcon>,
): Record<string, ReactNode> {
	return Object.fromEntries(
		values.map((value) => [
			value,
			<IconLabel key={value} icon={icons[value]} label={labels[value]} />,
		]),
	);
}
