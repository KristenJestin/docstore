import type { PDFFont, PDFPage } from "pdf-lib";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

/**
 * PDF layouts of the demo dataset (`bun run db:demo`).
 *
 * Everything is drawn with `pdf-lib`, so the repository ships no binary
 * fixture: the generator produces real A4 pages with a real text layer, which
 * `pdftotext` reads exactly as it would read a bill downloaded from a customer
 * area. The wording stays **French** on purpose — it is the document content,
 * not interface text, and it is what makes the French date/period/identifier
 * detection of the pipeline fire for real.
 */

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 56;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const INK = rgb(0.07, 0.08, 0.11);
const MUTED = rgb(0.42, 0.44, 0.5);
const RULE = rgb(0.78, 0.79, 0.83);
const BAND = rgb(0.94, 0.95, 0.97);

/**
 * Characters the standard fonts cannot encode are folded to a close
 * equivalent: pdf-lib throws on the first one it meets, and a demo document is
 * not worth a crash three hundred pages in.
 */
const CHARACTER_FOLDS: [RegExp, string][] = [
	[/[\u2018\u2019\u2032]/g, "'"],
	[/[\u201c\u201d]/g, '"'],
	[/[\u2013\u2014\u2212]/g, "-"],
	[/\u2026/g, "..."],
	// Non-breaking and narrow non-breaking spaces, as copied out of a French bill.
	[/[\u00a0\u202f\u2009]/g, " "],
];

/** WinAnsi-safe text: folded punctuation, everything else outside Latin-1 dropped. */
function safe(value: string): string {
	let folded = value;
	for (const [pattern, replacement] of CHARACTER_FOLDS) {
		folded = folded.replace(pattern, replacement);
	}
	// Latin-1 plus the euro sign, which WinAnsi maps at 0x80.
	return folded.replace(/[^ -~ -ÿ€]/g, "");
}

/** A4 sheet being written top-down, with the two standard font weights. */
interface Sheet {
	page: PDFPage;
	regular: PDFFont;
	bold: PDFFont;
	mono: PDFFont;
	/** Distance from the top of the page of the next baseline. */
	cursor: number;
}

interface TextOptions {
	x?: number;
	size?: number;
	bold?: boolean;
	mono?: boolean;
	color?: ReturnType<typeof rgb>;
	/** Right edge the text is aligned on, instead of a left `x`. */
	right?: number;
}

function fontOf(sheet: Sheet, options: TextOptions): PDFFont {
	if (options.mono) return sheet.mono;
	return options.bold ? sheet.bold : sheet.regular;
}

/** Draws one line at `top` (distance from the top edge), without moving the cursor. */
function draw(
	sheet: Sheet,
	top: number,
	value: string,
	options: TextOptions = {},
) {
	const size = options.size ?? 10;
	const font = fontOf(sheet, options);
	const text = safe(value);
	const x =
		options.right !== undefined
			? options.right - font.widthOfTextAtSize(text, size)
			: (options.x ?? MARGIN);
	sheet.page.drawText(text, {
		x,
		y: PAGE_HEIGHT - top,
		size,
		font,
		color: options.color ?? INK,
	});
}

/** Draws one line at the cursor and advances it by `lead`. */
function line(
	sheet: Sheet,
	value: string,
	options: TextOptions & { lead?: number } = {},
) {
	draw(sheet, sheet.cursor, value, options);
	sheet.cursor += options.lead ?? (options.size ?? 10) + 4;
}

function block(
	sheet: Sheet,
	values: string[],
	options: TextOptions & { lead?: number } = {},
) {
	for (const value of values) line(sheet, value, options);
}

function rule(
	sheet: Sheet,
	options: { top?: number; color?: ReturnType<typeof rgb> } = {},
) {
	const top = options.top ?? sheet.cursor;
	sheet.page.drawLine({
		start: { x: MARGIN, y: PAGE_HEIGHT - top },
		end: { x: PAGE_WIDTH - MARGIN, y: PAGE_HEIGHT - top },
		thickness: 0.7,
		color: options.color ?? RULE,
	});
}

function band(sheet: Sheet, top: number, height: number) {
	sheet.page.drawRectangle({
		x: MARGIN,
		y: PAGE_HEIGHT - top - height,
		width: CONTENT_WIDTH,
		height,
		color: BAND,
	});
}

