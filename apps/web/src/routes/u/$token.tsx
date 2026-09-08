import type {
	PublicUploadLink,
	PublicUploadResult,
} from "@docstore/shared/upload-link";
import {
	UPLOAD_LINK_MAX_FILE_BYTES,
	UPLOAD_LINK_MAX_FILES,
} from "@docstore/shared/upload-link";
import { cn } from "@docstore/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	CheckCircle2Icon,
	CopyIcon,
	LinkIcon,
	LoaderIcon,
	TriangleAlertIcon,
	UploadCloudIcon,
} from "lucide-react";
import { type DragEvent, useId, useRef, useState } from "react";

import { BrandLogo } from "@/components/brand-logo";
import { formatFileSize } from "@/components/documents/document-labels";
import { UPLOAD_ACCEPT } from "@/components/documents/upload-dialog";
import { MonoLabel } from "@/components/mono-label";
import { ThemeToggle } from "@/components/theme-toggle";
import { countLabel } from "@/lib/plural";
import { publicUploadApiUrl } from "@/lib/upload-link-url";

/**
 * Public drop page (`/u/<token>`).
 *
 * No session, no oRPC: the two endpoints are plain HTTP routes of the server
 * (`GET`/`POST /u/:token`), and the multipart body is sent with `fetch`.
 *
 * Dropping or picking files sends them straight away, like the signed-in
 * tracker: there is no second gesture to forget.
 */
export const Route = createFileRoute("/u/$token")({
	ssr: false,
	component: PublicUploadPage,
});

type LinkState =
	| { kind: "ok"; link: PublicUploadLink }
	| { kind: "missing" }
	| { kind: "throttled" };

/** Outcome of one file, as the page shows it. */
type RowStatus = "sending" | "received" | "duplicate" | "error";

interface UploadRow {
	key: string;
	name: string;
	size?: number;
	status: RowStatus;
	message?: string;
}

async function loadLink(token: string): Promise<LinkState> {
	const response = await fetch(publicUploadApiUrl(token));
	if (response.status === 429) {
		return { kind: "throttled" };
	}
	if (!response.ok) {
		return { kind: "missing" };
	}
	return { kind: "ok", link: (await response.json()) as PublicUploadLink };
}

let sequence = 0;
function nextKey(): string {
	sequence += 1;
	return `row-${sequence}`;
}

