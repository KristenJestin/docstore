import { useEffect } from "react";

/**
 * Global actions fired from the application shell keyboard handler and served
 * by the page on screen ("/" = focus search, "n" = create).
 */
export const PAGE_ACTIONS = {
	focusSearch: "docstore:focus-search",
	create: "docstore:create",
} as const;

export type PageAction = (typeof PAGE_ACTIONS)[keyof typeof PAGE_ACTIONS];

export function emitPageAction(action: PageAction): void {
	if (typeof window === "undefined") {
		return;
	}
	window.dispatchEvent(new CustomEvent(action));
}

/** Subscribes the page to a global action while the component is mounted. */
export function usePageAction(action: PageAction, handler: () => void): void {
	useEffect(() => {
		const listener = () => handler();
		window.addEventListener(action, listener);
		return () => window.removeEventListener(action, listener);
	}, [action, handler]);
}