async function newSheet(): Promise<{ pdf: PDFDocument; sheet: Sheet }> {
	const pdf = await PDFDocument.create();
	const sheet: Sheet = {
		page: pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]),
		regular: await pdf.embedFont(StandardFonts.Helvetica),
		bold: await pdf.embedFont(StandardFonts.HelveticaBold),
		mono: await pdf.embedFont(StandardFonts.Courier),
		cursor: MARGIN,
	};
	return { pdf, sheet };
}

async function finish(pdf: PDFDocument, title: string): Promise<Uint8Array> {
	pdf.setTitle(safe(title));
	pdf.setProducer("docstore demo generator");
	return await pdf.save();
}

/* ------------------------------------------------------------------ */
/* Shared blocks                                                        */
/* ------------------------------------------------------------------ */

/** Organisation issuing the document, with the identifiers the pipeline matches on. */
export interface IssuerBlock {
	name: string;
	address: string[];
	siret?: string;
	vat?: string;
	site?: string;
	email?: string;
}

/** Household side of the document. */
export interface RecipientBlock {
	name: string;
	address: string[];
	customerRef?: string;
}

/** French amount: `1 234,56 EUR`, non-breaking spaces avoided on purpose. */
export function euros(amount: number): string {
	const [whole, cents] = amount.toFixed(2).split(".");
	const grouped = (whole ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, " ");
	return `${grouped},${cents} €`;
}

/** `2026-03-27` -> `27/03/2026`, the form the French date detection reads. */
export function frenchDate(iso: string): string {
	const [year, month, day] = iso.split("-");
	return `${day}/${month}/${year}`;
}

/** Letterhead: issuer on the left, document kind and reference on the right. */
function letterhead(
	sheet: Sheet,
	issuer: IssuerBlock,
	kind: string,
	reference: string,
) {
	const top = sheet.cursor;
	sheet.page.drawRectangle({
		x: MARGIN,
		y: PAGE_HEIGHT - top - 26,
		width: 26,
		height: 26,
		color: INK,
	});
	draw(sheet, top + 18, issuer.name.slice(0, 2).toUpperCase(), {
		x: MARGIN + 6,
		size: 12,
		bold: true,
		color: rgb(1, 1, 1),
	});
	draw(sheet, top + 12, issuer.name, { x: MARGIN + 36, size: 15, bold: true });
	draw(sheet, top + 25, issuer.address.join(" - "), {
		x: MARGIN + 36,
		size: 8,
		color: MUTED,
	});

	draw(sheet, top + 12, kind, {
		right: PAGE_WIDTH - MARGIN,
		size: 15,
		bold: true,
	});
	draw(sheet, top + 25, reference, {
		right: PAGE_WIDTH - MARGIN,
		size: 8,
		mono: true,
		color: MUTED,
	});

	sheet.cursor = top + 40;
	rule(sheet);
	sheet.cursor += 20;
}

/** Legal identifiers, printed where a real French document prints them. */
function legalDetails(issuer: IssuerBlock): string[] {
	const lines: string[] = [];
	if (issuer.siret) lines.push(`SIRET ${issuer.siret}`);
	if (issuer.vat) lines.push(`TVA intracommunautaire ${issuer.vat}`);
	if (issuer.site) lines.push(issuer.site);
	if (issuer.email) lines.push(issuer.email);
	return lines;
}

/** Two facing columns: issuer identifiers on the left, recipient on the right. */
function facingBlocks(
	sheet: Sheet,
	issuer: IssuerBlock,
	recipient: RecipientBlock,
	labels: [string, string] = ["ÉMETTEUR", "DESTINATAIRE"],
) {
	const top = sheet.cursor;
	const rightX = MARGIN + CONTENT_WIDTH / 2 + 20;

	draw(sheet, top, labels[0], { size: 7, bold: true, color: MUTED });
	let y = top + 14;
	for (const value of [
		issuer.name,
		...issuer.address,
		...legalDetails(issuer),
	]) {
		draw(sheet, y, value, { size: 9 });
		y += 12;
	}

	draw(sheet, top, labels[1], { x: rightX, size: 7, bold: true, color: MUTED });
	let z = top + 14;
	for (const value of [recipient.name, ...recipient.address]) {
		draw(sheet, z, value, { x: rightX, size: 9 });
		z += 12;
	}
	if (recipient.customerRef) {
		draw(sheet, z, `Référence client : ${recipient.customerRef}`, {
			x: rightX,
			size: 9,
			mono: true,
			color: MUTED,
		});
		z += 12;
	}

	sheet.cursor = Math.max(y, z) + 14;
}

