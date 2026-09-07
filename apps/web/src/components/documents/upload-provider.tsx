import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useState,
} from "react";

import { UploadDialog } from "./upload-dialog";

interface UploadContextValue {
	/** Opens the dialog, optionally pre-filled (drag and drop). */
	openUpload: (files?: File[]) => void;
}

const UploadContext = createContext<UploadContextValue | null>(null);

/**
 * Mounts the upload dialog once for the whole application: the "Add" button of
 * the top bar, the "n" shortcut of the document screens and drag and drop all
 * share the same instance.
 */
export function UploadProvider({ children }: { children: ReactNode }) {
	const [open, setOpen] = useState(false);
	const [files, setFiles] = useState<File[]>([]);

	const openUpload = useCallback((next?: File[]) => {
		setFiles(next ?? []);
		setOpen(true);
	}, []);

	const value = useMemo<UploadContextValue>(
		() => ({ openUpload }),
		[openUpload],
	);

	return (
		<UploadContext.Provider value={value}>
			{children}
			<UploadDialog open={open} onOpenChange={setOpen} initialFiles={files} />
		</UploadContext.Provider>
	);
}

/** `const { openUpload } = useUpload()`. Requires `UploadProvider`. */
export function useUpload(): UploadContextValue {
	const context = useContext(UploadContext);
	if (!context) {
		throw new Error("useUpload must be used inside <UploadProvider>.");
	}
	return context;
}
