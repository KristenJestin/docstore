import { useNavigate } from "@tanstack/react-router";

import { ALL_NAV_ITEMS } from "@/lib/navigation";
import { client } from "@/utils/orpc";

import { type CommandPaletteItem, useCommandGroup } from "./command-palette";
import { PartyAvatar } from "./party-avatar";
import { PARTY_TYPE_LABELS } from "./party-type-badge";

/**
 * Default palette sources: navigation and party search. Other screens add
 * their own groups through `useCommandGroup`.
 */
export function PartyCommandGroups() {
	const navigate = useNavigate();

	useCommandGroup({
		id: "navigation",
		heading: "Go to",
		order: 10,
		getItems: (query) => {
			const needle = query.trim().toLowerCase();
			return ALL_NAV_ITEMS.filter(
				(item) =>
					needle.length === 0 || item.label.toLowerCase().includes(needle),
			).map<CommandPaletteItem>((item) => {
				const Icon = item.icon;
				return {
					id: `nav:${item.to}`,
					label: item.label,
					icon: <Icon className="size-4 text-muted-foreground" />,
					onSelect: () => {
						navigate({ to: item.to });
					},
				};
			});
		},
	});

	useCommandGroup({
		id: "parties",
		heading: "Parties",
		order: 20,
		getItems: async (query) => {
			const needle = query.trim();
			if (needle.length === 0) {
				return [];
			}
			const result = await client.party.list({
				query: needle,
				page: 1,
				pageSize: 6,
				includeArchived: false,
			});
			return result.items.map<CommandPaletteItem>((party) => ({
				id: `party:${party.id}`,
				label: party.name,
				description: PARTY_TYPE_LABELS[party.type],
				icon: (
					<PartyAvatar
						name={party.name}
						logoKey={party.logoKey}
						partyId={party.id}
						size="sm"
					/>
				),
				onSelect: () => {
					navigate({
						to: "/parties/$partyId",
						params: { partyId: party.id },
					});
				},
			}));
		},
	});

	return null;
}
