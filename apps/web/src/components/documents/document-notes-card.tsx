import { NOTES_MAX_LENGTH } from "@docstore/shared/document";
import { Button } from "@docstore/ui/components/button";
import { Card, CardContent, CardHeader } from "@docstore/ui/components/card";
import { Textarea } from "@docstore/ui/components/textarea";
import { PencilIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { MarkdownLite } from "@/components/markdown-lite";
import { MonoLabel } from "@/components/mono-label";

export interface DocumentNotesCardProps {
	notes: string | null;
	/** Saves on blur; the card never keeps an unsent draft around. */
	onSave: (notes: string | null) => Promise<void>;
	/** Review sheet: the notes are shown, never edited from there. */
	readOnly?: boolean;
}

/**
 * Free-text notes of a document: light Markdown when reading, a plain textarea
 * when writing. Leaving the field saves it — there is no button to forget.
 */
export function DocumentNotesCard({
	notes,
	onSave,
	readOnly = false,
}: DocumentNotesCardProps) {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(notes ?? "");

	// A save elsewhere (or another document) must not leave a stale draft.
	useEffect(() => {
		setDraft(notes ?? "");
		setEditing(false);
	}, [notes]);

	const commit = async () => {
		setEditing(false);
		const next = draft.trim() ? draft : null;
		if (next === (notes ?? null)) {
			return;
		}
		await onSave(next);
	};

	return (
		<Card>
			<CardHeader className="flex flex-wrap items-center justify-between gap-2">
				<MonoLabel>Notes</MonoLabel>
				{readOnly || editing ? null : (
					<Button
						variant="ghost"
						size="sm"
						onClick={() => setEditing(true)}
						aria-label="Edit the notes"
					>
						<PencilIcon />
						Edit
					</Button>
				)}
			</CardHeader>
			<CardContent>
				{editing ? (
					<Textarea
						autoFocus
						aria-label="Notes"
						rows={8}
						maxLength={NOTES_MAX_LENGTH}
						className="font-mono text-xs"
						placeholder={
							"Anything worth remembering.\n\n- **Bold**, lists and [links](https://example.com) are rendered."
						}
						value={draft}
						onChange={(event) => setDraft(event.target.value)}
						onBlur={() => void commit()}
					/>
				) : notes ? (
					<MarkdownLite text={notes} />
				) : (
					<p className="text-muted-foreground text-sm">
						{readOnly ? "No notes." : "No notes yet."}
					</p>
				)}
			</CardContent>
		</Card>
	);
}
