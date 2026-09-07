import type { ShareLink } from "@docstore/shared/share-link";
import { Badge } from "@docstore/ui/components/badge";
import { Button } from "@docstore/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@docstore/ui/components/dialog";
import { Input } from "@docstore/ui/components/input";
import { Skeleton } from "@docstore/ui/components/skeleton";
import { Switch } from "@docstore/ui/components/switch";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BanIcon, LinkIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";

import { useConfirm } from "@/components/confirm-dialog";
import { DatePicker } from "@/components/date-picker";
import { EmptyState } from "@/components/empty-state";
import { FormField, FormSection } from "@/components/form-field";
import { MonoLabel } from "@/components/mono-label";
import { CopyButton } from "@/components/settings/copy-button";
import { formatDateTime } from "@/components/settings/settings-labels";
import { SHARE_REVOKED_REASON_LABELS } from "@/components/share/sensitive-links";
import { toastApiError } from "@/lib/api-error";
import { plural } from "@/lib/plural";
import { publicSharePageUrl } from "@/lib/share-link-url";
import { orpc } from "@/utils/orpc";

export interface ShareDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Exactly one of the two. */
	documentId?: string;
	dossierId?: string;
	/** Title of the shared object, shown in the description. */
	title: string;
}

/**
 * Share links of a document or of a dossier: existing links with their quota
 * and expiry, plus the creation form. The public page is the route `/s/$token`.
 */