function PublicUploadPage() {
	const { token } = Route.useParams();
	const inputId = useId();

	const [rows, setRows] = useState<UploadRow[]>([]);
	const [dragging, setDragging] = useState(false);
	const [sending, setSending] = useState(false);
	const [failure, setFailure] = useState<string | null>(null);
	/** Serializes the drops: one use of the link per batch, in order. */
	const pending = useRef<Promise<void>>(Promise.resolve());

	const state = useQuery({
		queryKey: ["public-upload-link", token],
		queryFn: () => loadLink(token),
		retry: false,
	});

	/** Replaces the rows of a batch with what the server said about them. */
	const settle = (keys: string[], result: PublicUploadResult): void => {
		const done: UploadRow[] = [
			...result.created.map((entry) => ({
				key: nextKey(),
				name: entry.filename,
				status: "received" as const,
			})),
			...result.duplicates.map((entry) => ({
				key: nextKey(),
				name: entry.filename,
				status: "duplicate" as const,
				message: "Already in the library",
			})),
			...result.errors.map((entry) => ({
				key: nextKey(),
				name: entry.filename,
				status: "error" as const,
				message: entry.message,
			})),
		];
		setRows((current) => [
			...current.filter((row) => !keys.includes(row.key)),
			...done,
		]);
	};

	const send = async (files: File[]): Promise<void> => {
		const batch = files.slice(0, UPLOAD_LINK_MAX_FILES);
		const queued: UploadRow[] = batch.map((file) => ({
			key: nextKey(),
			name: file.name,
			size: file.size,
			status: "sending",
		}));
		setRows((current) => [...current, ...queued]);
		setFailure(null);
		setSending(true);

		try {
			const body = new FormData();
			for (const file of batch) {
				body.append("files", file);
			}
			const response = await fetch(publicUploadApiUrl(token), {
				method: "POST",
				body,
			});
			if (response.status === 410) {
				setFailure("This link is no longer valid.");
				setRows((current) =>
					current.filter((row) => !queued.some((item) => item.key === row.key)),
				);
				await state.refetch();
				return;
			}
			if (response.status === 429) {
				setFailure("Too many attempts. Please wait a minute and try again.");
				setRows((current) =>
					current.filter((row) => !queued.some((item) => item.key === row.key)),
				);
				return;
			}
			if (!response.ok) {
				setFailure("The drop failed. Please try again.");
				setRows((current) =>
					current.filter((row) => !queued.some((item) => item.key === row.key)),
				);
				return;
			}
			settle(
				queued.map((row) => row.key),
				(await response.json()) as PublicUploadResult,
			);
			await state.refetch();
		} catch {
			setFailure("The server could not be reached.");
			setRows((current) =>
				current.filter((row) => !queued.some((item) => item.key === row.key)),
			);
		} finally {
			setSending(false);
		}
	};

	/** Files start uploading the moment they land on the page. */
	const addFiles = (incoming: FileList | File[]) => {
		const files = Array.from(incoming);
		if (files.length === 0) return;
		pending.current = pending.current.then(() => send(files));
	};

	const onDrop = (event: DragEvent<HTMLElement>) => {
		event.preventDefault();
		setDragging(false);
		if (event.dataTransfer.files.length > 0) {
			addFiles(event.dataTransfer.files);
		}
	};

	const data = state.data;
	const link = data?.kind === "ok" ? data.link : null;
	const exhausted = link?.remainingUses === 0;
	const closed = Boolean(link && (link.expired || exhausted));
	const received = rows.filter((row) => row.status === "received").length;

	return (
		<div className="relative flex min-h-svh flex-col items-center justify-center bg-background px-4 py-10">
			<ThemeToggle className="absolute top-4 right-4" />

			<div className="w-full max-w-xl">
				<div className="mb-8 flex flex-col items-center text-center">
					<BrandLogo size="lg" />
				</div>

				<div className="shell">
					<div className="rounded-xl bg-card p-6 shadow-lift ring-1 ring-border">
						{state.isLoading ? (
							<p className="py-10 text-center text-muted-foreground text-sm">
								Loading…
							</p>
						) : data?.kind === "throttled" ? (
							<PageNotice
								icon={TriangleAlertIcon}
								title="Too many attempts"
								description="Please wait a minute before opening this link again."
							/>
						) : data?.kind !== "ok" || !link ? (
							<PageNotice
								icon={LinkIcon}
								title="Unknown link"
								description="This drop link does not exist, or it has been deleted."
							/>
						) : closed ? (
							<PageNotice
								icon={LinkIcon}
								title={link.expired ? "Link expired" : "Link used up"}
								description={
									link.expired
										? "This drop link has passed its expiry date."
										: "This drop link has reached its maximum number of uses."
								}
							/>
						) : (
							<>
								<MonoLabel className="block">Document drop</MonoLabel>
								<h1 className="mt-2 font-extrabold text-2xl leading-tight tracking-tight">
									{link.name}
								</h1>
								{link.message ? (
									<p className="mt-2 whitespace-pre-wrap text-muted-foreground text-sm">
										{link.message}
									</p>
								) : null}

								<label
									htmlFor={inputId}
									onDragOver={(event) => {
										event.preventDefault();
										setDragging(true);
									}}
									onDragLeave={() => setDragging(false)}
									onDrop={onDrop}
									className={cn(
										"mt-6 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-border border-dashed px-6 py-10 text-center transition-colors duration-200 ease-premium hover:bg-muted/50",
										dragging && "border-ring bg-selection",
									)}
								>
									<span className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground ring-1 ring-border">
										{sending ? (
											<LoaderIcon
												className="size-5 animate-spin"
												strokeWidth={1.5}
											/>
										) : (
											<UploadCloudIcon className="size-5" strokeWidth={1.5} />
										)}
									</span>
									<span className="font-semibold text-sm">
										{sending ? "Sending…" : "Drop your files here"}
									</span>
									<span className="text-muted-foreground text-xs">
										they are sent right away — {UPLOAD_LINK_MAX_FILES} files at
										most, {formatFileSize(UPLOAD_LINK_MAX_FILE_BYTES)} each
									</span>
									<input
										id={inputId}
										type="file"
										multiple
										accept={UPLOAD_ACCEPT}
										className="sr-only"
										onChange={(event) => {
											if (event.target.files) {
												addFiles(event.target.files);
											}
											event.target.value = "";
										}}
									/>
								</label>

								{rows.length > 0 ? (
									<ul
										data-testid="upload-result"
										className="mt-4 flex flex-col gap-1.5"
									>
										{rows.map((row) => (
											<li
												key={row.key}
												className="flex items-center gap-3 rounded-lg bg-muted/50 px-3 py-2 ring-1 ring-border"
											>
												<RowIcon status={row.status} />
												<span className="min-w-0 flex-1 truncate text-sm">
													{row.name}
													{row.message ? (
														<span className="text-muted-foreground">
															{" "}
															— {row.message}
														</span>
													) : null}
												</span>
												{row.size === undefined ? null : (
													<span className="shrink-0 font-mono text-muted-foreground text-xs tabular-nums">
														{formatFileSize(row.size)}
													</span>
												)}
											</li>
										))}
									</ul>
								) : null}

								{failure ? (
									<p className="mt-4 rounded-lg bg-tone-danger px-3 py-2 text-sm text-tone-danger-foreground">
										{failure}
									</p>
								) : null}

								<div className="mt-6 flex items-center justify-between gap-3">
									<p className="font-mono text-muted-foreground text-xs tabular-nums">
										{link.remainingUses === null
											? "unlimited uses"
											: `${countLabel(link.remainingUses, "use")} left`}
									</p>
									{received > 0 ? (
										<p className="flex items-center gap-2 font-semibold text-sm">
											<CheckCircle2Icon className="size-4 text-tone-success-foreground" />
											{countLabel(received, "file")} received
										</p>
									) : null}
								</div>
							</>
						)}
					</div>
				</div>

				<p className="mt-4 text-center text-muted-foreground text-xs">
					Files are sent straight to the household library. Nothing else on this
					page is shared.
				</p>
			</div>
		</div>
	);
}

function RowIcon({ status }: { status: RowStatus }) {
	if (status === "sending") {
		return <LoaderIcon className="size-4 shrink-0 animate-spin text-primary" />;
	}
	if (status === "received") {
		return (
			<CheckCircle2Icon className="size-4 shrink-0 text-tone-success-foreground" />
		);
	}
	if (status === "duplicate") {
		return <CopyIcon className="size-4 shrink-0 text-tone-info-foreground" />;
	}
	return (
		<TriangleAlertIcon className="size-4 shrink-0 text-tone-danger-foreground" />
	);
}

function PageNotice({
	icon: Icon,
	title,
	description,
}: {
	icon: typeof LinkIcon;
	title: string;
	description: string;
}) {
	return (
		<div className="flex flex-col items-center gap-3 py-8 text-center">
			<span className="flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground ring-1 ring-border">
				<Icon className="size-5" strokeWidth={1.5} />
			</span>
			<p className="font-bold text-base tracking-tight">{title}</p>
			<p className="max-w-sm text-muted-foreground text-sm">{description}</p>
		</div>
	);
}
