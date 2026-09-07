import type { PartyType } from "@docstore/shared/party";
import { Badge, type BadgeTone } from "@docstore/ui/components/badge";
import {
	Building2Icon,
	LandmarkIcon,
	type LucideIcon,
	UserIcon,
	UsersIcon,
} from "lucide-react";

/** English labels of the Party types, capitalised. */
export const PARTY_TYPE_LABELS: Record<PartyType, string> = {
	person: "Person",
	company: "Company",
	public_body: "Public body",
	association: "Association",
};

/** Icon shown next to the label in every select, option and badge. */
export const PARTY_TYPE_ICONS: Record<PartyType, LucideIcon> = {
	person: UserIcon,
	company: Building2Icon,
	public_body: LandmarkIcon,
	association: UsersIcon,
};

/** The four tones of DESIGN.md: sky, neutral, emerald, amber. */
const PARTY_TYPE_TONES: Record<PartyType, BadgeTone> = {
	person: "info",
	company: "neutral",
	public_body: "success",
	association: "warning",
};

export interface PartyTypeBadgeProps {
	type: PartyType;
	className?: string;
}

/** Coloured badge of the party type (the only colour on the detail page). */
export function PartyTypeBadge({ type, className }: PartyTypeBadgeProps) {
	const Icon = PARTY_TYPE_ICONS[type];
	return (
		<Badge tone={PARTY_TYPE_TONES[type]} className={className}>
			<Icon aria-hidden />
			{PARTY_TYPE_LABELS[type]}
		</Badge>
	);
}
