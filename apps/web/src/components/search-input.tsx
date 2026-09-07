import { Input } from "@docstore/ui/components/input";
import { Kbd } from "@docstore/ui/components/kbd";
import { cn } from "@docstore/ui/lib/utils";
import { SearchIcon, XIcon } from "lucide-react";
import { type Ref, useId } from "react";

export interface SearchInputProps {
	value: string;
	onValueChange: (value: string) => void;
	placeholder?: string;
	/** Accessible label of the field (visually hidden). */
	label?: string;
	/** Shows the `/` shortcut chip on the right. */
	shortcut?: string;
	/** Visual size: `default` (filter bar) or `lg` (page search). */
	size?: "default" | "lg";
	inputRef?: Ref<HTMLInputElement>;
	className?: string;
}

/** Search field: magnifier, clear button, shortcut chip. */
export function SearchInput({
	value,
	onValueChange,
	placeholder = "Search…",
	label = "Search",
	shortcut,
	size = "default",
	inputRef,
	className,
}: SearchInputProps) {
	const id = useId();

	return (
		<div className={cn("relative", className)}>
			<label className="sr-only" htmlFor={id}>
				{label}
			</label>
			<SearchIcon
				aria-hidden
				className={cn(
					"pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-foreground",
					size === "lg" ? "left-4 size-5" : "left-3 size-4",
				)}
			/>
			<Input
				id={id}
				ref={inputRef}
				type="search"
				value={value}
				placeholder={placeholder}
				onChange={(event) => onValueChange(event.target.value)}
				className={cn(
					size === "lg" ? "h-12 rounded-xl pl-12 text-base" : "pl-9",
					shortcut || value ? "pr-12" : undefined,
				)}
			/>
			{value ? (
				<button
					type="button"
					aria-label="Clear search"
					onClick={() => onValueChange("")}
					className="absolute top-1/2 right-3 -translate-y-1/2 cursor-pointer text-muted-foreground transition-colors duration-200 ease-premium hover:text-foreground"
				>
					<XIcon className="size-4" />
				</button>
			) : shortcut ? (
				<Kbd className="absolute top-1/2 right-3 -translate-y-1/2">
					{shortcut}
				</Kbd>
			) : null}
		</div>
	);
}
