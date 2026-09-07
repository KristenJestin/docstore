import {
	Command,
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@docstore/ui/components/command";
import { Kbd } from "@docstore/ui/components/kbd";
import { ArrowDownIcon, ArrowUpIcon, CornerDownLeftIcon } from "lucide-react";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";

export interface CommandPaletteItem {
	id: string;
	label: string;
	/** Secondary line (issuing party, date…). */
	description?: string;
	/** Element aligned to the right (counter, mono date). */
	hint?: ReactNode;
	icon?: ReactNode;
	/**
	 * Claims the highlight instead of the first item of the first group. Set it
	 * when the query resolves to exactly one thing — an ASN, for instance — so
	 * that Enter opens it straight away. The first item wins if several ask.
	 */
	preselect?: boolean;
	onSelect: () => void;
}

export interface CommandPaletteGroup {
	id: string;
	/** Group heading, e.g. "Go to". */
	heading: string;
	/** Ascending display order (default: 100). */
	order?: number;
	/**
	 * Returns the items matching the query. May be asynchronous: the palette
	 * discards stale answers.
	 */
	getItems: (
		query: string,
	) => CommandPaletteItem[] | Promise<CommandPaletteItem[]>;
}

interface CommandPaletteContextValue {
	open: boolean;
	setOpen: (open: boolean) => void;
	toggle: () => void;
	/** Registers a group and returns the unregister function. */
	registerGroup: (group: CommandPaletteGroup) => () => void;
}

const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(
	null,
);

const QUERY_DEBOUNCE_MS = 150;

/**
 * Command palette (Ctrl+K / ⌘K). Sources are declarative: every screen can
 * register its own group through `useCommandGroup(...)`.
 */
export function CommandPaletteProvider({ children }: { children: ReactNode }) {
	const [open, setOpen] = useState(false);
	const [groups, setGroups] = useState<CommandPaletteGroup[]>([]);

	const registerGroup = useCallback((group: CommandPaletteGroup) => {
		setGroups((current) => [
			...current.filter((item) => item.id !== group.id),
			group,
		]);
		return () => {
			setGroups((current) => current.filter((item) => item.id !== group.id));
		};
	}, []);

	const toggle = useCallback(() => setOpen((current) => !current), []);

	const value = useMemo<CommandPaletteContextValue>(
		() => ({ open, setOpen, toggle, registerGroup }),
		[open, toggle, registerGroup],
	);

	return (
		<CommandPaletteContext.Provider value={value}>
			{children}
			<CommandPaletteDialog
				groups={groups}
				open={open}
				onOpenChange={setOpen}
			/>
		</CommandPaletteContext.Provider>
	);
}

export function useCommandPalette(): CommandPaletteContextValue {
	const context = useContext(CommandPaletteContext);
	if (!context) {
		throw new Error(
			"useCommandPalette must be used inside <CommandPaletteProvider>.",
		);
	}
	return context;
}

/**
 * Registers a palette group for the lifetime of the component. `getItems` is
 * read through a ref, so there is no need to memoise it.
 */
export function useCommandGroup(group: CommandPaletteGroup): void {
	const { registerGroup } = useCommandPalette();
	const getItemsRef = useRef(group.getItems);
	getItemsRef.current = group.getItems;

	const { id, heading, order } = group;

	useEffect(() => {
		return registerGroup({
			id,
			heading,
			order,
			getItems: (query) => getItemsRef.current(query),
		});
	}, [registerGroup, id, heading, order]);
}

interface ResolvedGroup {
	id: string;
	heading: string;
	items: CommandPaletteItem[];
}

function CommandPaletteDialog({
	groups,
	open,
	onOpenChange,
}: {
	groups: CommandPaletteGroup[];
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<ResolvedGroup[]>([]);
	// `Command` is controlled so that a group can claim the highlight; without a
	// value cmdk would always fall back to the first item of the first group.
	const [highlighted, setHighlighted] = useState("");

	useEffect(() => {
		if (!open) {
			setQuery("");
			return;
		}
		let cancelled = false;
		const timer = setTimeout(async () => {
			const ordered = [...groups].sort(
				(a, b) => (a.order ?? 100) - (b.order ?? 100),
			);
			const resolved = await Promise.all(
				ordered.map(async (group) => ({
					id: group.id,
					heading: group.heading,
					items: await group.getItems(query),
				})),
			);
			if (cancelled) {
				return;
			}
			const visible = resolved.filter((group) => group.items.length > 0);
			setResults(visible);
			const items = visible.flatMap((group) => group.items);
			const claimed = items.find((item) => item.preselect);
			setHighlighted((claimed ?? items[0])?.id ?? "");
		}, QUERY_DEBOUNCE_MS);

		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [open, query, groups]);

	return (
		<CommandDialog
			open={open}
			onOpenChange={onOpenChange}
			className="sm:max-w-2xl"
			title="Command palette"
			description="Search for a document, a party or a command."
		>
			<Command
				shouldFilter={false}
				loop
				value={highlighted}
				onValueChange={setHighlighted}
			>
				<CommandInput
					value={query}
					onValueChange={setQuery}
					placeholder="Search a party, a page, a command…"
				/>
				<CommandList>
					<CommandEmpty>No result.</CommandEmpty>
					{results.map((group) => (
						<CommandGroup key={group.id} heading={group.heading}>
							{group.items.map((item) => (
								<CommandItem
									key={item.id}
									value={item.id}
									onSelect={() => {
										onOpenChange(false);
										item.onSelect();
									}}
								>
									{item.icon}
									<span className="min-w-0 flex-1 truncate">{item.label}</span>
									{item.description ? (
										<span className="shrink-0 truncate text-muted-foreground text-xs">
											{item.description}
										</span>
									) : null}
									{item.hint}
								</CommandItem>
							))}
						</CommandGroup>
					))}
				</CommandList>
			</Command>
			<div className="flex items-center gap-3 border-border border-t px-3 py-2 text-muted-foreground text-xs">
				<span className="flex items-center gap-1">
					<Kbd aria-label="Arrow up">
						<ArrowUpIcon aria-hidden className="size-3" />
					</Kbd>
					<Kbd aria-label="Arrow down">
						<ArrowDownIcon aria-hidden className="size-3" />
					</Kbd>
					navigate
				</span>
				<span className="flex items-center gap-1">
					<Kbd aria-label="Enter">
						<CornerDownLeftIcon aria-hidden className="size-3" />
					</Kbd>
					open
				</span>
				<span className="ml-auto flex items-center gap-1">
					<Kbd>esc</Kbd>
					close
				</span>
			</div>
		</CommandDialog>
	);
}
