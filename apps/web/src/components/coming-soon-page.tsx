import type { LucideIcon } from "lucide-react";

import { EmptyState } from "./empty-state";
import { PageHeader } from "./page-header";

export interface ComingSoonPageProps {
	kicker: string;
	title: string;
	description?: string;
	icon?: LucideIcon;
	/** What the page will offer once implemented. */
	preview?: string;
}

/** Placeholder screen for sections that are not implemented yet. */
export function ComingSoonPage({
	kicker,
	title,
	description,
	icon,
	preview,
}: ComingSoonPageProps) {
	return (
		<>
			<PageHeader kicker={kicker} title={title} description={description} />
			<div className="px-6 py-8 lg:px-8">
				<EmptyState
					icon={icon}
					title="Coming soon"
					description={preview ?? "This section is not available yet."}
				/>
			</div>
		</>
	);
}
