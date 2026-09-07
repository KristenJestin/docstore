import { Button } from "@docstore/ui/components/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@docstore/ui/components/popover";
import { cn } from "@docstore/ui/lib/utils";
import type { LucideIcon } from "lucide-react";
import {
	BabyIcon,
	BadgeCheckIcon,
	BanknoteIcon,
	BellIcon,
	BookOpenIcon,
	BriefcaseBusinessIcon,
	BriefcaseIcon,
	Building2Icon,
	CalendarClockIcon,
	CalendarIcon,
	CameraIcon,
	CarFrontIcon,
	CarIcon,
	ContactIcon,
	CreditCardIcon,
	DropletIcon,
	FileCheckIcon,
	FileSignatureIcon,
	FilesIcon,
	FileTextIcon,
	FlameIcon,
	FolderIcon,
	FolderOpenIcon,
	GaugeIcon,
	GavelIcon,
	GraduationCapIcon,
	HammerIcon,
	HeartPulseIcon,
	HouseIcon,
	IdCardIcon,
	KeyIcon,
	LandmarkIcon,
	LeafIcon,
	ListChecksIcon,
	LockIcon,
	MailIcon,
	MegaphoneIcon,
	PackageIcon,
	PawPrintIcon,
	PillIcon,
	PlaneIcon,
	PlugIcon,
	ReceiptIcon,
	RepeatIcon,
	ScaleIcon,
	ShieldCheckIcon,
	ShieldIcon,
	ShoppingBagIcon,
	ShoppingCartIcon,
	SmartphoneIcon,
	StethoscopeIcon,
	StoreIcon,
	TrendingUpIcon,
	TruckIcon,
	UsersIcon,
	WalletIcon,
	WifiIcon,
	WrenchIcon,
	XIcon,
} from "lucide-react";
import {
	type ComponentType,
	lazy,
	type ReactElement,
	Suspense,
	useEffect,
	useState,
} from "react";

import { SearchInput } from "@/components/search-input";

/**
 * Curated Lucide icons offered for a category or document type (the API
 * stores the Lucide name in kebab-case), grouped by theme so the popover
 * reads as a small catalogue instead of a wall of glyphs. Statically
 * imported and small enough to sit in the main bundle unconditionally; the
 * rest of the Lucide catalogue is only reached through search, see
 * `TaxonomyIcon` and `IconPicker` below.
 */
const ICON_GROUPS: { label: string; icons: Record<string, LucideIcon> }[] = [
	{
		label: "Documents",
		icons: {
			"file-text": FileTextIcon,
			files: FilesIcon,
			folder: FolderIcon,
			"folder-open": FolderOpenIcon,
			"file-signature": FileSignatureIcon,
			"file-check": FileCheckIcon,
			"list-checks": ListChecksIcon,
		},
	},
	{
		label: "Money",
		icons: {
			receipt: ReceiptIcon,
			"credit-card": CreditCardIcon,
			banknote: BanknoteIcon,
			wallet: WalletIcon,
			landmark: LandmarkIcon,
			"shopping-cart": ShoppingCartIcon,
			"shopping-bag": ShoppingBagIcon,
			store: StoreIcon,
			"trending-up": TrendingUpIcon,
			repeat: RepeatIcon,
		},
	},
	{
		label: "Home",
		icons: {
			house: HouseIcon,
			building: Building2Icon,
			plug: PlugIcon,
			flame: FlameIcon,
			droplet: DropletIcon,
			wifi: WifiIcon,
			wrench: WrenchIcon,
			hammer: HammerIcon,
		},
	},
	{
		label: "Identity",
		icons: {
			shield: ShieldIcon,
			lock: LockIcon,
			key: KeyIcon,
			"id-card": IdCardIcon,
			users: UsersIcon,
			"badge-check": BadgeCheckIcon,
			"shield-check": ShieldCheckIcon,
			contact: ContactIcon,
		},
	},
	{
		label: "Health",
		icons: {
			"heart-pulse": HeartPulseIcon,
			stethoscope: StethoscopeIcon,
			pill: PillIcon,
		},
	},
	{
		label: "Vehicles",
		icons: {
			car: CarIcon,
			plane: PlaneIcon,
			truck: TruckIcon,
			"car-front": CarFrontIcon,
		},
	},
	{
		label: "Work",
		icons: {
			briefcase: BriefcaseIcon,
			scale: ScaleIcon,
			gavel: GavelIcon,
			"graduation-cap": GraduationCapIcon,
			"book-open": BookOpenIcon,
			"briefcase-business": BriefcaseBusinessIcon,
			megaphone: MegaphoneIcon,
			"calendar-clock": CalendarClockIcon,
			gauge: GaugeIcon,
		},
	},
	{
		label: "Misc",
		icons: {
			baby: BabyIcon,
			"paw-print": PawPrintIcon,
			smartphone: SmartphoneIcon,
			package: PackageIcon,
			calendar: CalendarIcon,
			bell: BellIcon,
			mail: MailIcon,
			camera: CameraIcon,
			leaf: LeafIcon,
		},
	},
];