/** Footer glued to the bottom of the page, where the small print lives. */
function footnote(sheet: Sheet, values: string[]) {
	let top = PAGE_HEIGHT - MARGIN - values.length * 11;
	rule(sheet, { top: top - 12 });
	for (const value of values) {
		draw(sheet, top, value, { size: 7.5, color: MUTED });
		top += 11;
	}
}

/* ------------------------------------------------------------------ */
/* Invoice                                                             */
/* ------------------------------------------------------------------ */

export interface InvoiceLine {
	label: string;
	detail?: string;
	amount: number;
}

export interface InvoiceInput {
	kind?: string;
	issuer: IssuerBlock;
	recipient: RecipientBlock;
	number: string;
	/** ISO date the document was issued; printed behind an explicit label. */
	issueDate: string;
	issueLabel?: string;
	dueDate?: string;
	/** ISO bounds of the consumption period, printed as "Periode du ... au ...". */
	periodStart?: string;
	periodEnd?: string;
	lines: InvoiceLine[];
	vatRate?: number;
	/** Already-paid invoice: printed instead of the payment instructions. */
	paid?: boolean;
	notes?: string[];
	footer?: string[];
}

export async function buildInvoice(input: InvoiceInput): Promise<Uint8Array> {
	const { pdf, sheet } = await newSheet();
	const kind = input.kind ?? "FACTURE";
	letterhead(sheet, input.issuer, kind, `N° ${input.number}`);
	facingBlocks(sheet, input.issuer, input.recipient);

	const meta: string[] = [
		`${input.issueLabel ?? "Facture émise le"} ${frenchDate(input.issueDate)}`,
	];
	if (input.periodStart && input.periodEnd) {
		meta.push(
			`Période du ${frenchDate(input.periodStart)} au ${frenchDate(input.periodEnd)}`,
		);
	}
	if (input.dueDate) {
		meta.push(`Date d'échéance : ${frenchDate(input.dueDate)}`);
	}
	band(sheet, sheet.cursor - 10, 14 * meta.length + 10);
	block(sheet, meta, { size: 9.5, lead: 14 });
	sheet.cursor += 18;

	// Table header.
	draw(sheet, sheet.cursor, "DÉSIGNATION", {
		size: 7.5,
		bold: true,
		color: MUTED,
	});
	draw(sheet, sheet.cursor, "MONTANT HT", {
		right: PAGE_WIDTH - MARGIN,
		size: 7.5,
		bold: true,
		color: MUTED,
	});
	sheet.cursor += 10;
	rule(sheet);
	sheet.cursor += 14;

	const vatRate = input.vatRate ?? 20;
	let totalHt = 0;
	for (const item of input.lines) {
		totalHt += item.amount;
		draw(sheet, sheet.cursor, item.label, { size: 10 });
		draw(sheet, sheet.cursor, euros(item.amount), {
			right: PAGE_WIDTH - MARGIN,
			size: 10,
			mono: true,
		});
		sheet.cursor += 13;
		if (item.detail) {
			draw(sheet, sheet.cursor, item.detail, { size: 8, color: MUTED });
			sheet.cursor += 12;
		}
		sheet.cursor += 3;
	}

	sheet.cursor += 4;
	rule(sheet);
	sheet.cursor += 16;

	const vat = Math.round(totalHt * vatRate) / 100;
	const totalTtc = Math.round((totalHt + vat) * 100) / 100;
	const totals: [string, string][] = [
		["Total HT", euros(totalHt)],
		[`TVA ${vatRate},0 %`, euros(vat)],
	];
	for (const [label, value] of totals) {
		draw(sheet, sheet.cursor, label, {
			x: PAGE_WIDTH - MARGIN - 200,
			size: 9.5,
		});
		draw(sheet, sheet.cursor, value, {
			right: PAGE_WIDTH - MARGIN,
			size: 9.5,
			mono: true,
		});
		sheet.cursor += 14;
	}
	band(sheet, sheet.cursor - 4, 22);
	draw(sheet, sheet.cursor + 11, "TOTAL TTC", {
		x: PAGE_WIDTH - MARGIN - 200,
		size: 11,
		bold: true,
	});
	draw(sheet, sheet.cursor + 11, euros(totalTtc), {
		right: PAGE_WIDTH - MARGIN,
		size: 11,
		bold: true,
		mono: true,
	});
	sheet.cursor += 40;

	if (input.paid) {
		line(sheet, "Facture réglée - aucun paiement n'est attendu.", {
			size: 9.5,
			bold: true,
		});
	} else if (input.dueDate) {
		line(
			sheet,
			`Montant à payer : ${euros(totalTtc)} avant le ${frenchDate(input.dueDate)}.`,
			{
				size: 9.5,
			},
		);
	}
	if (input.notes) {
		sheet.cursor += 6;
		block(sheet, input.notes, { size: 9, color: MUTED, lead: 13 });
	}

	footnote(sheet, [
		...(input.footer ?? []),
		`${input.issuer.name} - ${legalDetails(input.issuer).join(" - ")}`,
	]);

	return finish(pdf, `${kind} ${input.number}`);
}

