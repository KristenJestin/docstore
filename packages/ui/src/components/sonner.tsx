"use client";

import {
	CircleCheckIcon,
	InfoIcon,
	Loader2Icon,
	OctagonXIcon,
	TriangleAlertIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";

/** How long a toast stays on screen. */
const TOAST_DURATION_MS = 4000;

/**
 * Sonner animates its toasts with a plain CSS transition
 * (`transform / opacity / height / box-shadow`) declared on `[data-sonner-toast]`,
 * so the only thing to pass is the duration and the easing of the rest of the
 * interface. They go through the per-toast inline style, which is the one place
 * that reliably wins over the stylesheet the library injects at runtime.
 */
const TOAST_MOTION: React.CSSProperties = {
	transitionDuration: "200ms",
	transitionTimingFunction: "var(--ease-premium)",
};

const Toaster = ({ ...props }: ToasterProps) => {
	const { theme = "system" } = useTheme();

	return (
		<Sonner
			theme={theme as ToasterProps["theme"]}
			className="toaster group"
			duration={TOAST_DURATION_MS}
			icons={{
				success: <CircleCheckIcon className="size-4" />,
				info: <InfoIcon className="size-4" />,
				warning: <TriangleAlertIcon className="size-4" />,
				error: <OctagonXIcon className="size-4" />,
				loading: <Loader2Icon className="size-4 animate-spin" />,
			}}
			style={
				{
					"--normal-bg": "var(--popover)",
					"--normal-text": "var(--popover-foreground)",
					"--normal-border": "var(--border)",
					"--border-radius": "var(--radius)",
				} as React.CSSProperties
			}
			toastOptions={{
				style: TOAST_MOTION,
				classNames: {
					toast: "cn-toast",
				},
			}}
			{...props}
		/>
	);
};

export { Toaster };
