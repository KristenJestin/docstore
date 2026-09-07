import type { ReactNode } from "react";

import { BrandLogo } from "./brand-logo";
import { ThemeToggle } from "./theme-toggle";

/**
 * Frame shared by the sign-in and sign-up screens: bold centred "docstore"
 * logo (docstore v1 spirit) above a double-rimmed card.
 */
export function AuthCard({
	kicker,
	title,
	description,
	children,
	footer,
}: {
	kicker: string;
	title: string;
	description?: string;
	children: ReactNode;
	footer?: ReactNode;
}) {
	return (
		<div className="relative flex min-h-svh flex-col items-center justify-center bg-background px-4 py-10">
			<ThemeToggle className="absolute top-4 right-4" />

			<div className="w-full max-w-md">
				<div className="mb-8 flex flex-col items-center text-center">
					<BrandLogo size="xl" />
					<p className="mt-1.5 text-muted-foreground text-sm">
						Household document management
					</p>
				</div>

				<div className="shell">
					<div className="rounded-xl bg-card p-6 shadow-lift ring-1 ring-border">
						<p className="mono-label">{kicker}</p>
						<h1 className="mt-2 font-extrabold text-2xl leading-tight tracking-tight">
							{title}
						</h1>
						{description ? (
							<p className="mt-1.5 text-muted-foreground text-sm">
								{description}
							</p>
						) : null}
						<div className="mt-6">{children}</div>
					</div>
				</div>

				{footer ? (
					<div className="mt-4 text-center text-muted-foreground text-sm">
						{footer}
					</div>
				) : null}
			</div>
		</div>
	);
}
