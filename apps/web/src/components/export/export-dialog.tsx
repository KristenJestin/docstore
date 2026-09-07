import type { ExportFilters, ExportLayout } from "@docstore/shared/export";
import {
	DEFAULT_EXPORT_TEMPLATE,
	EXPORT_LAYOUTS,
} from "@docstore/shared/export";
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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@docstore/ui/components/select";
import { Skeleton } from "@docstore/ui/components/skeleton";
import { Switch } from "@docstore/ui/components/switch";
import { useQuery } from "@tanstack/react-query";
import { DownloadIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";

import { formatFileSize } from "@/components/documents/document-labels";
import { FormField } from "@/components/form-field";
import { MonoLabel } from "@/components/mono-label";
import { TITLE_PLACEHOLDERS } from "@/components/rules/rule-labels";
import { exportApiUrl } from "@/lib/file-urls";
import { orpc } from "@/utils/orpc";

/** Delay before the preview is recomputed after a keystroke. */
const PREVIEW_DEBOUNCE_MS = 400;

/** Name used when the response carries no usable `Content-Disposition`. */
const DEFAULT_EXPORT_FILENAME = "docstore-export.zip";

/**
 * File name advertised by `POST /api/export`. The header is readable
 * cross-origin because the server lists it in `Access-Control-Expose-Headers`;
 * without it the browser hides the header and the default name is used.
 *
 * Both forms are accepted: `filename*=UTF-8''…` (percent-encoded, preferred)
 * and the plain quoted `filename="…"`.
 */
export function filenameFromContentDisposition(
	header: string | null,
): string | null {
	if (!header) {
		return null;
	}
	const extended = /filename\*\s*=\s*[^']*'[^']*'([^;]+)/i.exec(header)?.[1];
	if (extended) {
		try {
			return decodeURIComponent(extended.trim()) || null;
		} catch {
			// Malformed percent-encoding: fall through to the plain form.
		}
	}
	const plain = /filename\s*=\s*"([^"]+)"|filename\s*=\s*([^;]+)/i.exec(header);
	return (plain?.[1] ?? plain?.[2])?.trim() || null;
}

/** English labels of the folder layouts. */
export const EXPORT_LAYOUT_LABELS: Record<ExportLayout, string> = {
	flat: "Flat (no folder)",
	"by-year": "One folder per year",
	"by-party": "One folder per party",
	"by-category": "One folder per category",
};

export interface ExportDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Filters currently applied on `/documents`. */
	filters: ExportFilters;
}

/**
 * Tree export of the current selection: layout, title template, metadata and
 * sensitive documents, with a live preview (`export.preview`) before the ZIP is
 * downloaded from `POST /api/export`.
 */
