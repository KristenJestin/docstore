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
	BanknoteIcon,
	BellIcon,
	BookOpenIcon,
	BriefcaseIcon,
	Building2Icon,
	CalendarIcon,
	CameraIcon,
	CarIcon,
	CreditCardIcon,
	DropletIcon,
	FilesIcon,
	FileTextIcon,
	FlameIcon,
	FolderIcon,
	FolderOpenIcon,
	GavelIcon,
	GraduationCapIcon,
	HammerIcon,
	HeartPulseIcon,
	HouseIcon,
	IdCardIcon,
	KeyIcon,
	LandmarkIcon,
	LeafIcon,
	LockIcon,
	MailIcon,
	PackageIcon,
	PawPrintIcon,
	PillIcon,
	PlaneIcon,
	PlugIcon,
	ReceiptIcon,
	ScaleIcon,
	ShieldIcon,
	ShoppingCartIcon,
	SmartphoneIcon,
	StethoscopeIcon,
	TruckIcon,
	UsersIcon,
	WalletIcon,
	WifiIcon,
	WrenchIcon,
	XIcon,
} from "lucide-react";

/**
 * Fixed set of icons offered for a category (the API stores the Lucide name in
 * kebab-case). A closed list keeps the bundle small and the picker readable.
 */
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
	"file-text": FileTextIcon,
	files: FilesIcon,
	folder: FolderIcon,
	"folder-open": FolderOpenIcon,
	receipt: ReceiptIcon,
	"credit-card": CreditCardIcon,
	banknote: BanknoteIcon,
	wallet: WalletIcon,
	landmark: LandmarkIcon,
	briefcase: BriefcaseIcon,
	building: Building2Icon,
	house: HouseIcon,
	car: CarIcon,
	plane: PlaneIcon,
	"heart-pulse": HeartPulseIcon,
	stethoscope: StethoscopeIcon,
	pill: PillIcon,
	"graduation-cap": GraduationCapIcon,
	"book-open": BookOpenIcon,
	scale: ScaleIcon,
	gavel: GavelIcon,
	shield: ShieldIcon,
	lock: LockIcon,
	key: KeyIcon,
	"id-card": IdCardIcon,
	users: UsersIcon,
	baby: BabyIcon,
	"paw-print": PawPrintIcon,
	plug: PlugIcon,
	flame: FlameIcon,
	droplet: DropletIcon,
	wifi: WifiIcon,
	smartphone: SmartphoneIcon,
	"shopping-cart": ShoppingCartIcon,
	package: PackageIcon,
	truck: TruckIcon,
	calendar: CalendarIcon,
	bell: BellIcon,
	mail: MailIcon,
	camera: CameraIcon,
	wrench: WrenchIcon,
	hammer: HammerIcon,
	leaf: LeafIcon,
};

export const CATEGORY_ICON_NAMES = Object.keys(CATEGORY_ICONS);

/** Icon of a category, falling back to a folder for an unknown name. */
export function CategoryIcon({
	name,
	className,
}: {
	name: string | null;
	className?: string;
}) {
	const Icon = (name ? CATEGORY_ICONS[name] : undefined) ?? FolderIcon;
	return <Icon className={cn("size-4", className)} strokeWidth={1.75} />;
}

export interface IconPickerProps {
	value: string | null;
	onValueChange: (icon: string | null) => void;
	id?: string;
}

/** Popover grid of the fixed icon list, plus a "no icon" entry. */
export function IconPicker({ value, onValueChange, id }: IconPickerProps) {
	return (
		<Popover>
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
				<CategoryIcon name={value} />
			</PopoverTrigger>
			<PopoverContent align="start" className="w-72 p-2">
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
					{CATEGORY_ICON_NAMES.map((name) => {
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
