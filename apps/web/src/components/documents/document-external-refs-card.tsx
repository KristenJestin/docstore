import type { DocumentExternalRef } from "@docstore/shared/external-ref";
import { Badge } from "@docstore/ui/components/badge";
import { ExternalLinkIcon } from "lucide-react";

export interface DocumentExternalRefsCardProps {
	externalRefs: DocumentExternalRef[];
}

/**
 * "Referenced by" card (issue #4): the notes of external systems, the life
 * wiki first, that cite the document. Read-only: the system that owns the
 * notes declares them through the API or MCP (`set_external_refs`).
 */
export function DocumentExternalRefsCard({
	externalRefs,
}: DocumentExternalRefsCardProps) {
	if (externalRefs.length === 0) {
		return (
			<p className="text-muted-foreground text-xs">
				No external note references this document yet.
			</p>
		);
	}

	return (
		<ul className="flex flex-col divide-y divide-border border-border border-t">
			{externalRefs.map((item) => {
				const title = item.label ?? item.ref;
				return (
					<li
						key={`${item.system}:${item.ref}`}
						className="flex items-center gap-2 py-2.5"
					>
						<div className="flex min-w-0 flex-1 flex-col gap-0.5">
							{item.url ? (
								<a
									href={item.url}
									target="_blank"
									rel="noopener noreferrer"
									className="flex min-w-0 items-center gap-1 text-sm hover:underline"
								>
									<span className="truncate">{title}</span>
									<ExternalLinkIcon
										aria-hidden
										className="size-3 shrink-0 text-muted-foreground"
									/>
								</a>
							) : (
								<span className="truncate text-sm">{title}</span>
							)}
							{item.label ? (
								<span
									className="truncate font-mono text-muted-foreground text-xs"
									title={item.ref}
								>
									{item.ref}
								</span>
							) : null}
						</div>
						<Badge tone="outline">{item.system}</Badge>
					</li>
				);
			})}
		</ul>
	);
}
