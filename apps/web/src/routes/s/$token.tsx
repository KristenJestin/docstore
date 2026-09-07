import type { PublicShare, ShareItem } from "@docstore/shared/share-link";
import { Button } from "@docstore/ui/components/button";
import { Input } from "@docstore/ui/components/input";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	DownloadIcon,
	ExternalLinkIcon,
	FileTextIcon,
	LockIcon,
	TriangleAlertIcon,
} from "lucide-react";
import { useId, useState } from "react";

import { BrandLogo } from "@/components/brand-logo";
import { formatDate } from "@/components/date-text";
import { MonoLabel } from "@/components/mono-label";
import { ThemeToggle } from "@/components/theme-toggle";
import { countLabel } from "@/lib/plural";
import { publicShareApiUrl, shareFileUrl } from "@/lib/share-link-url";

/**
 * Public share page (`/s/<token>`).
 *
 * No session, no oRPC: everything goes through the plain HTTP routes of the
 * server (`GET /api/s/:token`, `POST /api/s/:token/unlock`). The access token
 * handed out by `unlock` is kept in memory only — never in storage.
 */
export const Route = createFileRoute("/s/$token")({
	ssr: false,
	component: PublicSharePage,
});

type ShareState =
	| { kind: "ok"; share: PublicShare }
	| { kind: "missing" }
	| { kind: "throttled" };

async function loadShare(
	token: string,
	access: string | null,
): Promise<ShareState> {
	// Single-origin setup (`VITE_SERVER_URL=/`): the helper returns a
	// root-relative URL, which `new URL()` only accepts with a base.
	const url = new URL(publicShareApiUrl(token), window.location.origin);
	if (access) {
		url.searchParams.set("access", access);
	}
	const response = await fetch(url);
	if (response.status === 429) {
		return { kind: "throttled" };
	}
	if (!response.ok) {
		return { kind: "missing" };
	}
	return { kind: "ok", share: (await response.json()) as PublicShare };
}

function PublicSharePage() {
	const { token } = Route.useParams();
	const passwordId = useId();

	const [access, setAccess] = useState<string | null>(null);
	const [password, setPassword] = useState("");
	const [unlocking, setUnlocking] = useState(false);
	const [failure, setFailure] = useState<string | null>(null);

	const state = useQuery({
		queryKey: ["public-share", token, access],
		queryFn: () => loadShare(token, access),
		retry: false,
	});

	const unlock = async () => {
		setUnlocking(true);
		setFailure(null);
		try {
			const response = await fetch(`${publicShareApiUrl(token)}/unlock`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ password }),
			});
			if (response.status === 401) {
				setFailure("Wrong password.");
				return;
			}
			if (response.status === 410) {
				setFailure("This link is no longer valid.");
				await state.refetch();
				return;
			}
			if (response.status === 429) {
				setFailure("Too many attempts. Please wait a minute and try again.");
				return;
			}
			if (!response.ok) {
				setFailure("The link could not be unlocked.");
				return;
			}
			const result = (await response.json()) as { accessToken: string };
			setPassword("");
			setAccess(result.accessToken);
		} catch {
			setFailure("The server could not be reached.");
		} finally {
			setUnlocking(false);
		}
	};

	const share = state.data?.kind === "ok" ? state.data.share : null;
	// A protected share answers with an empty `items` list until `unlock` has
	// handed out an access token.
	const locked =
		share === null
			? false
			: share.requiresPassword &&
				share.items.length === 0 &&
				!share.expired &&
				!share.revoked;

	return (
		<div className="flex min-h-svh flex-col bg-background">
			<header className="flex items-center justify-between gap-4 border-border border-b px-6 py-4 lg:px-8">
				<BrandLogo />
				<ThemeToggle />
			</header>

			<main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10 lg:px-8">
				{state.isLoading ? (
					<Notice title="Loading…" description="Reading the shared items." />
				) : state.data?.kind === "throttled" ? (
					<Notice
						icon={TriangleAlertIcon}
						title="Too many requests"
						description="Please wait a minute before trying again."
					/>
				) : state.data?.kind === "missing" || !share ? (
					<Notice
						icon={TriangleAlertIcon}
						title="Link not found"
						description="This share link does not exist, or it has been deleted."
					/>
				) : share.revoked ? (
					<Notice
						icon={TriangleAlertIcon}
						title="Link revoked"
						description="The owner has revoked this link. Ask them for a new one."
					/>
				) : share.expired ? (
					<Notice
						icon={TriangleAlertIcon}
						title="Link no longer valid"
						description="This link has expired or reached its view quota."
					/>
				) : locked ? (
					<div className="shell">
						<div className="flex flex-col gap-4 rounded-xl bg-card px-6 py-8 shadow-soft ring-1 ring-border">
							<div className="flex items-center gap-3">
								<span className="flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground ring-1 ring-border">
									<LockIcon className="size-5" strokeWidth={1.5} />
								</span>
								<div>
									<p className="font-bold text-base tracking-tight">
										Password required
									</p>
									<p className="text-muted-foreground text-sm">
										This share is protected. Enter the password you were given.
									</p>
								</div>
							</div>
							<form
								className="flex flex-col gap-3"
								onSubmit={(event) => {
									event.preventDefault();
									void unlock();
								}}
							>
								<label htmlFor={passwordId} className="mono-label">
									Password
								</label>
								<Input
									id={passwordId}
									type="password"
									autoComplete="off"
									value={password}
									onChange={(event) => setPassword(event.target.value)}
								/>
								{failure ? (
									<p className="text-destructive text-xs">{failure}</p>
								) : null}
								<Button
									type="submit"
									className="self-start"
									disabled={password.length === 0 || unlocking}
								>
									{unlocking ? "Unlocking…" : "Unlock"}
								</Button>
							</form>
						</div>
					</div>
				) : (
					<>
						<MonoLabel className="block">
							Shared {share.kind === "dossier" ? "dossier" : "document"}
						</MonoLabel>
						<h1 className="mt-2 font-extrabold text-3xl leading-tight tracking-tight">
							{share.title}
						</h1>
						<p className="mt-1.5 text-muted-foreground text-sm">
							{countLabel(share.items.length, "item")}
							{share.allowDownload ? "" : " · downloads disabled"}
						</p>

						<ul className="mt-6 flex flex-col gap-3">
							{share.items.map((item) => (
								<ShareItemRow
									key={item.id}
									item={item}
									token={token}
									access={access}
									allowDownload={share.allowDownload}
								/>
							))}
						</ul>
					</>
				)}
			</main>

			<footer className="border-border border-t px-6 py-4 text-center text-muted-foreground text-xs lg:px-8">
				Shared through docstore. Only the people holding this link can see it.
			</footer>
		</div>
	);
}