/* ------------------------------------------------------------------ */
/* Payslip                                                             */
/* ------------------------------------------------------------------ */

export interface PayslipLine {
	label: string;
	base?: string;
	rate?: string;
	amount: number;
}

export interface PayslipInput {
	employer: IssuerBlock;
	employee: { name: string; address: string[]; job: string; ssn: string };
	/** ISO bounds of the covered month. */
	periodStart: string;
	periodEnd: string;
	/** ISO payment date: the date the document itself belongs to. */
	paidOn: string;
	lines: PayslipLine[];
	gross: number;
	net: number;
	taxableNet: number;
	incomeTax: number;
	/** Payroll software the layout imitates ("Silae", "PayFit"). */
	software: string;
	reference: string;
}

export async function buildPayslip(input: PayslipInput): Promise<Uint8Array> {
	const { pdf, sheet } = await newSheet();
	letterhead(sheet, input.employer, "BULLETIN DE PAIE", input.reference);
	facingBlocks(
		sheet,
		input.employer,
		{ name: input.employee.name, address: input.employee.address },
		["EMPLOYEUR", "SALARIÉ"],
	);

	band(sheet, sheet.cursor - 10, 52);
	block(
		sheet,
		[
			`Période du ${frenchDate(input.periodStart)} au ${frenchDate(input.periodEnd)}`,
			`Payé le ${frenchDate(input.paidOn)}`,
			`Emploi : ${input.employee.job} - N° de sécurité sociale : ${input.employee.ssn}`,
		],
		{ size: 9.5, lead: 14 },
	);
	sheet.cursor += 20;

	draw(sheet, sheet.cursor, "LIBELLÉ", { size: 7.5, bold: true, color: MUTED });
	draw(sheet, sheet.cursor, "BASE", {
		x: MARGIN + 250,
		size: 7.5,
		bold: true,
		color: MUTED,
	});
	draw(sheet, sheet.cursor, "TAUX", {
		x: MARGIN + 330,
		size: 7.5,
		bold: true,
		color: MUTED,
	});
	draw(sheet, sheet.cursor, "MONTANT", {
		right: PAGE_WIDTH - MARGIN,
		size: 7.5,
		bold: true,
		color: MUTED,
	});
	sheet.cursor += 10;
	rule(sheet);
	sheet.cursor += 13;

	for (const item of input.lines) {
		draw(sheet, sheet.cursor, item.label, { size: 9.5 });
		if (item.base) {
			draw(sheet, sheet.cursor, item.base, {
				x: MARGIN + 250,
				size: 9,
				mono: true,
			});
		}
		if (item.rate) {
			draw(sheet, sheet.cursor, item.rate, {
				x: MARGIN + 330,
				size: 9,
				mono: true,
			});
		}
		draw(sheet, sheet.cursor, euros(item.amount), {
			right: PAGE_WIDTH - MARGIN,
			size: 9.5,
			mono: true,
		});
		sheet.cursor += 15;
	}

	sheet.cursor += 4;
	rule(sheet);
	sheet.cursor += 16;

	for (const [label, value] of [
		["Salaire brut", euros(input.gross)],
		["Net imposable", euros(input.taxableNet)],
		["Impôt sur le revenu prélevé à la source", euros(-input.incomeTax)],
	] as [string, string][]) {
		draw(sheet, sheet.cursor, label, {
			x: PAGE_WIDTH - MARGIN - 260,
			size: 9.5,
		});
		draw(sheet, sheet.cursor, value, {
			right: PAGE_WIDTH - MARGIN,
			size: 9.5,
			mono: true,
		});
		sheet.cursor += 14;
	}

	band(sheet, sheet.cursor - 4, 24);
	draw(sheet, sheet.cursor + 12, "NET À PAYER", {
		x: PAGE_WIDTH - MARGIN - 260,
		size: 12,
		bold: true,
	});
	draw(sheet, sheet.cursor + 12, euros(input.net), {
		right: PAGE_WIDTH - MARGIN,
		size: 12,
		bold: true,
		mono: true,
	});
	sheet.cursor += 44;

	line(
		sheet,
		"Dans votre intérêt et pour vous aider à faire valoir vos droits, conservez ce bulletin sans limitation de durée.",
		{ size: 8.5, color: MUTED },
	);

	footnote(sheet, [
		`Bulletin édité avec ${input.software} - conforme au modèle de bulletin de paie simplifié.`,
		`${input.employer.name} - ${legalDetails(input.employer).join(" - ")}`,
	]);

	return finish(pdf, `Bulletin de paie ${input.reference}`);
}

