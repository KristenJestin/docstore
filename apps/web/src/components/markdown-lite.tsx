import { cn } from "@docstore/ui/lib/utils";
import type { ReactNode } from "react";

/**
 * Minimal Markdown renderer, for the free-text notes of a document.
 *
 * Deliberately tiny: paragraphs, bold, bulleted and numbered lists, and links.
 * Everything is turned into React elements — nothing is ever fed to
 * `dangerouslySetInnerHTML` — so raw HTML written in a note is shown as text
 * instead of being executed.
 */

/** Schemes a link is allowed to point at; anything else stays plain text. */
const SAFE_LINK = /^(https?:|mailto:)/i;

/** `**bold**` and `[label](url)`, whichever comes first. */
const INLINE = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;

/** `- item`, `* item` or `1. item`. */
const BULLET = /^\s*[-*]\s+/;
const NUMBERED = /^\s*\d+[.)]\s+/;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
	const nodes: ReactNode[] = [];
	let cursor = 0;
	let index = 0;
	INLINE.lastIndex = 0;
	let match = INLINE.exec(text);
	while (match !== null) {
		if (match.index > cursor) {
			nodes.push(text.slice(cursor, match.index));
		}
		const [whole, bold, label, href] = match;
		if (bold !== undefined) {
			nodes.push(<strong key={`${keyPrefix}-b${index}`}>{bold}</strong>);
		} else if (label !== undefined && href !== undefined) {
			nodes.push(
				SAFE_LINK.test(href) ? (
					<a
						key={`${keyPrefix}-a${index}`}
						href={href}
						target="_blank"
						rel="noreferrer noopener"
						className="underline underline-offset-2 hover:text-foreground"
					>
						{label}
					</a>
				) : (
					whole
				),
			);
		}
		cursor = match.index + whole.length;
		index += 1;
		match = INLINE.exec(text);
	}
	if (cursor < text.length) {
		nodes.push(text.slice(cursor));
	}
	return nodes;
}

/** Lines separated by a blank line make one block each. */
function toBlocks(text: string): string[][] {
	const blocks: string[][] = [];
	let current: string[] = [];
	for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
		if (raw.trim().length === 0) {
			if (current.length > 0) {
				blocks.push(current);
			}
			current = [];
		} else {
			current.push(raw);
		}
	}
	if (current.length > 0) {
		blocks.push(current);
	}
	return blocks;
}

export interface MarkdownLiteProps {
	text: string;
	className?: string;
}

export function MarkdownLite({ text, className }: MarkdownLiteProps) {
	const blocks = toBlocks(text);
	if (blocks.length === 0) {
		return null;
	}
	return (
		<div
			className={cn("flex flex-col gap-2 text-sm leading-relaxed", className)}
		>
			{blocks.map((lines, blockIndex) => {
				const key = `block-${blockIndex}`;
				const bulleted = lines.every((line) => BULLET.test(line));
				const numbered =
					!bulleted && lines.every((line) => NUMBERED.test(line));
				if (bulleted || numbered) {
					const items = lines.map((line) =>
						line.replace(bulleted ? BULLET : NUMBERED, ""),
					);
					const content = items.map((item, itemIndex) => (
						<li key={`${key}-${itemIndex}`}>
							{renderInline(item, `${key}-${itemIndex}`)}
						</li>
					));
					return numbered ? (
						<ol key={key} className="list-decimal pl-5">
							{content}
						</ol>
					) : (
						<ul key={key} className="list-disc pl-5">
							{content}
						</ul>
					);
				}
				return (
					<p key={key}>
						{lines.map((line, lineIndex) => (
							<span key={`${key}-${lineIndex}`}>
								{lineIndex > 0 ? <br /> : null}
								{renderInline(line, `${key}-${lineIndex}`)}
							</span>
						))}
					</p>
				);
			})}
		</div>
	);
}
