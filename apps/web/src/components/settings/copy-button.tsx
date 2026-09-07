import { Button } from "@docstore/ui/components/button";
import { CheckIcon, CopyIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

/** How long the button shows the "copied" tick. */
const FEEDBACK_MS = 2000;

export interface CopyButtonProps {
	value: string;
	/** Accessible label, e.g. "Copy the public URL". */
	label: string;
	/** Visible text; without it the button is a bare icon. */
	children?: string;
	size?: "sm" | "icon-sm";
	variant?: "outline" | "ghost" | "secondary" | "default";
	className?: string;
}

/** Copies a value to the clipboard and confirms it inline for two seconds. */
export function CopyButton({
	value,
	label,
	children,
	size = "icon-sm",
	variant = "ghost",
	className,
}: CopyButtonProps) {
	const [copied, setCopied] = useState(false);

	useEffect(() => {
		if (!copied) {
			return;
		}
		const timer = setTimeout(() => setCopied(false), FEEDBACK_MS);
		return () => clearTimeout(timer);
	}, [copied]);

	const copy = async () => {
		try {
			await navigator.clipboard.writeText(value);
			setCopied(true);
		} catch {
			toast.error("The clipboard is not available in this browser.");
		}
	};

	return (
		<Button
			type="button"
			variant={variant}
			size={children ? size : "icon-sm"}
			aria-label={label}
			onClick={copy}
			className={className}
		>
			{copied ? <CheckIcon /> : <CopyIcon />}
			{children}
		</Button>
	);
}
