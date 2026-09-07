/**
 * Generates the test fixtures of the OCR package.
 *
 *   bun run test/fixtures/generate.ts
 *
 * Produces:
 *   - `text-layer.pdf`   : 2 pages with a real text layer;
 *   - `scanned.png`      : page 1, rasterised;
 *   - `scanned.pdf`      : the 2 rasterised pages repacked without a text layer;
 *   - `invoice-siret.pdf`: 1 page carrying a valid SIRET, for the Party
 *                          matching of the rule engine;
 *   - `payslip-period.pdf`: 1 page carrying a covered period and a payment
 *                          date, for the `analyze` date proposals.
 *
 * The generated files are committed (a few dozen KB).
 *
 * The document text below stays in French on purpose: the OCR tests assert on
 * it.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { runTool } from "../../src/tools";
import { testTools } from "../tools";

const FIXTURES_DIR = dirname(fileURLToPath(import.meta.url));
const RENDER_DPI = 200;

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;

const PAGES: string[][] = [
	[
		"FACTURE N° 2024-001",
		"",
		"Emetteur : Energie Cooperative SAS",
		"Client : Jean Dupont",
		"Date : 15 mars 2024",
		"",
		"Abonnement mensuel .......... 980,00 EUR",
		"Consommation ................ 254,56 EUR",
		"",
		"Net à payer : 1 234,56 €",
	],
	[
		"FACTURE N° 2024-001 - page 2",
		"",
		"Conditions générales de vente",
		"Règlement à trente jours date de facture.",
		"Tout retard entraine des pénalités.",
		"",
		"Total rappelé : 1 234,56 €",
	],
];

/**
 * Invoice from an identifiable issuer: the SIRET 900 000 019 00027 is valid
 * (Luhn) and is used to test the automatic Party matching (SPEC §3).
 */
const SIRET_PAGE: string[] = [
	"FACTURE N° 2025-042",
	"",
	"Emetteur : Nordwind Digital SAS",
	"SIRET 900 000 019 00027",
	"TVA FR25900000019",
	"Client : Jean Dupont",
	"Date : 12 octobre 2025",
	"",
	"Prestation de service ....... 500,00 EUR",
	"",
	"Net à payer : 500,00 €",
];

/**
 * Payslip: the covered period and the payment date are two different things,
 * and the document belongs to the second one. Taking the first date of the text
 * would file it on 01/08, a month early — which is exactly what the ingestion
 * test asserts against.
 */
const PAYSLIP_PAGE: string[] = [
	"BULLETIN DE PAIE",
	"",
	"Employeur : Nordwind Digital SAS",
	"Salarié : Jean Dupont",
	"Période du 01/08/2026 au 31/08/2026",
	"Payé le 28/08/2026",
	"",
	"Salaire de base ............. 3 100,00 €",
	"Cotisations ................. -619,45 €",
	"",
	"NET À PAYER 2 480,55 €",
];

async function buildPdf(pages: string[][]): Promise<Uint8Array> {
	const pdf = await PDFDocument.create();
	const font = await pdf.embedFont(StandardFonts.Helvetica);

	for (const lines of pages) {
		const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
		let y = PAGE_HEIGHT - 80;
		for (const line of lines) {
			if (line.length > 0) {
				page.drawText(line, {
					x: 60,
					y,
					size: 16,
					font,
					color: rgb(0, 0, 0),
				});
			}
			y -= 30;
		}
	}

	pdf.setTitle("Fixture docstore");
	return await pdf.save();
}

function buildTextLayerPdf(): Promise<Uint8Array> {
	return buildPdf(PAGES);
}

async function renderPages(pdfPath: string, outDir: string): Promise<string[]> {
	await runTool([
		testTools.pdftoppm,
		"-r",
		String(RENDER_DPI),
		"-png",
		"-gray",
		pdfPath,
		join(outDir, "page"),
	]);
	// pdftoppm numbers the outputs `page-1.png`, `page-2.png`, ...
	return PAGES.map((_, index) => join(outDir, `page-${index + 1}.png`));
}

async function buildScannedPdf(pngPaths: string[]): Promise<Uint8Array> {
	const pdf = await PDFDocument.create();
	for (const pngPath of pngPaths) {
		const png = await pdf.embedPng(await readFile(pngPath));
		const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
		page.drawImage(png, {
			x: 0,
			y: 0,
			width: PAGE_WIDTH,
			height: PAGE_HEIGHT,
		});
	}
	return await pdf.save();
}

async function main(): Promise<void> {
	const textLayerPath = join(FIXTURES_DIR, "text-layer.pdf");
	await writeFile(textLayerPath, await buildTextLayerPdf());
	console.log(`written: ${textLayerPath}`);

	const invoicePath = join(FIXTURES_DIR, "invoice-siret.pdf");
	await writeFile(invoicePath, await buildPdf([SIRET_PAGE]));
	console.log(`written: ${invoicePath}`);

	const payslipPath = join(FIXTURES_DIR, "payslip-period.pdf");
	await writeFile(payslipPath, await buildPdf([PAYSLIP_PAGE]));
	console.log(`written: ${payslipPath}`);

	const workDir = await mkdtemp(join(tmpdir(), "docstore-fixtures-"));
	try {
		const pngPaths = await renderPages(textLayerPath, workDir);

		const firstPage = pngPaths[0];
		if (!firstPage) throw new Error("no page rendered");
		const scannedPngPath = join(FIXTURES_DIR, "scanned.png");
		await writeFile(scannedPngPath, await readFile(firstPage));
		console.log(`written: ${scannedPngPath}`);

		const scannedPdfPath = join(FIXTURES_DIR, "scanned.pdf");
		await writeFile(scannedPdfPath, await buildScannedPdf(pngPaths));
		console.log(`written: ${scannedPdfPath}`);
	} finally {
		await rm(workDir, { recursive: true, force: true });
	}
}

await main();
