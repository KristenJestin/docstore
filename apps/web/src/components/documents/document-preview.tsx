import type {
	DocumentDetail,
	DocumentFileDto,
} from "@docstore/shared/document";
import { Badge } from "@docstore/ui/components/badge";
import { Button } from "@docstore/ui/components/button";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@docstore/ui/components/tabs";
import { cn } from "@docstore/ui/lib/utils";
import { DownloadIcon, FileTextIcon } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";

import { fileDownloadUrl } from "@/lib/file-urls";
import { countLabel } from "@/lib/plural";
import { EmptyState } from "../empty-state";
import { SearchInput } from "../search-input";
import { formatFileSize } from "./document-labels";

/** Escapes the query before compiling it into a regular expression. */
function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Splits the OCR text around the searched occurrences. */
function highlight(content: string, needle: string): ReactNode {
	if (needle.trim().length < 2) {
		return content;
	}
	const pattern = new RegExp(`(${escapeRegExp(needle.trim())})`, "gi");
	// `split` with a capturing group puts the matches at the odd indexes.
	return content.split(pattern).map((part, index) =>
		index % 2 === 1 ? (
			<mark key={index} className="bg-primary text-primary-foreground">
				{part}
			</mark>
		) : (
			part
		),
	);
}

export interface DocumentPreviewProps {
	document: DocumentDetail;
	/**
	 * Stretches the card to the height of its container instead of the fixed
	 * `h-160` frame. The document page uses it for the sticky column, which is
	 * exactly one viewport minus the shell header.
	 */
	fill?: boolean;
}

/**
 * Preview column of the document page: native rendering of the file (PDF in a
 * frame, direct image), navigation between files, and a "Text" tab for the OCR
 * content with its own search.
 */
export function DocumentPreview({
	document,
	fill = false,
}: DocumentPreviewProps) {
	const files = document.files;
	const [activeId, setActiveId] = useState<string | null>(files[0]?.id ?? null);
	const [needle, setNeedle] = useState("");

	const active = files.find((file) => file.id === activeId) ?? files[0] ?? null;

	const occurrences = useMemo(() => {
		const content = document.content ?? "";
		if (needle.trim().length < 2) {
			return 0;
		}
		return (
			content.split(new RegExp(escapeRegExp(needle.trim()), "gi")).length - 1
		);
	}, [document.content, needle]);

	return (
		<div className={cn("shell", fill && "flex h-full min-h-0 flex-col")}>
			<div
				className={cn(
					"overflow-hidden rounded-xl bg-card shadow-soft ring-1 ring-border",
					fill && "flex min-h-0 flex-1 flex-col",
				)}
			>
				<Tabs
					defaultValue="preview"
					className={cn(fill && "flex min-h-0 flex-1 flex-col")}
				>
					<div className="flex flex-wrap items-center justify-between gap-3 border-border border-b bg-muted/40 px-4 py-2.5">
						<div className="flex min-w-0 items-center gap-2">
							{active ? (
								<>
									<Badge tone="outline">{active.filename}</Badge>
									<p className="font-mono text-muted-foreground text-xs tabular-nums">
										{active.pageCount
											? `${countLabel(active.pageCount, "page")} · `
											: ""}
										{formatFileSize(active.size)}
									</p>
								</>
							) : null}
						</div>
						<div className="flex items-center gap-2">
							<TabsList variant="line">
								<TabsTrigger value="preview">Preview</TabsTrigger>
								<TabsTrigger value="text">Text</TabsTrigger>
							</TabsList>
							{active ? (
								<Button
									variant="ghost"
									size="icon-sm"
									aria-label={`Download ${active.filename}`}
									nativeButton={false}
									render={
										<a
											href={fileDownloadUrl(active.id)}
											download={active.filename}
										/>
									}
								>
									<DownloadIcon />
								</Button>
							) : null}
						</div>
					</div>

					<TabsContent value="preview" className={cn(fill && "min-h-0 flex-1")}>
						{active ? (
							<FileFrame file={active} fill={fill} />
						) : (
							<div className="p-3">
								<EmptyState
									icon={FileTextIcon}
									title="No file"
									description="This document has no attached file yet."
								/>
							</div>
						)}
					</TabsContent>

					<TabsContent
						value="text"
						className={cn(fill && "min-h-0 flex-1 overflow-hidden")}
					>
						<div
							className={cn(
								"flex flex-col gap-3 p-4",
								fill && "h-full min-h-0",
							)}
						>
							<div className="flex items-center gap-3">
								<SearchInput
									className="flex-1"
									value={needle}
									onValueChange={setNeedle}
									placeholder="Search in the text…"
									label="Search in the OCR text"
								/>
								{needle.trim().length >= 2 ? (
									<span className="font-mono text-muted-foreground text-xs tabular-nums">
										{countLabel(occurrences, "occurrence")}
									</span>
								) : null}
							</div>
							<div
								data-testid="document-ocr-text"
								className={cn(
									"overflow-y-auto rounded-lg bg-muted/40 p-4 ring-1 ring-border",
									fill ? "min-h-0 flex-1" : "max-h-160",
								)}
							>
								{document.content ? (
									<pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
										{highlight(document.content, needle)}
									</pre>
								) : (
									<p className="text-muted-foreground text-sm">
										No text has been extracted yet.
									</p>
								)}
							</div>
						</div>
					</TabsContent>
				</Tabs>

				{files.length > 1 ? (
					<div className="flex flex-wrap items-center gap-2 border-border border-t bg-muted/40 px-4 py-2.5">
						{files.map((file) => (
							<Button
								key={file.id}
								size="sm"
								variant={file.id === active?.id ? "default" : "outline"}
								onClick={() => setActiveId(file.id)}
							>
								{file.filename}
							</Button>
						))}
					</div>
				) : null}
			</div>
		</div>
	);
}

/** Native rendering: direct image, PDF in a frame, any other format as a link. */
export function FileFrame({
	file,
	fill = false,
}: {
	file: DocumentFileDto;
	/** Fills the height of the container instead of the fixed `h-160` frame. */
	fill?: boolean;
}) {
	const url = fileDownloadUrl(file.id, { inline: true });

	if (file.mime.startsWith("image/")) {
		return (
			<div
				className={cn(
					"flex justify-center overflow-auto bg-muted/50 p-6",
					fill && "h-full",
				)}
			>
				{/* `max-w-full` keeps a wide scan inside the column: without it the
				    image overflowed the preview and the review sheet. */}
				<img
					src={url}
					alt={file.filename}
					className={cn(
						"w-auto max-w-full rounded-md object-contain shadow-lift ring-1 ring-border",
						fill ? "max-h-full" : "max-h-160",
					)}
				/>
			</div>
		);
	}

	if (file.mime === "application/pdf") {
		return (
			<iframe
				src={url}
				title={file.filename}
				className={cn("w-full border-0 bg-muted/50", fill ? "h-full" : "h-160")}
			/>
		);
	}

	return (
		<div className="p-3">
			<EmptyState
				icon={FileTextIcon}
				title="Preview unavailable"
				description={`The "${file.mime}" format cannot be displayed in the browser.`}
				action={
					<Button
						variant="outline"
						nativeButton={false}
						render={
							<a href={fileDownloadUrl(file.id)} download={file.filename} />
						}
					>
						<DownloadIcon />
						Download
					</Button>
				}
			/>
		</div>
	);
}