/** Flattened curated set, keyed by the kebab-case name stored in the API. */
export const CATEGORY_ICONS: Record<string, LucideIcon> = Object.fromEntries(
	ICON_GROUPS.flatMap((group) => Object.entries(group.icons)),
);

export const CATEGORY_ICON_NAMES = Object.keys(CATEGORY_ICONS);

/** Icon shown while a non-curated name is still loading, or never resolves. */
const DEFAULT_ICON = FolderIcon;

/**
 * Props accepted by Lucide's `DynamicIcon`, loosened to a plain `string`
 * name: a name saved in the database is never guaranteed to be one of the
 * ~1600 literal names Lucide generates for that component's type, and
 * `DynamicIcon` already falls back gracefully to `fallback` for anything it
 * does not recognise at runtime.
 */
interface LazyIconProps {
	name: string;
	className?: string;
	strokeWidth?: number;
	fallback?: () => ReactElement;
}

/**
 * `DynamicIcon`, loaded on first use only. Its module holds Lucide's full
 * name → import() map (~1600 entries): keeping the import inside `lazy()`
 * means that map, and the icons it resolves, never enter the initial bundle
 * — only a category or type carrying a non-curated icon pulls it in.
 */
const LazyDynamicIcon = lazy(async () => {
	const { DynamicIcon } = await import("lucide-react/dynamic");
	return {
		default: DynamicIcon as unknown as ComponentType<LazyIconProps>,
	};
});

export interface TaxonomyIconProps {
	name: string | null;
	className?: string;
}

/**
 * Icon of a category or document type, the single place every screen goes
 * through: category tree, type badges/cards, the icon picker itself. A
 * curated name renders straight from the static map; anything else (picked
 * through the full-library search) is resolved lazily, with a folder shown
 * while it loads and for a name that turns out to be unknown.
 */
export function TaxonomyIcon({ name, className }: TaxonomyIconProps) {
	const classes = cn("size-4", className);
	const Curated = name ? CATEGORY_ICONS[name] : undefined;

	if (Curated) {
		return <Curated className={classes} strokeWidth={1.75} />;
	}
	if (!name) {
		return <DEFAULT_ICON className={classes} strokeWidth={1.75} />;
	}

	const fallback = () => (
		<DEFAULT_ICON className={classes} strokeWidth={1.75} />
	);
	return (
		<Suspense fallback={fallback()}>
			<LazyDynamicIcon
				name={name}
				className={classes}
				strokeWidth={1.75}
				fallback={fallback}
			/>
		</Suspense>
	);
}

export interface IconPickerProps {
	value: string | null;
	onValueChange: (icon: string | null) => void;
	id?: string;
}

/** Below this query length, the full-library search does not run. */
const FULL_SEARCH_MIN_LENGTH = 2;
/** Matches offered from the full Lucide catalogue, beyond the curated set. */
const FULL_SEARCH_LIMIT = 40;

/** A curated group filtered to the names matching the current query. */
function matchingGroups(query: string) {
	return ICON_GROUPS.map((group) => ({
		label: group.label,
		names: Object.keys(group.icons).filter((name) => name.includes(query)),
	})).filter((group) => group.names.length > 0);
}

/**
 * Popover icon picker: the curated, themed set by default: a search field
 * filters it first, and from two characters on also searches every Lucide
 * icon name (loaded lazily, see `TaxonomyIcon`), capped to
 * `FULL_SEARCH_LIMIT` matches.
 */
