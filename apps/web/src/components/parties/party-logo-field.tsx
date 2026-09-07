import { Button } from "@docstore/ui/components/button";
import type { QueryClient } from "@tanstack/react-query";
import { ImageDownIcon, ImageOffIcon, ImageUpIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { PartyAvatar } from "@/components/party-avatar";
import { client } from "@/utils/orpc";

/**
 * Logo field of the party form. It never writes on its own: it holds a draft
 * that `applyLogoDraft` replays once the party has an id, so creating and
 * editing follow exactly the same path (SPEC §2 "Party").
 */

/** Largest logo the API accepts (`party.uploadLogo`). */
const MAX_LOGO_BYTES = 1024 * 1024;

const ACCEPTED_MIME = "image/png,image/jpeg,image/webp,image/svg+xml";

export type LogoDraft =
	| { kind: "keep" }
	/** A file chosen in the browser, uploaded once the party exists. */
	| { kind: "file"; file: File }
	/** `party.fetchLogo` on the first declared domain. */
	| { kind: "fetch" }
	| { kind: "remove" };

export const KEEP_LOGO: LogoDraft = { kind: "keep" };

/**
 * Replays the draft on a saved party. Returns `true` when something was sent,
 * so the caller knows whether the party has to be re-read.
 */
export async function applyLogoDraft(
	partyId: string,
	draft: LogoDraft,
	queryClient: QueryClient,
): Promise<boolean> {
	switch (draft.kind) {
		case "file":
			await client.party.uploadLogo({ id: partyId, file: draft.file });
			break;
		case "fetch":
			await client.party.fetchLogo({ id: partyId });
			break;
		case "remove":
			await client.party.removeLogo({ id: partyId });
			break;
		default:
			return false;
	}
	// Sent through the raw oRPC client, so outside the global invalidation the
	// mutation cache runs after every `useMutation`.
	await queryClient.invalidateQueries();
	return true;
}

export interface PartyLogoFieldProps {
	/** Name of the party, for the fallback initials. */
	name: string;
	/** Logo currently stored, if any. */
	logoKey: string | null;
	/** Id of the saved party; absent while creating. */
	partyId?: string;
	/** `party.fetchLogo` needs at least one domain identifier. */
	hasDomain: boolean;
	value: LogoDraft;
	onValueChange: (draft: LogoDraft) => void;
}

/** Preview plus the three actions: upload, fetch from the domain, remove. */
export function PartyLogoField({
	name,
	logoKey,
	partyId,
	hasDomain,
	value,
	onValueChange,
}: PartyLogoFieldProps) {
	const inputRef = useRef<HTMLInputElement | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [preview, setPreview] = useState<string | null>(null);

	// The object URL of a chosen file lives exactly as long as that file.
	useEffect(() => {
		if (value.kind !== "file") {
			setPreview(null);
			return;
		}
		const url = URL.createObjectURL(value.file);
		setPreview(url);
		return () => URL.revokeObjectURL(url);
	}, [value]);

	const shown = value.kind === "remove" ? null : logoKey;
	const hint =
		value.kind === "file"
			? `“${value.file.name}” will be uploaded on save.`
			: value.kind === "fetch"
				? "The logo will be fetched from the domain on save."
				: value.kind === "remove"
					? "The logo will be removed on save."
					: hasDomain
						? "PNG, JPEG, WebP or SVG, 1 MB max — or fetched from the domain."
						: "PNG, JPEG, WebP or SVG, 1 MB max. Add a domain to fetch it.";

	const pick = (file: File | null) => {
		if (!file) {
			return;
		}
		if (file.size > MAX_LOGO_BYTES) {
			setError("The logo must be smaller than 1 MB.");
			return;
		}
		setError(null);
		onValueChange({ kind: "file", file });
	};

	return (
		<div className="flex items-start gap-4">
			{preview ? (
				<img
					src={preview}
					alt=""
					aria-hidden
					className="size-16 shrink-0 rounded-full bg-card object-contain ring-1 ring-border"
				/>
			) : (
				<PartyAvatar name={name} logoKey={shown} partyId={partyId} size="lg" />
			)}

			<div className="flex min-w-0 flex-1 flex-col gap-2">
				<div className="flex flex-wrap gap-2">
					<input
						ref={inputRef}
						type="file"
						accept={ACCEPTED_MIME}
						className="hidden"
						aria-label="Logo file"
						onChange={(event) => pick(event.target.files?.[0] ?? null)}
					/>
					<Button
						variant="outline"
						size="sm"
						onClick={() => inputRef.current?.click()}
					>
						<ImageUpIcon />
						Upload
					</Button>
					<Button
						variant="outline"
						size="sm"
						disabled={!hasDomain}
						onClick={() => {
							setError(null);
							onValueChange({ kind: "fetch" });
						}}
					>
						<ImageDownIcon />
						Fetch from domain
					</Button>
					<Button
						variant="ghost"
						size="sm"
						disabled={!logoKey && value.kind === "keep"}
						onClick={() => {
							setError(null);
							onValueChange(logoKey ? { kind: "remove" } : KEEP_LOGO);
						}}
					>
						<ImageOffIcon />
						Remove
					</Button>
				</div>
				<p
					className={
						error ? "text-destructive text-xs" : "text-muted-foreground text-xs"
					}
				>
					{error ?? hint}
				</p>
			</div>
		</div>
	);
}
