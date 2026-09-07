import { Button } from "@docstore/ui/components/button";
import { Input } from "@docstore/ui/components/input";
import { cn } from "@docstore/ui/lib/utils";

import { TITLE_PLACEHOLDERS } from "@/components/rules/rule-labels";

export interface TitleTemplateInputProps {
	value: string;
	onValueChange: (value: string) => void;
	id?: string;
	placeholder?: string;
	className?: string;
	/** Chips offered under the field; the rule tokens by default. */
	placeholders?: { token: string; hint: string }[];
}

/**
 * Title template field: a plain input followed by the `TITLE_PLACEHOLDERS`
 * chips, each appending its token. The same engine renders the template on the
 * API side, so the `set_title` rule action and the document type form share
 * this control.
 */
export function TitleTemplateInput({
	value,
	onValueChange,
	id,
	placeholder = "{issuer} — {date:YYYY-MM}",
	className,
	placeholders = TITLE_PLACEHOLDERS,
}: TitleTemplateInputProps) {
	return (
		<div className={cn("flex flex-col gap-1.5", className)}>
			<Input
				id={id}
				value={value}
				placeholder={placeholder}
				className="font-mono"
				onChange={(event) => onValueChange(event.target.value)}
			/>
			<div className="flex flex-wrap gap-1">
				{placeholders.map((token) => (
					<Button
						key={token.token}
						type="button"
						variant="outline"
						size="sm"
						title={token.hint}
						onClick={() => onValueChange(`${value}${token.token}`)}
					>
						<span className="font-mono text-xs">{token.token}</span>
					</Button>
				))}
			</div>
		</div>
	);
}