export function ExportDialog({
	open,
	onOpenChange,
	filters,
}: ExportDialogProps) {
	const ids = useId();

	const [template, setTemplate] = useState(DEFAULT_EXPORT_TEMPLATE);
	const [debounced, setDebounced] = useState(DEFAULT_EXPORT_TEMPLATE);
	const [layout, setLayout] = useState<ExportLayout>("flat");
	const [includeMetadata, setIncludeMetadata] = useState(true);
	const [includeSensitive, setIncludeSensitive] = useState(false);
	const [downloading, setDownloading] = useState(false);

	useEffect(() => {
		const timer = setTimeout(() => setDebounced(template), PREVIEW_DEBOUNCE_MS);
		return () => clearTimeout(timer);
	}, [template]);

	const input = {
		filters,
		template: debounced.trim() || DEFAULT_EXPORT_TEMPLATE,
		layout,
		includeMetadata,
		includeSensitive,
	};

	const preview = useQuery({
		...orpc.export.preview.queryOptions({ input }),
		enabled: open,
	});

	const download = async () => {
		setDownloading(true);
		try {
			const response = await fetch(exportApiUrl(), {
				method: "POST",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(input),
			});
			if (!response.ok) {
				toast.error("The export failed.", {
					description: `The server answered ${response.status}.`,
				});
				return;
			}
			const filename =
				filenameFromContentDisposition(
					response.headers.get("Content-Disposition"),
				) ?? DEFAULT_EXPORT_FILENAME;
			const blob = await response.blob();
			const url = URL.createObjectURL(blob);
			const anchor = document.createElement("a");
			anchor.href = url;
			anchor.download = filename;
			anchor.click();
			URL.revokeObjectURL(url);
			toast.success("Archive downloaded.");
			onOpenChange(false);
		} catch {
			toast.error("The export failed.", {
				description: "The server could not be reached.",
			});
		} finally {
			setDownloading(false);
		}
	};

	const count = preview.data?.count ?? 0;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>Export</DialogTitle>
					<DialogDescription>
						A ZIP of the original files, renamed with a template and laid out in
						folders. The current filters define the selection.
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-4">
					<FormField label="Layout" htmlFor={`${ids}-layout`}>
						<Select
							items={EXPORT_LAYOUT_LABELS}
							value={layout}
							onValueChange={(value) => setLayout(value as ExportLayout)}
						>
							<SelectTrigger id={`${ids}-layout`} className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{EXPORT_LAYOUTS.map((value) => (
									<SelectItem key={value} value={value}>
										{EXPORT_LAYOUT_LABELS[value]}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</FormField>

					<FormField
						label="File name template"
						htmlFor={`${ids}-template`}
						hint="Click a placeholder to append it."
					>
						<Input
							id={`${ids}-template`}
							value={template}
							className="font-mono"
							onChange={(event) => setTemplate(event.target.value)}
						/>
					</FormField>

					<div className="flex flex-wrap gap-1.5">
						{TITLE_PLACEHOLDERS.map((placeholder) => (
							<Button
								key={placeholder.token}
								type="button"
								variant="secondary"
								size="sm"
								title={placeholder.hint}
								onClick={() =>
									setTemplate((current) => `${current}${placeholder.token}`)
								}
							>
								<span className="font-mono text-xs">{placeholder.token}</span>
							</Button>
						))}
					</div>

					<div className="flex items-center justify-between gap-4">
						<div>
							<p className="text-sm">Include metadata</p>
							<p className="text-muted-foreground text-xs">
								Adds metadata.json and manifest.csv at the root.
							</p>
						</div>
						<Switch
							aria-label="Include metadata"
							checked={includeMetadata}
							onCheckedChange={setIncludeMetadata}
						/>
					</div>

					<div className="flex items-center justify-between gap-4">
						<div>
							<p className="text-sm">Include sensitive documents</p>
							<p className="flex items-center gap-1.5 text-tone-warning-foreground text-xs">
								<TriangleAlertIcon aria-hidden className="size-3.5" />
								They leave the store decrypted, in a plain archive.
							</p>
						</div>
						<Switch
							aria-label="Include sensitive documents"
							checked={includeSensitive}
							onCheckedChange={setIncludeSensitive}
						/>
					</div>

					<div className="shell">
						<div className="rounded-xl bg-card px-4 py-3 shadow-soft ring-1 ring-border">
							<div className="flex flex-wrap items-center justify-between gap-2">
								<MonoLabel>Preview</MonoLabel>
								{preview.isLoading ? (
									<Skeleton className="h-4 w-32" />
								) : (
									<p className="text-muted-foreground text-xs">
										<span
											data-testid="export-preview-count"
											className="font-mono font-semibold text-foreground tabular-nums"
										>
											{count}
										</span>{" "}
										document{count === 1 ? "" : "s"} ·{" "}
										<span className="font-mono tabular-nums">
											{formatFileSize(preview.data?.bytes ?? 0)}
										</span>
									</p>
								)}
							</div>
							{preview.data?.truncated ? (
								<Badge tone="warning" className="mt-2">
									selection truncated
								</Badge>
							) : null}
							{preview.data && preview.data.sample.length > 0 ? (
								<ul className="mt-2 flex flex-col gap-0.5">
									{preview.data.sample.map((path) => (
										<li
											key={path}
											className="truncate font-mono text-muted-foreground text-xs"
										>
											{path}
										</li>
									))}
								</ul>
							) : null}
						</div>
					</div>
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button disabled={downloading || count === 0} onClick={download}>
						<DownloadIcon />
						{downloading ? "Preparing…" : "Download ZIP"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
