import { useEffect, useRef } from "react";

/**
 * Description of a keyboard shortcut.
 *
 * `keys` accepts:
 * - a single key: `"/"`, `"n"`, `"Escape"`;
 * - a combination: `"mod+k"` (`mod` = Ctrl on Windows/Linux, ⌘ on macOS),
 *   `"shift+s"`;
 * - a sequence: `"g d"` (press `g` then `d`).
 */
export interface Hotkey {
	keys: string;
	handler: (event: KeyboardEvent) => void;
	/** Allows the shortcut to fire even inside a text field. */
	enableInInputs?: boolean;
	/** Label shown in the help and the command palette. */
	description?: string;
}

/** Maximum delay between two keys of a sequence. */
const SEQUENCE_TIMEOUT_MS = 1200;

const EDITABLE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

function isEditableTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) {
		return false;
	}
	if (EDITABLE_TAGS.has(target.tagName)) {
		return true;
	}
	return target.isContentEditable;
}

/** `"mod+K"` → `"mod+k"`, `"G D"` → `"g d"`. */
function normalizeKeys(keys: string): string[] {
	return keys
		.trim()
		.split(/\s+/)
		.map((chord) => chord.toLowerCase());
}

/** Canonical representation of the event: `"mod+k"`, `"shift+s"`, `"g"`. */
function eventChord(event: KeyboardEvent): string {
	const parts: string[] = [];
	if (event.ctrlKey || event.metaKey) {
		parts.push("mod");
	}
	if (event.altKey) {
		parts.push("alt");
	}
	if (event.shiftKey && event.key.length > 1) {
		parts.push("shift");
	}
	parts.push(event.key.toLowerCase());
	return parts.join("+");
}

/**
 * Registers global (document-level) keyboard shortcuts. Small and dependency
 * free: handles single keys, combinations and Vim-style sequences.
 */
export function useHotkeys(hotkeys: Hotkey[], enabled = true): void {
	const hotkeysRef = useRef(hotkeys);
	hotkeysRef.current = hotkeys;

	useEffect(() => {
		if (!enabled) {
			return;
		}

		let buffer: string[] = [];
		let timer: ReturnType<typeof setTimeout> | undefined;

		const resetBuffer = () => {
			buffer = [];
			if (timer) {
				clearTimeout(timer);
				timer = undefined;
			}
		};

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.isComposing) {
				return;
			}
			const chord = eventChord(event);
			const editable = isEditableTarget(event.target);
			const candidate = [...buffer, chord];

			for (const hotkey of hotkeysRef.current) {
				const sequence = normalizeKeys(hotkey.keys);
				if (editable && !hotkey.enableInInputs) {
					continue;
				}
				const matchesPrefix = sequence
					.slice(0, candidate.length)
					.every((chordPart, index) => chordPart === candidate[index]);
				if (!matchesPrefix) {
					continue;
				}
				if (sequence.length === candidate.length) {
					event.preventDefault();
					resetBuffer();
					hotkey.handler(event);
					return;
				}
				// Prefix of a longer sequence: remember it and wait for the next key.
				buffer = candidate;
				if (timer) {
					clearTimeout(timer);
				}
				timer = setTimeout(resetBuffer, SEQUENCE_TIMEOUT_MS);
				return;
			}

			resetBuffer();
		};

		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("keydown", onKeyDown);
			resetBuffer();
		};
	}, [enabled]);
}