/* ------------------------------------------------------------------ */
/* Contract                                                            */
/* ------------------------------------------------------------------ */

export interface ContractInput {
	title: string;
	issuer: IssuerBlock;
	recipient: RecipientBlock;
	reference: string;
	/** ISO signature date. */
	signedOn: string;
	place: string;
	intro: string[];
	clauses: { heading: string; body: string[] }[];
	signatories: [string, string];
}

export async function buildContract(input: ContractInput): Promise<Uint8Array> {
	const { pdf, sheet } = await newSheet();
	letterhead(sheet, input.issuer, "CONTRAT", input.reference);

	line(sheet, input.title.toUpperCase(), { size: 13, bold: true, lead: 22 });
	facingBlocks(sheet, input.issuer, input.recipient, ["PARTIE 1", "PARTIE 2"]);
	block(sheet, input.intro, { size: 9.5, lead: 13 });
	sheet.cursor += 10;

	for (const clause of input.clauses) {
		line(sheet, clause.heading, { size: 10, bold: true, lead: 15 });
		block(sheet, clause.body, { size: 9.5, lead: 13 });
		sheet.cursor += 8;
	}

	sheet.cursor += 6;
	line(
		sheet,
		`Fait le ${frenchDate(input.signedOn)}, à ${input.place}, en deux exemplaires.`,
		{
			size: 9.5,
			lead: 26,
		},
	);
	draw(sheet, sheet.cursor, input.signatories[0], { size: 9, bold: true });
	draw(sheet, sheet.cursor, input.signatories[1], {
		right: PAGE_WIDTH - MARGIN,
		size: 9,
		bold: true,
	});

	footnote(sheet, [
		`${input.issuer.name} - ${legalDetails(input.issuer).join(" - ")}`,
	]);
	return finish(pdf, input.title);
}

/* ------------------------------------------------------------------ */
/* Attestation                                                         */
/* ------------------------------------------------------------------ */

export interface AttestationInput {
	title: string;
	issuer: IssuerBlock;
	recipient: RecipientBlock;
	reference: string;
	/** ISO issue date, printed behind "Fait le". */
	issuedOn: string;
	place: string;
	body: string[];
	/** ISO expiry, printed as "valable jusqu'au ...". */
	validUntil?: string;
	signature?: string;
}

export async function buildAttestation(
	input: AttestationInput,
): Promise<Uint8Array> {
	const { pdf, sheet } = await newSheet();
	letterhead(sheet, input.issuer, "ATTESTATION", input.reference);

	line(sheet, input.title.toUpperCase(), { size: 13, bold: true, lead: 24 });
	facingBlocks(sheet, input.issuer, input.recipient);
	block(sheet, input.body, { size: 10, lead: 14 });
	sheet.cursor += 12;

	if (input.validUntil) {
		band(sheet, sheet.cursor - 10, 26);
		line(
			sheet,
			`La présente attestation est valable jusqu'au ${frenchDate(input.validUntil)}.`,
			{
				size: 10.5,
				bold: true,
				lead: 30,
			},
		);
	}

	sheet.cursor += 10;
	line(sheet, `Fait le ${frenchDate(input.issuedOn)}, à ${input.place}.`, {
		size: 9.5,
		lead: 30,
	});
	if (input.signature) {
		line(sheet, input.signature, { size: 9, bold: true, lead: 14 });
	}

	footnote(sheet, [
		"Document généré automatiquement, il ne nécessite pas de signature manuscrite.",
		`${input.issuer.name} - ${legalDetails(input.issuer).join(" - ")}`,
	]);
	return finish(pdf, input.title);
}

/* ------------------------------------------------------------------ */
/* Statement (yearly recap, health refunds, bank statement)             */
/* ------------------------------------------------------------------ */

export interface StatementRow {
	date: string;
	label: string;
	amount: number;
}

