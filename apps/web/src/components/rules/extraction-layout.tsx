import type { OcrPage } from "@docstore/shared/document";
import type { ExtractionBox } from "@docstore/shared/extraction";
import { Badge } from "@docstore/ui/components/badge";
import { Button } from "@docstore/ui/components/button";
import { Skeleton } from "@docstore/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { ArrowRightIcon, ScanTextIcon } from "lucide-react";
import { type PointerEvent as ReactPointerEvent, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { MonoLabel } from "@/components/mono-label";
import { orpc } from "@/utils/orpc";

/** Normalised rectangle drawn on a page, as stored by the `zone` strategy. */
export interface ZoneRect {
	page: number;
	x0: number;
	y0: number;
	x1: number;
	y1: number;
}

/** Lines rebuilt from the OCR layer of the chosen document. */
function useLayoutPreview(documentId: string | null) {
	return useQuery({
		...orpc.extractionRule.preview.queryOptions({
			input: { documentId: documentId ?? "" },
		}),
		enabled: Boolean(documentId),
	});
}

export interface LayoutLinesListProps {
	documentId: string | null;
	/** Clicking a line fills the anchor label with its text. */
	onPickLine?: (text: string) => void;
}

/**
 * Page-by-page list of the rebuilt lines (`extractionRule.preview`): the
 * quickest way to copy a real label into an anchor strategy.
 */
export function LayoutLinesList({
	documentId,
	onPickLine,
}: LayoutLinesListProps) {
	const preview = useLayoutPreview(documentId);

	if (!documentId) {
		return (
			<p className="text-muted-foreground text-sm">
				Choose a document to see its text layout.
			</p>
		);
	}
	if (preview.isLoading) {
		return <Skeleton className="h-40 w-full" />;
	}

	const lines = preview.data?.lines ?? [];
	if (lines.length === 0) {
		return (
			<EmptyState
				icon={ScanTextIcon}
				size="sm"
				title="No text layer"
				description="This document has no positioned words: only the regex strategy applies."
			/>
		);
	}

	const pages = [...new Set(lines.map((line) => line.page))].sort(
		(left, right) => left - right,
	);

	return (
		<div className="flex max-h-96 flex-col gap-3 overflow-y-auto">
			{pages.map((page) => (
				<section key={page} className="flex flex-col gap-1">
					<MonoLabel>Page {page + 1}</MonoLabel>
					<ul className="flex flex-col">
						{lines
							.filter((line) => line.page === page)
							.map((line, index) => (
								<li key={`${page}-${index}`}>
									{onPickLine ? (
										<button
											type="button"
											onClick={() => onPickLine(line.text)}
											title="Use this line as the anchor label"
											className="w-full cursor-pointer truncate rounded-md px-2 py-1 text-left font-mono text-xs transition-colors duration-200 ease-premium hover:bg-accent"
										>
											{line.text}
										</button>
									) : (
										<p className="truncate px-2 py-1 font-mono text-xs">
											{line.text}
										</p>
									)}
								</li>
							))}
					</ul>
				</section>
			))}
		</div>
	);
}

export interface ZoneSelectorProps {
	documentId: string | null;
	value: ZoneRect;
	onChange: (zone: ZoneRect) => void;
	/** Words kept by the last test, highlighted over the page. */
	matchedWords?: ExtractionBox[];
}

/**
 * Rectangle drawn over the word boxes of a page: dragging produces the
 * normalised `x0/y0/x1/y1` of the `zone` strategy.
 */
export function ZoneSelector({
	documentId,
	value,
	onChange,
	matchedWords = [],
}: ZoneSelectorProps) {
	const preview = useLayoutPreview(documentId);
	const fileId = preview.data?.fileId ?? null;

	const layout = useQuery({
		...orpc.document.getFileLayout.queryOptions({
			input: { fileId: fileId ?? "" },
		}),
		enabled: Boolean(fileId),
	});

	const [drag, setDrag] = useState<ZoneRect | null>(null);

	if (!documentId) {
		return (
			<p className="text-muted-foreground text-sm">
				Choose a document to draw a zone on one of its pages.
			</p>
		);
	}
	if (preview.isLoading || layout.isLoading) {
		return <Skeleton className="h-96 w-full" />;
	}

	const pages = layout.data?.ocrLayout?.pages ?? [];
	const pageIndex = Math.min(Math.max(value.page - 1, 0), pages.length - 1);
	const page: OcrPage | undefined = pages[pageIndex];

	if (!page) {
		return (
			<EmptyState
				icon={ScanTextIcon}
				size="sm"
				title="No OCR layer"
				description="The zone strategy needs positioned words; use a regex instead."
			/>
		);
	}

	const rect = drag ?? value;
	const left = Math.min(rect.x0, rect.x1) * page.width;
	const top = Math.min(rect.y0, rect.y1) * page.height;
	const width = Math.abs(rect.x1 - rect.x0) * page.width;
	const height = Math.abs(rect.y1 - rect.y0) * page.height;

	const pointToZone = (
		event: ReactPointerEvent<SVGSVGElement>,
	): { x: number; y: number } => {
		const bounds = event.currentTarget.getBoundingClientRect();
		return {
			x: Math.min(Math.max((event.clientX - bounds.left) / bounds.width, 0), 1),
			y: Math.min(Math.max((event.clientY - bounds.top) / bounds.height, 0), 1),
		};
	};

	return (
		<div className="flex flex-col gap-2">
			<div className="flex flex-wrap items-center gap-2">
				{pages.map((_item, index) => (
					<Button
						key={index}
						size="sm"
						variant={index === pageIndex ? "default" : "outline"}
						onClick={() => onChange({ ...value, page: index + 1 })}
					>
						Page {index + 1}
					</Button>
				))}
				<span className="min-w-0 flex-1" />
				<Badge tone="outline" className="font-mono tabular-nums">
					{rect.x0.toFixed(2)} {rect.y0.toFixed(2)}
					<ArrowRightIcon aria-hidden />
					{rect.x1.toFixed(2)} {rect.y1.toFixed(2)}
				</Badge>
			</div>

			<svg
				aria-label="Draw the extraction zone"
				viewBox={`0 0 ${page.width} ${page.height}`}
				preserveAspectRatio="xMidYMid meet"
				style={{ aspectRatio: `${page.width} / ${page.height}` }}
				className="w-full cursor-crosshair touch-none rounded-lg bg-muted/40 ring-1 ring-border"
				onPointerDown={(event) => {
					const point = pointToZone(event);
					event.currentTarget.setPointerCapture(event.pointerId);
					setDrag({
						page: pageIndex + 1,
						x0: point.x,
						y0: point.y,
						x1: point.x,
						y1: point.y,
					});
				}}
				onPointerMove={(event) => {
					if (!drag) {
						return;
					}
					const point = pointToZone(event);
					setDrag({ ...drag, x1: point.x, y1: point.y });
				}}
				onPointerUp={() => {
					if (!drag) {
						return;
					}
					onChange({
						page: drag.page,
						x0: Math.min(drag.x0, drag.x1),
						y0: Math.min(drag.y0, drag.y1),
						x1: Math.max(drag.x0, drag.x1),
						y1: Math.max(drag.y0, drag.y1),
					});
					setDrag(null);
				}}
			>
				<title>Word boxes of page {pageIndex + 1}</title>
				{page.words.map((word, index) => (
					<rect
						key={index}
						x={word.x0}
						y={word.y0}
						width={Math.max(word.x1 - word.x0, 1)}
						height={Math.max(word.y1 - word.y0, 1)}
						className="fill-muted-foreground/25"
					/>
				))}
				{matchedWords
					.filter((word) => word.page === pageIndex)
					.map((word, index) => (
						<rect
							key={`matched-${index}`}
							x={word.x0}
							y={word.y0}
							width={Math.max(word.x1 - word.x0, 1)}
							height={Math.max(word.y1 - word.y0, 1)}
							className="fill-primary/70"
						/>
					))}
				{width > 0 && height > 0 ? (
					<rect
						x={left}
						y={top}
						width={width}
						height={height}
						strokeWidth={3}
						className="fill-primary/15 stroke-primary"
					/>
				) : null}
			</svg>

			<p className="text-muted-foreground text-xs">
				Drag across the page to draw the zone. Grey blocks are the words found
				in the OCR layer.
			</p>
		</div>
	);
}
