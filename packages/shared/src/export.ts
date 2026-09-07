import { z } from "zod";
import { listDocumentsInput } from "./document";

/**
 * Tree export (SPEC §8 iteration 7): a ZIP of the original files, renamed with
 * a title template and laid out in folders.
 */

/** Default template, aligned with the `set_title` rule action. */
export const DEFAULT_EXPORT_TEMPLATE =
	"{date} - {issuer} - {category} - {title}";

export const EXPORT_LAYOUTS = [
	"flat",
	"by-year",
	"by-party",
	"by-category",
] as const;
export const exportLayoutSchema = z.enum(EXPORT_LAYOUTS);
export type ExportLayout = z.infer<typeof exportLayoutSchema>;

/** Hard cap on a single export, to keep one request bounded. */
export const EXPORT_MAX_DOCUMENTS = 2000;

/**
 * Pagination is meaningless here: the export takes the whole selection.
 *
 * `strict`: an unknown key is a typo (`categoryID`, `tag`), and silently
 * ignoring it hands back an archive built on filters the caller never asked
 * for — the most expensive kind of silent success.
 */
export const exportFiltersSchema = listDocumentsInput
	.omit({ page: true, pageSize: true })
	.strict();
export type ExportFilters = z.infer<typeof exportFiltersSchema>;

export const exportDocumentsInput = z.object({
	filters: exportFiltersSchema.default(() => exportFiltersSchema.parse({})),
	/** Title template (`@docstore/rules` `renderTitleTemplate`). */
	template: z.string().trim().min(1).max(300).default(DEFAULT_EXPORT_TEMPLATE),
	layout: exportLayoutSchema.default("flat"),
	/** Adds `metadata.json` and `manifest.csv` at the root of the archive. */
	includeMetadata: z.boolean().default(true),
	/** Sensitive documents stay out unless this is explicitly turned on. */
	includeSensitive: z.boolean().default(false),
});
export type ExportDocumentsInput = z.infer<typeof exportDocumentsInput>;

export const exportPreviewSchema = z.object({
	count: z.int().min(0),
	/** Total size of the original files, before compression. */
	bytes: z.int().min(0),
	/** First rendered paths, to show what the archive will look like. */
	sample: z.array(z.string()),
	/** True when the selection was cut off at `EXPORT_MAX_DOCUMENTS`. */
	truncated: z.boolean(),
});
export type ExportPreview = z.infer<typeof exportPreviewSchema>;
