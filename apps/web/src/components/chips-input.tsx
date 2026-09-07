import { Input } from "@docstore/ui/components/input";
import { cn } from "@docstore/ui/lib/utils";
import { XIcon } from "lucide-react";
import { type KeyboardEvent, useState } from "react";

export interface ChipsInputProps {
	values: string[];
	onValuesChange: (values: string[]) => void;
	placeholder?: string;
	id?: string;
	/** Input type (`email`, `text`…). */
	type?: string;
	/**
	 * Canonical form applied to a value as it is added — the identifiers of a
	 * party go through `normalizeIdentifier`, so "FR76 3000…" and "FR763000…"
	 * are stored as the same IBAN.
	 */
	normalize?: (value: string) => string;
	className?: string;
}

/**
 * Multi-value input rendered as chips: Enter or comma adds a value, Backspace
 * on an empty field removes the last one.
 */
export function ChipsInput({
	values,
	onValuesChange,
	placeholder = "Type a value, then Enter",
	id,
	type = "text",
	normalize,
	className,
}: ChipsInputProps) {
	const [draft, setDraft] = useState("");

	const commit = (raw: string) => {
		const trimmed = raw.trim().replace(/,$/, "").trim();
		const value = normalize ? normalize(trimmed) : trimmed;
		if (value.length === 0 || values.includes(value)) {
			setDraft("");
			return;
		}
		onValuesChange([...values, value]);
		setDraft("");
	};

	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "Enter" || event.key === ",") {
			event.preventDefault();
			commit(draft);
			return;
		}
		if (event.key === "Backspace" && draft.length === 0 && values.length > 0) {
			event.preventDefault();
			onValuesChange(values.slice(0, -1));
		}
	};

	return (
		<div className={cn("flex flex-col gap-2", className)}>
			<Input
				id={id}
				type={type}
				value={draft}
				placeholder={placeholder}
				onChange={(event) => setDraft(event.target.value)}
				onKeyDown={onKeyDown}
				onBlur={() => commit(draft)}
			/>
			{values.length > 0 ? (
				<ul className="flex flex-wrap gap-1">
					{values.map((value) => (
						<li key={value}>
							<span className="inline-flex items-center gap-1 rounded-full border border-border bg-card py-0.5 pr-1 pl-2 text-muted-foreground text-xs leading-5">
								{value}
								<button
									type="button"
									aria-label={`Remove ${value}`}
									onClick={() =>
										onValuesChange(values.filter((item) => item !== value))
									}
									className="transition-colors hover:text-foreground"
								>
									<XIcon className="size-3" />
								</button>
							</span>
						</li>
					))}
				</ul>
			) : null}
		</div>
	);
}