export interface StatementInput {
	title: string;
	kind?: string;
	issuer: IssuerBlock;
	recipient: RecipientBlock;
	reference: string;
	issuedOn: string;
	issueLabel?: string;
	periodStart?: string;
	periodEnd?: string;
	columns: [string, string];
	rows: StatementRow[];
	totalLabel: string;
	footer?: string[];
}

export async function buildStatement(
	input: StatementInput,
): Promise<Uint8Array> {
	const { pdf, sheet } = await newSheet();
	letterhead(sheet, input.issuer, input.kind ?? "RELEVÉ", input.reference);

	line(sheet, input.title.toUpperCase(), { size: 13, bold: true, lead: 22 });
	facingBlocks(sheet, input.issuer, input.recipient);

	const meta = [
		`${input.issueLabel ?? "Établi le"} ${frenchDate(input.issuedOn)}`,
	];
	if (input.periodStart && input.periodEnd) {
		meta.push(
			`Période du ${frenchDate(input.periodStart)} au ${frenchDate(input.periodEnd)}`,
		);
	}
	band(sheet, sheet.cursor - 10, 14 * meta.length + 10);
	block(sheet, meta, { size: 9.5, lead: 14 });
	sheet.cursor += 18;

	draw(sheet, sheet.cursor, "DATE", { size: 7.5, bold: true, color: MUTED });
	draw(sheet, sheet.cursor, input.columns[0], {
		x: MARGIN + 90,
		size: 7.5,
		bold: true,
		color: MUTED,
	});
	draw(sheet, sheet.cursor, input.columns[1], {
		right: PAGE_WIDTH - MARGIN,
		size: 7.5,
		bold: true,
		color: MUTED,
	});
	sheet.cursor += 10;
	rule(sheet);
	sheet.cursor += 13;

	let total = 0;
	for (const row of input.rows) {
		total += row.amount;
		draw(sheet, sheet.cursor, frenchDate(row.date), { size: 9, mono: true });
		draw(sheet, sheet.cursor, row.label, { x: MARGIN + 90, size: 9.5 });
		draw(sheet, sheet.cursor, euros(row.amount), {
			right: PAGE_WIDTH - MARGIN,
			size: 9.5,
			mono: true,
		});
		sheet.cursor += 15;
	}

	sheet.cursor += 4;
	rule(sheet);
	sheet.cursor += 16;
	band(sheet, sheet.cursor - 6, 24);
	draw(sheet, sheet.cursor + 10, input.totalLabel, {
		x: PAGE_WIDTH - MARGIN - 260,
		size: 11,
		bold: true,
	});
	draw(sheet, sheet.cursor + 10, euros(Math.round(total * 100) / 100), {
		right: PAGE_WIDTH - MARGIN,
		size: 11,
		bold: true,
		mono: true,
	});

	footnote(sheet, [
		...(input.footer ?? []),
		`${input.issuer.name} - ${legalDetails(input.issuer).join(" - ")}`,
	]);
	return finish(pdf, input.title);
}

/* ------------------------------------------------------------------ */
/* Bank details (RIB)                                                   */
/* ------------------------------------------------------------------ */

export interface RibInput {
	bank: IssuerBlock;
	holder: RecipientBlock;
	agency: string;
	bankCode: string;
	branchCode: string;
	accountNumber: string;
	ribKey: string;
	iban: string;
	bic: string;
	issuedOn: string;
}