export function IconPicker({ value, onValueChange, id }: IconPickerProps) {
	const [query, setQuery] = useState("");
	const [extraMatches, setExtraMatches] = useState<string[]>([]);
	const [searchingExtra, setSearchingExtra] = useState(false);
	const normalizedQuery = query.trim().toLowerCase();

	useEffect(() => {
		if (normalizedQuery.length < FULL_SEARCH_MIN_LENGTH) {
			setExtraMatches([]);
			setSearchingExtra(false);
			return;
		}
		let active = true;
		setSearchingExtra(true);
		import("lucide-react/dynamicIconImports").then(
			({ default: dynamicIconImports }) => {
				if (!active) {
					return;
				}
				const matches = Object.keys(dynamicIconImports)
					.filter(
						(name) => !CATEGORY_ICONS[name] && name.includes(normalizedQuery),
					)
					.slice(0, FULL_SEARCH_LIMIT);
				setExtraMatches(matches);
				setSearchingExtra(false);
			},
		);
		return () => {
			active = false;
		};
	}, [normalizedQuery]);

	const groups = matchingGroups(normalizedQuery);
	const showExtra = normalizedQuery.length >= FULL_SEARCH_MIN_LENGTH;
	const noResults =
		groups.length === 0 &&
		(!showExtra || (!searchingExtra && extraMatches.length === 0));

	return (
		<Popover
			onOpenChange={(open) => {
				if (!open) {
					setQuery("");
				}
			}}
		>
			<PopoverTrigger
				render={
					<Button
						type="button"
						variant="outline"
						size="icon"
						id={id}
						aria-label={value ? `Icon: ${value}` : "Choose an icon"}
					/>
				}
			>
				<TaxonomyIcon name={value} />
			</PopoverTrigger>
			<PopoverContent align="start" className="w-80 p-2">
				<div className="flex flex-col gap-2">
					<SearchInput
						value={query}
						onValueChange={setQuery}
						placeholder="Search icons…"
						label="Search icons"
					/>
					<div className="max-h-80 overflow-y-auto pr-1">
						<div className="grid grid-cols-8 gap-1">
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								aria-label="No icon"
								aria-pressed={value === null}
								onClick={() => onValueChange(null)}
								className={cn(value === null && "bg-selection")}
							>
								<XIcon />
							</Button>
						</div>
						{groups.map((group) => (
							<div key={group.label}>
								<p className="mt-2 mb-1 px-1 font-medium text-muted-foreground text-xs uppercase tracking-wide">
									{group.label}
								</p>
								<div className="grid grid-cols-8 gap-1">
									{group.names.map((name) => {
										const Icon = CATEGORY_ICONS[name] as LucideIcon;
										return (
											<Button
												key={name}
												type="button"
												variant="ghost"
												size="icon-sm"
												aria-label={name}
												aria-pressed={value === name}
												onClick={() => onValueChange(name)}
												className={cn(value === name && "bg-selection")}
											>
												<Icon />
											</Button>
										);
									})}
								</div>
							</div>
						))}
						{showExtra && extraMatches.length > 0 ? (
							<div>
								<p className="mt-2 mb-1 px-1 font-medium text-muted-foreground text-xs uppercase tracking-wide">
									More icons
								</p>
								<div className="grid grid-cols-8 gap-1">
									{extraMatches.map((name) => (
										<Button
											key={name}
											type="button"
											variant="ghost"
											size="icon-sm"
											aria-label={name}
											aria-pressed={value === name}
											onClick={() => onValueChange(name)}
											className={cn(value === name && "bg-selection")}
										>
											<TaxonomyIcon name={name} />
										</Button>
									))}
								</div>
							</div>
						) : null}
						{showExtra && searchingExtra ? (
							<p className="px-1 py-2 text-muted-foreground text-xs">
								Searching…
							</p>
						) : null}
						{noResults ? (
							<p className="px-1 py-2 text-muted-foreground text-xs">
								No icons match “{query}”.
							</p>
						) : null}
					</div>
				</div>
			</PopoverContent>
		</Popover>
	);
}

/**
 * Palette offered for categories and tags: the `500` step of twelve Tailwind
 * hues. The API stores a free-form hexadecimal value, so the swatches go
 * through `style` rather than a class.
 */
export const TAXONOMY_COLORS = [
	{ name: "red", value: "#ef4444" },
	{ name: "orange", value: "#f97316" },
	{ name: "amber", value: "#f59e0b" },
	{ name: "yellow", value: "#eab308" },
	{ name: "lime", value: "#84cc16" },
	{ name: "emerald", value: "#10b981" },
	{ name: "teal", value: "#14b8a6" },
	{ name: "sky", value: "#0ea5e9" },
	{ name: "blue", value: "#3b82f6" },
	{ name: "indigo", value: "#6366f1" },
	{ name: "violet", value: "#8b5cf6" },
	{ name: "pink", value: "#ec4899" },
] as const;

export interface ColorPickerProps {
	value: string | null;
	onValueChange: (color: string | null) => void;
	className?: string;
}

/** Twelve swatches plus a "no colour" entry. */
export function ColorPicker({
	value,
	onValueChange,
	className,
}: ColorPickerProps) {
	const normalized = value?.toLowerCase() ?? null;
	return (
		<fieldset className={cn("flex flex-wrap items-center gap-1.5", className)}>
			<legend className="sr-only">Colour</legend>
			<button
				type="button"
				aria-label="No colour"
				aria-pressed={normalized === null}
				onClick={() => onValueChange(null)}
				className={cn(
					"flex size-6 cursor-pointer items-center justify-center rounded-full bg-muted text-muted-foreground ring-1 ring-border transition-transform duration-200 ease-premium hover:scale-110",
					normalized === null && "ring-2 ring-ring",
				)}
			>
				<XIcon className="size-3" />
			</button>
			{TAXONOMY_COLORS.map((color) => (
				<button
					key={color.name}
					type="button"
					aria-label={color.name}
					aria-pressed={normalized === color.value}
					onClick={() => onValueChange(color.value)}
					style={{ backgroundColor: color.value }}
					className={cn(
						"size-6 cursor-pointer rounded-full ring-1 ring-border transition-transform duration-200 ease-premium hover:scale-110",
						normalized === color.value && "ring-2 ring-ring",
					)}
				/>
			))}
		</fieldset>
	);
}
