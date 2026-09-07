import { useNavigate } from "@tanstack/react-router";

import { client } from "@/utils/orpc";

import { type CommandPaletteItem, useCommandGroup } from "../command-palette";
import { formatDate } from "../date-text";
import { documentIssuer } from "./document-row";
import { DocumentThumbnail } from "./document-thumbnail";

/** Number of documents offered in the palette. */
const RESULT_SIZE = 6;

/** A bare positive integer is read as an archive serial number. */
const ASN_PATTERN = /^\d{1,9}$/;

/**
 * "Documents" group of the Ctrl+K palette: full-text search through
 * `document.list`. Same shape as `PartyCommandGroups`.
 */
export function DocumentCommandGroups() {
	const navigate = useNavigate();

	// "Find by ASN": typing the number written on the paper folder jumps to the
	// document carrying it (`document.byAsn`).
	useCommandGroup({
		id: "asn",
		heading: "Archive",
		order: 10,
		getItems: async (query) => {
			const needle = query.trim();
			if (!ASN_PATTERN.test(needle)) {
				return [];
			}
			const asn = Number(needle);
			try {
				const document = await client.document.byAsn({ asn });
				return [
					{
						id: `asn:${document.id}`,
						label: document.title,
						description: `ASN ${asn}`,
						// The query *is* the number written on the folder: there is
						// nothing more exact to offer, so Enter opens it right away.
						preselect: true,
						hint: document.physicalLocation ? (
							<span className="truncate text-muted-foreground text-xs">
								{document.physicalLocation}
							</span>
						) : undefined,
						onSelect: () => {
							navigate({
								to: "/documents/$documentId",
								params: { documentId: document.id },
							});
						},
					} satisfies CommandPaletteItem,
				];
			} catch {
				// No document carries this number: the group simply stays empty.
				return [];
			}
		},
	});

	useCommandGroup({
		id: "documents",
		heading: "Documents",
		order: 15,
		getItems: async (query) => {
			const needle = query.trim();
			if (needle.length === 0) {
				return [];
			}
			const result = await client.document.list({
				query: needle,
				page: 1,
				pageSize: RESULT_SIZE,
				sort: "documentDate:desc",
				deleted: "exclude",
			});
			return result.items.map<CommandPaletteItem>((item) => ({
				id: `document:${item.id}`,
				label: item.title,
				description: documentIssuer(item)?.name,
				icon: (
					<DocumentThumbnail
						thumbnailKey={item.thumbnailKey}
						sensitive={item.sensitive}
						size="sm"
					/>
				),
				hint: item.documentDate ? (
					<span className="font-mono text-muted-foreground text-xs tabular-nums">
						{formatDate(item.documentDate, item.datePrecision ?? "day")}
					</span>
				) : undefined,
				onSelect: () => {
					navigate({
						to: "/documents/$documentId",
						params: { documentId: item.id },
					});
				},
			}));
		},
	});

	return null;
}