export async function buildRib(input: RibInput): Promise<Uint8Array> {
	const { pdf, sheet } = await newSheet();
	letterhead(sheet, input.bank, "RIB", `Agence ${input.agency}`);

	line(sheet, "RELEVÉ D'IDENTITÉ BANCAIRE", { size: 14, bold: true, lead: 24 });
	line(
		sheet,
		"À remettre à tout organisme demandant vos coordonnées bancaires pour la domiciliation de vos virements ou de vos prélèvements.",
		{ size: 9, color: MUTED, lead: 24 },
	);

	facingBlocks(sheet, input.bank, input.holder, [
		"BANQUE",
		"TITULAIRE DU COMPTE",
	]);

	band(sheet, sheet.cursor - 8, 92);
	sheet.cursor += 4;
	draw(sheet, sheet.cursor, "Code banque", {
		size: 7.5,
		bold: true,
		color: MUTED,
	});
	draw(sheet, sheet.cursor, "Code guichet", {
		x: MARGIN + 120,
		size: 7.5,
		bold: true,
		color: MUTED,
	});
	draw(sheet, sheet.cursor, "Numéro de compte", {
		x: MARGIN + 240,
		size: 7.5,
		bold: true,
		color: MUTED,
	});
	draw(sheet, sheet.cursor, "Clé RIB", {
		right: PAGE_WIDTH - MARGIN,
		size: 7.5,
		bold: true,
		color: MUTED,
	});
	sheet.cursor += 16;
	draw(sheet, sheet.cursor, input.bankCode, { size: 11, mono: true });
	draw(sheet, sheet.cursor, input.branchCode, {
		x: MARGIN + 120,
		size: 11,
		mono: true,
	});
	draw(sheet, sheet.cursor, input.accountNumber, {
		x: MARGIN + 240,
		size: 11,
		mono: true,
	});
	draw(sheet, sheet.cursor, input.ribKey, {
		right: PAGE_WIDTH - MARGIN,
		size: 11,
		mono: true,
	});
	sheet.cursor += 26;
	draw(sheet, sheet.cursor, "IBAN", { size: 7.5, bold: true, color: MUTED });
	draw(sheet, sheet.cursor, "BIC", {
		x: MARGIN + 320,
		size: 7.5,
		bold: true,
		color: MUTED,
	});
	sheet.cursor += 16;
	draw(sheet, sheet.cursor, input.iban, { size: 11, mono: true, bold: true });
	draw(sheet, sheet.cursor, input.bic, {
		x: MARGIN + 320,
		size: 11,
		mono: true,
		bold: true,
	});
	sheet.cursor += 40;

	line(sheet, `Établi le ${frenchDate(input.issuedOn)}.`, {
		size: 9.5,
		lead: 20,
	});
	line(sheet, "Ce document ne constitue pas un justificatif de domicile.", {
		size: 9,
		color: MUTED,
	});

	footnote(sheet, [
		`${input.bank.name} - ${legalDetails(input.bank).join(" - ")}`,
	]);
	return finish(pdf, "Releve d'identite bancaire");
}

/* ------------------------------------------------------------------ */
/* Identity card (rasterised afterwards to look scanned)                */
/* ------------------------------------------------------------------ */

export interface IdentityCardInput {
	surname: string;
	givenNames: string;
	birthDate: string;
	birthPlace: string;
	sex: string;
	height: string;
	number: string;
	issuedOn: string;
	validUntil: string;
	authority: string;
}

/**
 * Identity card laid out on a slightly rotated A4, the way a card scanned flat
 * on a home scanner comes out. Rasterised by the caller, so the pipeline sees
 * an image with no text layer and really runs Tesseract on it.
 */
