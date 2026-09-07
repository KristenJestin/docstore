import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@docstore/ui/components/alert-dialog";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useRef,
	useState,
} from "react";

export interface ConfirmOptions {
	title: string;
	description?: ReactNode;
	/** Label of the confirm button (default: "Confirm"). */
	confirmLabel?: string;
	cancelLabel?: string;
	/** Red styling for an irreversible action. */
	destructive?: boolean;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/**
 * Provides `useConfirm()`. Usage:
 * `const ok = await confirm({ title, description, destructive: true })`.
 */
export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
	const [options, setOptions] = useState<ConfirmOptions | null>(null);
	const resolveRef = useRef<((value: boolean) => void) | null>(null);

	const confirm = useCallback<ConfirmFn>((next) => {
		setOptions(next);
		return new Promise<boolean>((resolve) => {
			resolveRef.current = resolve;
		});
	}, []);

	const settle = useCallback((value: boolean) => {
		resolveRef.current?.(value);
		resolveRef.current = null;
		setOptions(null);
	}, []);

	const value = useMemo(() => confirm, [confirm]);

	return (
		<ConfirmContext.Provider value={value}>
			{children}
			<AlertDialog
				open={options !== null}
				onOpenChange={(open) => {
					if (!open) {
						settle(false);
					}
				}}
			>
				{options ? (
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>{options.title}</AlertDialogTitle>
							{options.description ? (
								<AlertDialogDescription>
									{options.description}
								</AlertDialogDescription>
							) : null}
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel onClick={() => settle(false)}>
								{options.cancelLabel ?? "Cancel"}
							</AlertDialogCancel>
							<AlertDialogAction
								variant={options.destructive ? "destructive" : "default"}
								onClick={() => settle(true)}
							>
								{options.confirmLabel ?? "Confirm"}
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				) : null}
			</AlertDialog>
		</ConfirmContext.Provider>
	);
}

/** Returns the awaitable `confirm` function. Requires `ConfirmDialogProvider`. */
export function useConfirm(): ConfirmFn {
	const confirm = useContext(ConfirmContext);
	if (!confirm) {
		throw new Error("useConfirm must be used inside <ConfirmDialogProvider>.");
	}
	return confirm;
}
