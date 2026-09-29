import { z } from "zod";

/**
 * External references (issue #4): the notes of another system that cite a
 * document, such as the pages of the life wiki. Docstore does not read those
 * notes; the system that owns them declares its references here, so that a
 * document can say who uses it and the other system can list what it never
 * cites.
 *
 * This module does not depend on any other schema: `document.ts` imports it
 * to describe the references returned by `document.get`.
 */

/**
 * Name of the external system, a lowercase slug (`wiki`, `notes`…). It is the
 * key of the filters `referencedBy` / `notReferencedBy`, so it stays strict:
 * `Wiki` and `wiki ` would otherwise be two systems.
 */
export const externalRefSystemSchema = z
	.string()
	.trim()
	.min(1)
	.max(50)
	.regex(
		/^[a-z0-9][a-z0-9_-]*$/,
		"A system is a lowercase slug: letters, digits, `-` and `_`.",
	);
export type ExternalRefSystem = z.infer<typeof externalRefSystemSchema>;

/**
 * Only web links: the URL is rendered as a link in the web app, and a
 * `javascript:` or `data:` URL there would run in the page.
 */
const externalRefUrlSchema = z.url({
	protocol: /^https?$/,
	error: "The URL must be an http(s) link.",
});

/** Longest reference (a note path, an id…), in characters. */
export const EXTERNAL_REF_MAX_LENGTH = 500;

/** One reference, as an external system declares it. */
export const externalRefItemSchema = z.object({
	/**
	 * Identifier of the note in its system, unique per document and system:
	 * the path of a wiki page (`10-admin/12-logement/contrat-edf.md`).
	 */
	ref: z.string().trim().min(1).max(EXTERNAL_REF_MAX_LENGTH),
	/** Where a human opens the note; the web app links to it when present. */
	url: externalRefUrlSchema.max(2000).nullish(),
	/** Human title of the note (`Contrat EDF`); `ref` is shown without it. */
	label: z.string().trim().min(1).max(200).nullish(),
});
export type ExternalRefItem = z.infer<typeof externalRefItemSchema>;

/**
 * Most references one system can declare on a document in one call. A wiki
 * page per document is the usual case; the bound only stops a runaway agent.
 */
export const EXTERNAL_REFS_MAX_PER_SYSTEM = 200;

/**
 * Replaces the references of one system on a document; the other systems
 * are left alone, and an empty list clears that system.
 */
export const setExternalRefsInput = z.object({
	id: z.string().min(1),
	system: externalRefSystemSchema,
	refs: z
		.array(externalRefItemSchema)
		.max(EXTERNAL_REFS_MAX_PER_SYSTEM)
		.refine(
			(refs) => new Set(refs.map((item) => item.ref)).size === refs.length,
			"Each ref may appear only once.",
		),
});
export type SetExternalRefsInput = z.infer<typeof setExternalRefsInput>;

/** A reference carried by a document, as `document.get` returns it. */
export const documentExternalRefSchema = z.object({
	system: z.string(),
	ref: z.string(),
	url: z.string().nullable(),
	label: z.string().nullable(),
	createdAt: z.date(),
	updatedAt: z.date(),
});
export type DocumentExternalRef = z.infer<typeof documentExternalRefSchema>;