export async function buildIdentityCard(
	input: IdentityCardInput,
): Promise<Uint8Array> {
	const { pdf, sheet } = await newSheet();
	const cardX = 70;
	const cardTop = 150;
	const cardWidth = 440;
	const cardHeight = 278;

	sheet.page.drawRectangle({
		x: 0,
		y: 0,
		width: PAGE_WIDTH,
		height: PAGE_HEIGHT,
		color: rgb(0.9, 0.9, 0.9),
	});
	sheet.page.drawRectangle({
		x: cardX,
		y: PAGE_HEIGHT - cardTop - cardHeight,
		width: cardWidth,
		height: cardHeight,
		color: rgb(0.99, 0.99, 0.97),
		borderColor: rgb(0.55, 0.56, 0.6),
		borderWidth: 1.2,
	});
	sheet.page.drawRectangle({
		x: cardX,
		y: PAGE_HEIGHT - cardTop - 42,
		width: cardWidth,
		height: 42,
		color: rgb(0.86, 0.87, 0.9),
	});
	// Photograph placeholder: a flat grey rectangle is what a grayscale scan of
	// one looks like anyway.
	sheet.page.drawRectangle({
		x: cardX + 20,
		y: PAGE_HEIGHT - cardTop - 210,
		width: 108,
		height: 140,
		color: rgb(0.72, 0.73, 0.76),
	});

	draw(sheet, cardTop + 18, "RÉPUBLIQUE FRANÇAISE", {
		x: cardX + 16,
		size: 11,
		bold: true,
	});
	draw(sheet, cardTop + 33, "CARTE NATIONALE D'IDENTITÉ", {
		x: cardX + 16,
		size: 10,
		bold: true,
	});
	draw(sheet, cardTop + 33, `N° ${input.number}`, {
		right: cardX + cardWidth - 16,
		size: 9,
		mono: true,
	});

	const fields: [string, string][] = [
		["NOM", input.surname],
		["PRÉNOM(S)", input.givenNames],
		["NÉ(E) LE", frenchDate(input.birthDate)],
		["A", input.birthPlace],
		["SEXE", input.sex],
		["TAILLE", input.height],
	];
	let top = cardTop + 78;
	for (const [label, value] of fields) {
		draw(sheet, top, label, { x: cardX + 148, size: 6.5, color: MUTED });
		draw(sheet, top + 12, value, { x: cardX + 148, size: 11, bold: true });
		top += 30;
	}

	draw(sheet, cardTop + 232, "DÉLIVRÉE LE", {
		x: cardX + 20,
		size: 6.5,
		color: MUTED,
	});
	draw(sheet, cardTop + 244, frenchDate(input.issuedOn), {
		x: cardX + 20,
		size: 10,
		mono: true,
	});
	draw(sheet, cardTop + 232, "EXPIRE LE", {
		x: cardX + 150,
		size: 6.5,
		color: MUTED,
	});
	draw(sheet, cardTop + 244, frenchDate(input.validUntil), {
		x: cardX + 150,
		size: 10,
		bold: true,
		mono: true,
	});
	draw(sheet, cardTop + 232, "AUTORITÉ", {
		x: cardX + 280,
		size: 6.5,
		color: MUTED,
	});
	draw(sheet, cardTop + 244, input.authority, { x: cardX + 280, size: 9 });

	// Machine-readable zone, the two lines every scanner picks up.
	const mrzSurname = input.surname.toUpperCase().replace(/[^A-Z]/g, "");
	const mrzGiven = input.givenNames.toUpperCase().replace(/[^A-Z]/g, "");
	draw(
		sheet,
		cardTop + 268,
		`IDFRA${mrzSurname.padEnd(14, "<").slice(0, 14)}<<${mrzGiven.slice(0, 10)}`,
		{ x: cardX + 20, size: 9, mono: true },
	);

	draw(
		sheet,
		cardTop + cardHeight + 40,
		"Recto de la carte nationale d'identité -",
		{
			x: cardX,
			size: 9,
			color: MUTED,
		},
	);
	draw(
		sheet,
		cardTop + cardHeight + 54,
		`Titre valable jusqu'au ${frenchDate(input.validUntil)}.`,
		{ x: cardX, size: 9, color: MUTED },
	);

	return finish(pdf, "Carte nationale d'identite");
}

/* ------------------------------------------------------------------ */
/* Plain letter                                                        */
/* ------------------------------------------------------------------ */

export interface LetterInput {
	sender: { name: string; address: string[] };
	recipient: RecipientBlock;
	place: string;
	/** ISO date, printed the French way ("Lyon, le 12 mars 2026"). */
	date: string;
	subject: string;
	body: string[];
	signature: string;
}

const MONTH_NAMES = [
	"janvier",
	"février",
	"mars",
	"avril",
	"mai",
	"juin",
	"juillet",
	"août",
	"septembre",
	"octobre",
	"novembre",
	"décembre",
];

/** `2026-03-12` -> `12 mars 2026`. */
export function longFrenchDate(iso: string): string {
	const [year, month, day] = iso.split("-").map(Number);
	return `${day} ${MONTH_NAMES[(month ?? 1) - 1]} ${year}`;
}

/**
 * Anonymous letter: no identifier, no recognisable issuer. Exists so the demo
 * has a document the pipeline honestly cannot classify, which is what the
 * review queue is for.
 */
export async function buildLetter(input: LetterInput): Promise<Uint8Array> {
	const { pdf, sheet } = await newSheet();
	sheet.cursor = 90;
	block(sheet, [input.sender.name, ...input.sender.address], {
		size: 10,
		lead: 13,
	});
	sheet.cursor += 30;

	const right = PAGE_WIDTH - MARGIN;
	for (const value of [input.recipient.name, ...input.recipient.address]) {
		draw(sheet, sheet.cursor, value, { right, size: 10 });
		sheet.cursor += 13;
	}
	sheet.cursor += 30;
	draw(
		sheet,
		sheet.cursor,
		`${input.place}, le ${longFrenchDate(input.date)}`,
		{
			right,
			size: 10,
		},
	);
	sheet.cursor += 40;

	line(sheet, `Objet : ${input.subject}`, { size: 10, bold: true, lead: 30 });
	block(sheet, input.body, { size: 10, lead: 15 });
	sheet.cursor += 30;
	line(sheet, input.signature, { size: 10, lead: 14 });

	return finish(pdf, input.subject);
}
