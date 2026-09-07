import { Toaster } from "@docstore/ui/components/sonner";
import type { QueryClient } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import {
	createRootRouteWithContext,
	HeadContent,
	Outlet,
	Scripts,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { ThemeProvider } from "next-themes";

import type { orpc } from "@/utils/orpc";

import appCss from "../index.css?url";

export interface RouterAppContext {
	orpc: typeof orpc;
	queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterAppContext>()({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1" },
			{ title: "docstore — household document management" },
			{
				name: "description",
				content: "Personal and family document management.",
			},
			{ name: "theme-color", content: "#facc15" },
		],
		links: [
			{ rel: "stylesheet", href: appCss },
			{ rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
			{
				rel: "icon",
				href: "/favicon-32.png",
				type: "image/png",
				sizes: "32x32",
			},
			{
				rel: "icon",
				href: "/favicon-16.png",
				type: "image/png",
				sizes: "16x16",
			},
			{ rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
			{ rel: "manifest", href: "/manifest.webmanifest" },
		],
	}),

	component: RootDocument,
});

/**
 * Both TanStack devtools, docked bottom right and stacked: the sidebar footer
 * (user block and Settings gear) owns the bottom left corner, and the router
 * toggle is lifted so it never sits on top of the query one.
 */
function Devtools() {
	if (!import.meta.env.DEV) {
		return null;
	}
	return (
		<>
			<ReactQueryDevtools buttonPosition="bottom-right" />
			{/* The vertical offset of the router toggle lives in `index.css`: the
			    library draws it with generated class names. */}
			<TanStackRouterDevtools position="bottom-right" />
		</>
	);
}

function RootDocument() {
	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				<HeadContent />
			</head>
			<body>
				<ThemeProvider
					attribute="class"
					defaultTheme="dark"
					enableSystem={false}
					disableTransitionOnChange
				>
					<Outlet />
					{/* Top right: bottom-right toasts covered the sheet and dialog
					    footers, i.e. the very buttons the next action needs. */}
					<Toaster position="bottom-right" offset={{ bottom: 88, right: 16 }} />
				</ThemeProvider>
				<Devtools />
				<Scripts />
			</body>
		</html>
	);
}
