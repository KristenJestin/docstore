import type {
	PublicUploadLink,
	PublicUploadResult,
} from "@docstore/shared/upload-link";
import {
	UPLOAD_LINK_MAX_FILE_BYTES,
	UPLOAD_LINK_MAX_FILES,
} from "@docstore/shared/upload-link";
import { Button } from "@docstore/ui/components/button";
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
	XIcon,
} from "lucide-react";
import { type DragEvent, useId, useState } from "react";

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
 */
export const Route = createFileRoute("/u/$token")({
	ssr: false,
	component: PublicUploadPage,
});

type LinkState =
	| { kind: "ok"; link: PublicUploadLink }
	| { kind: "missing" }
	| { kind: "throttled" };

/** Identity of a picked file, so the same one is not queued twice. */
function fileKey(file: File): string {
	return `${file.name}:${file.size}:${file.lastModified}`;
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

function PublicUploadPage() {
	const { token } = Route.useParams();
	const inputId = useId();

	const [files, setFiles] = useState<File[]>([]);
	const [dragging, setDragging] = useState(false);
	const [sending, setSending] = useState(false);
	const [result, setResult] = useState<PublicUploadResult | null>(null);
	const [failure, setFailure] = useState<string | null>(null);

	const state = useQuery({
		queryKey: ["public-upload-link", token],
		queryFn: () => loadLink(token),
		retry: false,
	});

	const addFiles = (incoming: FileList | File[]) => {
		// A `FileList` is live: the input is reset right after the change event,
		// so it has to be copied now and not inside the lazy state updater.
		const list = Array.from(incoming);
		setResult(null);
		setFailure(null);
		setFiles((current) => {
			const known = new Set(current.map(fileKey));
			const added = list.filter((file) => !known.has(fileKey(file)));
			return [...current, ...added].slice(0, UPLOAD_LINK_MAX_FILES);
		});
	};

	const send = async () => {
		if (files.length === 0) {
			return;
		}
		setSending(true);
		setFailure(null);
		try {
			const body = new FormData();
			for (const file of files) {
				body.append("files", file);
			}
			const response = await fetch(publicUploadApiUrl(token), {
				method: "POST",
				body,
			});
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
				setFailure("The drop failed. Please try again.");
				return;
			}
			setResult((await response.json()) as PublicUploadResult);
			setFiles([]);
			await state.refetch();
		} catch {
			setFailure("The server could not be reached.");
		} finally {
			setSending(false);
		}
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
										<UploadCloudIcon className="size-5" strokeWidth={1.5} />
									</span>
									<span className="font-semibold text-sm">
										Drop your files here
									</span>
									<span className="text-muted-foreground text-xs">
										or click to select them — {UPLOAD_LINK_MAX_FILES} files at
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

								{files.length > 0 ? (
									<ul className="mt-4 flex flex-col gap-1.5">
										{files.map((file) => (
											<li
												key={fileKey(file)}
												className="flex items-center gap-3 rounded-lg bg-muted/50 px-3 py-2 ring-1 ring-border"
											>
												<UploadCloudIcon className="size-4 shrink-0 text-muted-foreground" />
												<span className="min-w-0 flex-1 truncate text-sm">
													{file.name}
												</span>
												<span className="shrink-0 font-mono text-muted-foreground text-xs tabular-nums">
													{formatFileSize(file.size)}
												</span>
												<Button
													variant="ghost"
													size="icon-sm"
													aria-label={`Remove ${file.name}`}
													onClick={() =>
														setFiles((current) =>
															current.filter((item) => item !== file),
														)
													}
												>
													<XIcon />
												</Button>
											</li>
										))}
									</ul>
								) : null}

								{failure ? (
									<p className="mt-4 rounded-lg bg-tone-danger px-3 py-2 text-sm text-tone-danger-foreground">
										{failure}
									</p>
								) : null}

								{result ? <UploadReport result={result} /> : null}

								<div className="mt-6 flex items-center justify-between gap-3">
									<p className="font-mono text-muted-foreground text-xs tabular-nums">
										{link.remainingUses === null
											? "unlimited uses"
											: `${countLabel(link.remainingUses, "use")} left`}
									</p>
									<Button
										disabled={files.length === 0 || sending}
										onClick={send}
									>
										{sending ? <LoaderIcon className="animate-spin" /> : null}
										{sending
											? "Sending…"
											: `Send ${countLabel(files.length, "file")}`}
									</Button>
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

/** Summary of what the server did with the dropped files. */
function UploadReport({ result }: { result: PublicUploadResult }) {
	return (
		<div
			data-testid="upload-result"
			className="mt-4 flex flex-col gap-2 rounded-lg bg-muted/50 p-3 ring-1 ring-border"
		>
			<p className="flex items-center gap-2 font-semibold text-sm">
				<CheckCircle2Icon className="size-4 text-tone-success-foreground" />
				{countLabel(result.created.length, "file")} received
			</p>
			{result.duplicates.length > 0 ? (
				<p className="flex items-center gap-2 text-muted-foreground text-sm">
					<CopyIcon className="size-4" />
					{result.duplicates.length} already in the library
				</p>
			) : null}
			{result.errors.length > 0 ? (
				<ul className="flex flex-col gap-1">
					{result.errors.map((error) => (
						<li
							key={error.filename}
							className="flex items-center gap-2 text-sm text-tone-danger-foreground"
						>
							<TriangleAlertIcon className="size-4 shrink-0" />
							<span className="min-w-0 truncate">
								{error.filename} — {error.message}
							</span>
						</li>
					))}
				</ul>
			) : null}
		</div>
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