export function ShareDialog({
	open,
	onOpenChange,
	documentId,
	dossierId,
	title,
}: ShareDialogProps) {
	const ids = useId();
	const queryClient = useQueryClient();
	const confirm = useConfirm();

	const [expiresOn, setExpiresOn] = useState<string | null>(null);
	const [password, setPassword] = useState("");
	const [maxViews, setMaxViews] = useState("");
	const [allowDownload, setAllowDownload] = useState(true);

	useEffect(() => {
		if (open) {
			setExpiresOn(null);
			setPassword("");
			setMaxViews("");
			setAllowDownload(true);
		}
	}, [open]);

	const links = useQuery({
		...orpc.shareLink.list.queryOptions({
			input: { documentId, dossierId, includeInactive: true },
		}),
		enabled: open,
	});

	// The API refuses to share a dossier holding a sensitive document. Probing it
	// (one row is enough) turns that `BAD_REQUEST` into an up-front explanation
	// rather than a failure on submit.
	const sensitiveMembers = useQuery({
		...orpc.document.list.queryOptions({
			input: { dossierId, sensitive: true, page: 1, pageSize: 1 },
		}),
		enabled: open && dossierId !== undefined,
	});
	const blocked = (sensitiveMembers.data?.total ?? 0) > 0;

	const create = useMutation(orpc.shareLink.create.mutationOptions());
	const revoke = useMutation(orpc.shareLink.revoke.mutationOptions());
	const remove = useMutation(orpc.shareLink.delete.mutationOptions());

	const invalidate = () =>
		queryClient.invalidateQueries({ queryKey: orpc.shareLink.key() });

	const submit = async () => {
		try {
			const created = await create.mutateAsync({
				documentId,
				dossierId,
				// The link stays valid until the end of the chosen day.
				expiresAt: expiresOn
					? new Date(`${expiresOn}T23:59:59`).toISOString()
					: null,
				password: password.trim() ? password : null,
				maxViews: maxViews.trim() ? Number(maxViews) : null,
				allowDownload,
			});
			await invalidate();
			await navigator.clipboard
				.writeText(publicSharePageUrl(created.link))
				.catch(() => undefined);
			toast.success("Share link created.", {
				description: "The URL has been copied to the clipboard.",
			});
			setPassword("");
			setMaxViews("");
			setExpiresOn(null);
		} catch (error) {
			toastApiError(error, "The share link could not be created.");
		}
	};

	const onRevoke = async (link: ShareLink) => {
		const ok = await confirm({
			title: "Revoke this link?",
			description: "The public URL answers 410 immediately.",
			confirmLabel: "Revoke",
			destructive: true,
		});
		if (!ok) {
			return;
		}
		try {
			await revoke.mutateAsync({ id: link.id });
			await invalidate();
			toast.success("Link revoked.");
		} catch (error) {
			toastApiError(error, "The link could not be revoked.");
		}
	};

	const onDelete = async (link: ShareLink) => {
		try {
			await remove.mutateAsync({ id: link.id });
			await invalidate();
			toast.success("Link deleted.");
		} catch (error) {
			toastApiError(error, "The link could not be deleted.");
		}
	};

	const items = links.data ?? [];

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>Share</DialogTitle>
					<DialogDescription>
						A public URL onto “{title}”, protected by its token and, optionally,
						by a password.
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-3">
					<MonoLabel>Existing links</MonoLabel>
					{links.isLoading ? (
						<Skeleton className="h-20 w-full" />
					) : items.length === 0 ? (
						<EmptyState
							size="sm"
							icon={LinkIcon}
							title="No share link"
							description="Create one below to hand this out."
						/>
					) : (
						<ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-lg ring-1 ring-border">
							{items.map((link) => (
								<ShareLinkRow
									key={link.id}
									link={link}
									onRevoke={() => onRevoke(link)}
									onDelete={() => onDelete(link)}
								/>
							))}
						</ul>
					)}
				</div>

				<FormSection title="New link">
					{blocked ? (
						<p className="flex items-start gap-2 rounded-lg bg-tone-warning px-3 py-2 text-tone-warning-foreground text-xs">
							<TriangleAlertIcon
								aria-hidden
								className="mt-0.5 size-3.5 shrink-0"
							/>
							<span>
								This dossier holds at least one sensitive document, so it cannot
								be shared publicly. Remove it from the dossier, or clear its
								sensitive flag, then reopen this dialog.
							</span>
						</p>
					) : null}
					<div className="grid grid-cols-2 gap-3">
						<FormField
							label="Expires on"
							htmlFor={`${ids}-expires`}
							hint="Empty: never expires."
						>
							<DatePicker
								id={`${ids}-expires`}
								label="Expires on"
								disabled={blocked}
								value={expiresOn}
								onValueChange={setExpiresOn}
							/>
						</FormField>
						<FormField
							label="Maximum views"
							htmlFor={`${ids}-max-views`}
							hint="Empty: unlimited."
						>
							<Input
								id={`${ids}-max-views`}
								type="number"
								min={1}
								disabled={blocked}
								className="font-mono tabular-nums"
								value={maxViews}
								onChange={(event) => setMaxViews(event.target.value)}
							/>
						</FormField>
					</div>

					<FormField
						label="Password"
						htmlFor={`${ids}-password`}
						hint="At least 4 characters. Empty: the token alone opens the page."
					>
						<Input
							id={`${ids}-password`}
							type="text"
							autoComplete="off"
							disabled={blocked}
							value={password}
							onChange={(event) => setPassword(event.target.value)}
						/>
					</FormField>

					<div className="flex items-center justify-between gap-4">
						<div>
							<p className="text-sm">Allow download</p>
							<p className="text-muted-foreground text-xs">
								Off: the visitor only sees the previews.
							</p>
						</div>
						<Switch
							aria-label="Allow download"
							disabled={blocked}
							checked={allowDownload}
							onCheckedChange={setAllowDownload}
						/>
					</div>
				</FormSection>

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Close
					</Button>
					<Button
						disabled={
							blocked ||
							create.isPending ||
							(password.trim().length > 0 && password.trim().length < 4)
						}
						onClick={submit}
					>
						{create.isPending ? "Creating…" : "Create link"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function ShareLinkRow({
	link,
	onRevoke,
	onDelete,
}: {
	link: ShareLink;
	onRevoke: () => void;
	onDelete: () => void;
}) {
	const url = publicSharePageUrl(link);
	const expired =
		link.expiresAt !== null && link.expiresAt.getTime() < Date.now();
	const exhausted = link.maxViews !== null && link.views >= link.maxViews;
	const inactive = link.revokedAt !== null || expired || exhausted;

	return (
		<li className="flex flex-wrap items-center gap-2 px-3 py-2.5">
			<div className="min-w-0 flex-1">
				<p data-testid="share-link-url" className="truncate font-mono text-xs">
					{url}
				</p>
				<p className="mt-0.5 flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
					<span className="font-mono tabular-nums">
						{link.views}
						{link.maxViews === null ? "" : `/${link.maxViews}`}{" "}
						{plural(link.views, "view")}
					</span>
					<span>
						{link.expiresAt
							? `expires ${formatDateTime(link.expiresAt)}`
							: "no expiry"}
					</span>
				</p>
				{/* Why it stopped answering: revoked by hand, or closed because the
				    document became sensitive (see `docs/security.md` §3). */}
				{link.revokedAt ? (
					<p
						data-testid="share-link-revoked-reason"
						className="mt-0.5 text-tone-danger-foreground text-xs"
					>
						{SHARE_REVOKED_REASON_LABELS[link.revokedReason ?? "manual"]}
					</p>
				) : null}
			</div>
			{link.hasPassword ? <Badge tone="info">Password</Badge> : null}
			{link.allowDownload ? null : <Badge tone="outline">View only</Badge>}
			{link.revokedAt ? (
				<Badge
					tone="danger"
					title={SHARE_REVOKED_REASON_LABELS[link.revokedReason ?? "manual"]}
				>
					Revoked
				</Badge>
			) : expired ? (
				<Badge tone="warning">Expired</Badge>
			) : exhausted ? (
				<Badge tone="warning">Quota reached</Badge>
			) : (
				<Badge tone="success">Active</Badge>
			)}
			<CopyButton value={url} label="Copy the share URL" />
			{inactive ? (
				<Button
					variant="ghost"
					size="sm"
					aria-label="Delete this link"
					onClick={onDelete}
				>
					Delete
				</Button>
			) : (
				<Button
					variant="ghost"
					size="sm"
					aria-label="Revoke this link"
					onClick={onRevoke}
				>
					<BanIcon />
					Revoke
				</Button>
			)}
		</li>
	);
}