function ShareItemRow({
	item,
	token,
	access,
	allowDownload,
}: {
	item: ShareItem;
	token: string;
	access: string | null;
	allowDownload: boolean;
}) {
	return (
		<li className="shell">
			<div className="flex items-center gap-4 rounded-xl bg-card px-4 py-3 shadow-soft ring-1 ring-border">
				{item.fileId ? (
					<img
						src={shareFileUrl(token, item.fileId, { access, thumbnail: true })}
						alt=""
						aria-hidden
						loading="lazy"
						className="size-14 shrink-0 rounded-md bg-muted object-cover ring-1 ring-border"
					/>
				) : (
					<span
						aria-hidden
						className="flex size-14 shrink-0 items-center justify-center rounded-md bg-muted ring-1 ring-border"
					>
						<FileTextIcon
							className="size-5 text-muted-foreground"
							strokeWidth={1.5}
						/>
					</span>
				)}

				<div className="min-w-0 flex-1">
					<p className="truncate font-semibold text-sm">{item.title}</p>
					<p className="mt-0.5 font-mono text-muted-foreground text-xs tabular-nums">
						{item.documentDate
							? formatDate(item.documentDate, item.datePrecision ?? "day")
							: "No date"}
						{item.pageCount ? ` · ${countLabel(item.pageCount, "page")}` : ""}
					</p>
				</div>

				{item.fileId && allowDownload ? (
					<div className="flex shrink-0 items-center gap-1">
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label={`Open ${item.title}`}
							nativeButton={false}
							render={
								<a
									href={shareFileUrl(token, item.fileId, {
										access,
										inline: true,
									})}
									target="_blank"
									rel="noreferrer"
								/>
							}
						>
							<ExternalLinkIcon />
						</Button>
						<Button
							variant="outline"
							size="icon-sm"
							aria-label={`Download ${item.title}`}
							nativeButton={false}
							render={
								<a
									href={shareFileUrl(token, item.fileId, { access })}
									download
								/>
							}
						>
							<DownloadIcon />
						</Button>
					</div>
				) : null}
			</div>
		</li>
	);
}

function Notice({
	icon: Icon,
	title,
	description,
}: {
	icon?: typeof TriangleAlertIcon;
	title: string;
	description: string;
}) {
	return (
		<div className="shell">
			<div className="flex flex-col items-center justify-center gap-3 rounded-xl bg-card px-6 py-14 text-center shadow-soft ring-1 ring-border">
				{Icon ? (
					<span className="flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground ring-1 ring-border">
						<Icon className="size-5" strokeWidth={1.5} />
					</span>
				) : null}
				<p className="font-bold text-base tracking-tight">{title}</p>
				<p className="max-w-md text-muted-foreground text-sm leading-relaxed">
					{description}
				</p>
			</div>
		</div>
	);
}
