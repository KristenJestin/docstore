import { useEffect, useRef, useState } from "react";

/** True when the ongoing drag carries files (and not text). */
function carriesFiles(transfer: DataTransfer | null): boolean {
	return Boolean(transfer?.types.includes("Files"));
}

/**
 * File drag and drop anywhere on the page. Returns `true` while a file hovers
 * the window, so the page can show an invitation overlay.
 */
export function useFileDrop(
	onFiles: (files: File[]) => void,
	enabled = true,
): boolean {
	const [dragging, setDragging] = useState(false);
	const handlerRef = useRef(onFiles);
	handlerRef.current = onFiles;

	useEffect(() => {
		if (!enabled) {
			return;
		}
		// Counter: `dragleave` also fires when moving from one child to another,
		// so a plain boolean would flicker.
		let depth = 0;

		const onDragEnter = (event: DragEvent) => {
			if (!carriesFiles(event.dataTransfer)) {
				return;
			}
			depth += 1;
			setDragging(true);
		};

		const onDragOver = (event: DragEvent) => {
			if (carriesFiles(event.dataTransfer)) {
				event.preventDefault();
			}
		};

		const onDragLeave = () => {
			depth = Math.max(depth - 1, 0);
			if (depth === 0) {
				setDragging(false);
			}
		};

		const onDrop = (event: DragEvent) => {
			if (!carriesFiles(event.dataTransfer)) {
				return;
			}
			event.preventDefault();
			depth = 0;
			setDragging(false);
			const files = Array.from(event.dataTransfer?.files ?? []);
			if (files.length > 0) {
				handlerRef.current(files);
			}
		};

		window.addEventListener("dragenter", onDragEnter);
		window.addEventListener("dragover", onDragOver);
		window.addEventListener("dragleave", onDragLeave);
		window.addEventListener("drop", onDrop);
		return () => {
			window.removeEventListener("dragenter", onDragEnter);
			window.removeEventListener("dragover", onDragOver);
			window.removeEventListener("dragleave", onDragLeave);
			window.removeEventListener("drop", onDrop);
			setDragging(false);
		};
	}, [enabled]);

	return dragging;
}
