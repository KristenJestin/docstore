import type {
	PartyIdentifiers,
	PartyRelationKind,
	PartyType,
} from "@docstore/shared/party";
import type { Periodicity } from "@docstore/shared/recurrence";
import type { RuleCondition } from "@docstore/shared/rule";
import type { IssuerBlock, RecipientBlock } from "./demo-pdf";
import {
	buildAttestation,
	buildContract,
	buildIdentityCard,
	buildInvoice,
	buildLetter,
	buildPayslip,
	buildRib,
	buildStatement,
} from "./demo-pdf";

/**
 * The demo library: a French household that has been filing its paperwork for
 * a few years (`bun run db:demo`).
 *
 * Everything here is fictional. The SIREN/SIRET/VAT/IBAN values are *valid*
 * (Luhn, mod 97) because the ingestion pre-pass refuses to propose a Party on
 * an identifier that does not check out — a demo built on invalid numbers would
 * show none of the automatic matching that makes the product interesting.
 */

/** The household this library belongs to. */
export const HOUSEHOLD = {
	owner: "Camille Moreau",
	partner: "Jules Moreau",
	child: "Louise Moreau",
	address: ["18 rue Vendôme", "69003 Lyon"],
	city: "Lyon",
} as const;

const HOME: RecipientBlock = {
	name: HOUSEHOLD.owner,
	address: [...HOUSEHOLD.address],
};

function customer(reference: string): RecipientBlock {
	return { ...HOME, customerRef: reference };
}

/* ------------------------------------------------------------------ */
/* Parties                                                              */
/* ------------------------------------------------------------------ */

export interface DemoParty {
	key: string;
	type: PartyType;
	name: string;
	aliases?: string[];
	identifiers?: PartyIdentifiers;
	isHouseholdMember?: boolean;
	notes?: string;
}

export const DEMO_PARTIES: DemoParty[] = [
	{
		key: "camille",
		type: "person",
		name: HOUSEHOLD.owner,
		isHouseholdMember: true,
		identifiers: { email: ["camille@example.com"], phone: ["+33970000000"] },
		notes:
			"Household owner; every document is addressed to her unless stated otherwise.",
	},
	{
		key: "jules",
		type: "person",
		name: HOUSEHOLD.partner,
		isHouseholdMember: true,
		identifiers: { email: ["jules@example.com"] },
	},
	{
		key: "louise",
		type: "person",
		name: HOUSEHOLD.child,
		isHouseholdMember: true,
	},
	{
		key: "free",
		type: "company",
		name: "Free",
		aliases: ["Free SAS", "Iliad", "Freebox"],
		identifiers: {
			siren: "421938861",
			siret: "42193886100117",
			vat: "FR60421938861",
			domain: ["free.fr"],
			customerRef: "FR-4482913",
		},
		notes:
			"Freebox Ultra since March 2019. Invoices arrive by mail on the 5th and are debited on the 20th; the customer area keeps the last 24 of them.",
	},
	{
		key: "orange",
		type: "company",
		name: "Orange",
		aliases: ["Orange SA", "France Télécom"],
		identifiers: {
			siren: "380129866",
			siret: "38012986600022",
			vat: "FR89380129866",
			domain: ["orange.fr"],
		},
	},
	{
		key: "edf",
		type: "company",
		name: "EDF",
		aliases: ["Électricité de France"],
		identifiers: {
			siren: "552081317",
			siret: "55208131766522",
			vat: "FR03552081317",
			domain: ["edf.fr"],
			customerRef: "6018224471",
		},
	},
	{
		key: "engie",
		type: "company",
		name: "Engie",
		aliases: ["GDF Suez"],
		identifiers: {
			siren: "542107651",
			siret: "54210765100011",
			vat: "FR13542107651",
			domain: ["engie.fr"],
		},
	},
	{
		key: "harmonie",
		type: "company",
		name: "Harmonie Mutuelle",
		aliases: ["Harmonie"],
		identifiers: {
			siren: "538518473",
			siret: "53851847300037",
			vat: "FR61538518473",
			domain: ["harmonie-mutuelle.fr"],
			customerRef: "HM-77401932",
		},
	},
	{
		key: "credit-agricole",
		type: "company",
		name: "Crédit Agricole",
		aliases: ["CA Centre-Est", "Crédit Agricole Centre-Est"],
		identifiers: {
			siren: "784608416",
			siret: "78460841600029",
			vat: "FR77784608416",
			domain: ["credit-agricole.fr"],
			iban: ["FR7630006000111234567890136"],
		},
	},
	{
		key: "boursorama",
		type: "company",
		name: "Boursorama",
		aliases: ["BoursoBank"],
		identifiers: {
			siren: "351058151",
			siret: "35105815100017",
			vat: "FR69351058151",
			domain: ["boursorama.com"],
			iban: ["FR7630006000129876543210978"],
		},
	},
	{
		key: "basic-fit",
		type: "company",
		name: "Basic-Fit",
		aliases: ["Basic-Fit France"],
		identifiers: {
			siren: "511973059",
			siret: "51197305900047",
			vat: "FR43511973059",
			domain: ["basic-fit.com"],
			customerRef: "BF-2941188",
		},
	},
	{
		key: "urssaf",
		type: "public_body",
		name: "Urssaf",
		aliases: ["Urssaf Rhône-Alpes"],
		identifiers: { domain: ["urssaf.fr"] },
	},
	{
		key: "impots",
		type: "public_body",
		name: "Impôts (DGFiP)",
		aliases: ["DGFiP", "Direction générale des Finances publiques"],
		identifiers: { domain: ["impots.gouv.fr"] },
	},
	{
		key: "cpam",
		type: "public_body",
		name: "CPAM",
		aliases: ["Assurance Maladie", "CPAM du Rhône"],
		identifiers: { domain: ["ameli.fr"] },
	},
	{
		key: "prefecture",
		type: "public_body",
		name: "Préfecture de la Loire",
		aliases: ["Préfecture 42"],
		identifiers: { domain: ["loire.gouv.fr"] },
	},
	{
		key: "bellecombe",
		type: "company",
		name: "Atelier Bellecombe",
		aliases: ["Groupe Bellecombe"],
		identifiers: {
			siren: "900000027",
			siret: "90000002700012",
			vat: "FR49900000027",
			domain: ["atelier-bellecombe.example"],
		},
		notes: "Previous employer (2021-2023).",
	},
	{
		key: "nordwind",
		type: "company",
		name: "Nordwind Digital",
		aliases: ["Nordwind"],
		identifiers: {
			siren: "900000019",
			siret: "90000001900027",
			vat: "FR25900000019",
			domain: ["nordwind-digital.example"],
		},
		notes: "Current employer.",
	},
	{
		key: "conforama",
		type: "company",
		name: "Conforama",
		identifiers: {
			siren: "306445412",
			siret: "30644541200092",
			vat: "FR27306445412",
			domain: ["conforama.fr"],
		},
	},
	{
		key: "ikea",
		type: "company",
		name: "Ikea",
		aliases: ["IKEA France"],
		identifiers: {
			siren: "351745724",
			siret: "35174572400010",
			vat: "FR83351745724",
			domain: ["ikea.com"],
		},
	},
	{
		key: "maif",
		type: "association",
		name: "Maif",
		aliases: ["MAIF Assurances"],
		identifiers: {
			siren: "775709702",
			siret: "77570970200010",
			vat: "FR81775709702",
			domain: ["maif.fr"],
			customerRef: "3410299X",
		},
	},
	{
		key: "doctolib",
		type: "company",
		name: "Doctolib",
		identifiers: {
			siren: "794598813",
			siret: "79459881300028",
			vat: "FR14794598813",
			domain: ["doctolib.fr"],
		},
	},
];

export const DEMO_PARTY_RELATIONS: {
	from: string;
	to: string;
	kind: PartyRelationKind;
	validFrom?: string;
	validUntil?: string;
}[] = [
	{
		from: "camille",
		to: "bellecombe",
		kind: "works_at",
		validFrom: "2021-09-01",
		validUntil: "2023-06-30",
	},
	{
		from: "camille",
		to: "nordwind",
		kind: "works_at",
		validFrom: "2025-11-02",
	},
	{ from: "jules", to: "camille", kind: "spouse_of" },
	{ from: "louise", to: "camille", kind: "child_of" },
	{ from: "louise", to: "jules", kind: "child_of" },
];

/* ------------------------------------------------------------------ */
/* Tags                                                                 */
/* ------------------------------------------------------------------ */

export const DEMO_TAGS: { key: string; name: string; color: string }[] = [
	{ key: "urgent", name: "urgent", color: "#ef4444" },
	{ key: "to-file", name: "to-file", color: "#f59e0b" },
	{ key: "tax-2025", name: "tax-2025", color: "#6366f1" },
	{ key: "warranty", name: "warranty", color: "#10b981" },
];

/* ------------------------------------------------------------------ */
/* Issuer letterheads                                                   */
/* ------------------------------------------------------------------ */

/** Letterhead of each issuer, printing the identifiers the pre-pass matches on. */
export const LETTERHEADS: Record<string, IssuerBlock> = {
	free: {
		name: "Free",
		address: ["8 rue de la Ville l'Évêque", "75008 Paris"],
		siret: "42193886100117",
		vat: "FR60421938861",
		site: "free.fr",
	},
	orange: {
		name: "Orange",
		address: ["111 quai du Président Roosevelt", "92130 Issy-les-Moulineaux"],
		siret: "38012986600022",
		vat: "FR89380129866",
		site: "orange.fr",
	},
	edf: {
		name: "EDF",
		address: ["22-30 avenue de Wagram", "75008 Paris"],
		siret: "55208131766522",
		vat: "FR03552081317",
		site: "edf.fr",
	},
	engie: {
		name: "Engie",
		address: ["1 place Samuel de Champlain", "92400 Courbevoie"],
		siret: "54210765100011",
		vat: "FR13542107651",
		site: "engie.fr",
	},
	harmonie: {
		name: "Harmonie Mutuelle",
		address: ["143 rue Blomet", "75015 Paris"],
		siret: "53851847300037",
		vat: "FR61538518473",
		site: "harmonie-mutuelle.fr",
	},
	"credit-agricole": {
		name: "Crédit Agricole Centre-Est",
		address: ["1 place de la Bourse", "69002 Lyon"],
		siret: "78460841600029",
		site: "credit-agricole.fr",
	},
	boursorama: {
		name: "Boursorama",
		address: ["44 rue Traversière", "92100 Boulogne-Billancourt"],
		siret: "35105815100017",
		site: "boursorama.com",
	},
	"basic-fit": {
		name: "Basic-Fit",
		address: ["12 rue Gabriel Péri", "69100 Villeurbanne"],
		siret: "51197305900047",
		vat: "FR43511973059",
		site: "basic-fit.com",
	},
	urssaf: {
		name: "Urssaf Rhône-Alpes",
		address: ["Immeuble Le Britannia, 20 boulevard Deruelle", "69003 Lyon"],
		site: "urssaf.fr",
	},
	impots: {
		name: "Direction générale des Finances publiques",
		address: ["Service des impôts des particuliers", "69003 Lyon"],
		site: "impots.gouv.fr",
	},
	cpam: {
		name: "CPAM du Rhône",
		address: ["276 cours Émile Zola", "69003 Lyon"],
		site: "ameli.fr",
	},
	prefecture: {
		name: "Préfecture de la Loire",
		address: ["2 rue Charles de Gaulle", "42022 Saint-Étienne"],
		site: "loire.gouv.fr",
	},
	bellecombe: {
		name: "Atelier Bellecombe",
		address: ["14 rue Bellecombe", "69006 Lyon"],
		siret: "90000002700012",
		vat: "FR49900000027",
		site: "atelier-bellecombe.example",
	},
	nordwind: {
		name: "Nordwind Digital",
		address: ["52 rue de la République", "69002 Lyon"],
		siret: "90000001900027",
		vat: "FR25900000019",
		site: "nordwind-digital.example",
	},
	conforama: {
		name: "Conforama",
		address: ["Route de Genas", "69800 Saint-Priest"],
		siret: "30644541200092",
		vat: "FR27306445412",
		site: "conforama.fr",
	},
	ikea: {
		name: "Ikea France",
		address: ["Avenue Jean Jaurès", "69800 Saint-Priest"],
		siret: "35174572400010",
		vat: "FR83351745724",
		site: "ikea.com",
	},
	maif: {
		name: "Maif",
		address: ["200 avenue Salvador Allende", "79000 Niort"],
		siret: "77570970200010",
		vat: "FR81775709702",
		site: "maif.fr",
	},
	doctolib: {
		name: "Doctolib",
		address: ["54 quai Charles Pasqua", "92300 Levallois-Perret"],
		siret: "79459881300028",
		vat: "FR14794598813",
		site: "doctolib.fr",
	},
};

function letterhead(key: string): IssuerBlock {
	const value = LETTERHEADS[key];
	if (!value) throw new Error(`No letterhead for "${key}".`);
	return value;
}

/* ------------------------------------------------------------------ */
/* Document types                                                       */
/* ------------------------------------------------------------------ */

export interface DemoLayout {
	name: string;
	signature?: RuleCondition;
	/** Extraction rules of the layout, targeting a seeded custom field. */
	extractions?: {
		name: string;
		fieldSlug: string;
		label: string;
		valuePattern: string;
		/** Regex flags of the label; nothing is added on its behalf. */
		flags?: string;
	}[];
}

export interface DemoDocumentType {
	key: string;
	name: string;
	description: string;
	categorySlug: string;
	issuerKey?: string;
	subjectKey?: string;
	titleTemplate?: string;
	sensitiveDefault?: boolean;
	tagKeys?: string[];
	/** `null` = never detected automatically; the type is applied by hand. */
	detection: RuleCondition | null;
	recurrence?: {
		periodicity: Periodicity;
		startPeriod: string;
		endPeriod?: string;
		expectedDay?: number;
		graceDays?: number;
	};
	/** Layouts added next to the `Default` one created with the type. */
	layouts?: DemoLayout[];
	/** Extraction rules added to the `Default` layout. */
	defaultExtractions?: DemoLayout["extractions"];
}

/** Both payslip types read their net pay the same way; the label is standard. */
const NET_PAY_EXTRACTION = {
	name: "Net pay",
	fieldSlug: "net-pay",
	label: "NET (À|A) PAYER",
	valuePattern: "(\\d[\\d\\s.,]*\\d)",
	// The payslips print "Net à payer": the `i` is spelled out, never implied.
	flags: "i",
};

const TOTAL_TTC_EXTRACTION = {
	name: "Total TTC",
	fieldSlug: "total-amount",
	label: "TOTAL TTC",
	valuePattern: "(\\d[\\d\\s.,]*\\d)",
	flags: "i",
};

export const DEMO_DOCUMENT_TYPES: DemoDocumentType[] = [
	{
		key: "free-internet",
		name: "Free — Internet invoice",
		description:
			"Monthly Freebox invoice. Detected on the Freebox wording, filed under Subscription with the Total TTC extracted.",
		categorySlug: "subscription",
		issuerKey: "free",
		titleTemplate: "{issuer} - Internet - {date:YYYY-MM}",
		detection: { field: "content", cmp: "icontains", value: "Freebox" },
		recurrence: {
			periodicity: "monthly",
			startPeriod: "2026-01-01",
			expectedDay: 5,
		},
		defaultExtractions: [TOTAL_TTC_EXTRACTION],
	},
	{
		key: "bellecombe-payslip",
		name: "Atelier Bellecombe — Payslip",
		description:
			"Payslips of the 2021-2023 job, produced by Silae. Closed recurrence: the contract ended in June 2023.",
		categorySlug: "payslip",
		issuerKey: "bellecombe",
		subjectKey: "camille",
		titleTemplate: "{issuer} - Payslip - {period}",
		detection: {
			op: "and",
			children: [
				{ field: "content", cmp: "icontains", value: "BULLETIN DE PAIE" },
				{ field: "content", cmp: "icontains", value: "Atelier Bellecombe" },
			],
		},
		recurrence: {
			periodicity: "monthly",
			startPeriod: "2023-01-01",
			endPeriod: "2023-06-01",
			expectedDay: 28,
		},
		layouts: [
			{
				name: "Silae",
				signature: { field: "content", cmp: "icontains", value: "Silae" },
				extractions: [NET_PAY_EXTRACTION],
			},
		],
	},
	{
		key: "nordwind-payslip",
		name: "Nordwind Digital — Payslip",
		description:
			"Payslips of the current job, produced by PayFit. The Net pay of each month is extracted from the layout.",
		categorySlug: "payslip",
		issuerKey: "nordwind",
		subjectKey: "camille",
		titleTemplate: "{issuer} - Payslip - {period}",
		detection: {
			op: "and",
			children: [
				{ field: "content", cmp: "icontains", value: "BULLETIN DE PAIE" },
				{ field: "content", cmp: "icontains", value: "Nordwind Digital" },
			],
		},
		recurrence: {
			periodicity: "monthly",
			startPeriod: "2025-11-01",
			expectedDay: 28,
		},
		layouts: [
			{
				name: "Payfit",
				signature: { field: "content", cmp: "icontains", value: "PayFit" },
				extractions: [NET_PAY_EXTRACTION],
			},
		],
	},
	{
		key: "edf-electricity",
		name: "EDF — Electricity invoice",
		description:
			"Electricity invoice, billed every two months and therefore tracked quarterly.",
		categorySlug: "invoice",
		issuerKey: "edf",
		titleTemplate: "{issuer} - Electricity - {date:YYYY-MM}",
		detection: {
			op: "and",
			children: [
				{ field: "content", cmp: "icontains", value: "EDF" },
				{ field: "content", cmp: "icontains", value: "électricité" },
			],
		},
		recurrence: {
			periodicity: "quarterly",
			startPeriod: "2025-07-01",
			graceDays: 20,
		},
		defaultExtractions: [TOTAL_TTC_EXTRACTION],
	},
	{
		key: "basicfit-membership",
		name: "Basic-Fit — Membership",
		description:
			"Gym membership, billed monthly. No detection condition: the type is applied by hand from the documents list.",
		categorySlug: "subscription",
		issuerKey: "basic-fit",
		titleTemplate: "{issuer} - Membership - {date:YYYY-MM}",
		detection: null,
		recurrence: {
			periodicity: "monthly",
			startPeriod: "2026-05-01",
			expectedDay: 3,
		},
	},
	{
		key: "harmonie-statement",
		name: "Harmonie Mutuelle — Statement",
		description: "Yearly statement of the complementary health insurance.",
		categorySlug: "health",
		issuerKey: "harmonie",
		titleTemplate: "{issuer} - Statement - {date:YYYY}",
		detection: null,
		recurrence: { periodicity: "yearly", startPeriod: "2023-01-01" },
	},
	{
		key: "identity-document",
		name: "Identity document",
		description:
			"Identity card or passport of a household member. One-off, never recurring.",
		categorySlug: "identity",
		subjectKey: "camille",
		titleTemplate: "Identity card - {subject}",
		sensitiveDefault: true,
		detection: null,
	},
	{
		key: "rib",
		name: "RIB",
		description:
			"Bank details. Sensitive by default: the file is encrypted at rest.",
		categorySlug: "banking",
		titleTemplate: "Bank details - {issuer}",
		sensitiveDefault: true,
		detection: null,
	},
];

/* ------------------------------------------------------------------ */
/* Planned documents                                                    */
/* ------------------------------------------------------------------ */

export interface PlannedDocument {
	/** Stable key, used to wire dossiers, relations and the share link. */
	key: string;
	filename: string;
	/**
	 * Title given at intake. Left out for the documents a type will name (the
	 * template only fires while the title still is the one derived from the file
	 * name) and for the scan nobody has got round to naming.
	 */
	title?: string;
	/** Built lazily: nothing is rendered before the pipeline asks for it. */
	build: () => Promise<Uint8Array>;
	/** Rasterised to a grayscale PNG before intake, as a flatbed scan would be. */
	scan?: boolean;
	/** Deliberately truncated payload, so the pipeline really fails on it. */
	broken?: boolean;
	source?: "upload" | "mail" | "folder" | "link" | "api";
	receivedAt?: string;
	/** Category imposed at intake, for a document no type will classify. */
	categorySlug?: string;
	/** Issuer imposed at intake, when the letterhead carries no identifier. */
	issuerKey?: string;
	tagKeys?: string[];
	/** Type applied by hand once the document is processed. */
	applyTypeKey?: string;
	/** Expiry typed in by hand, the way the owner would after filing the paper. */
	validUntil?: string;
	/**
	 * Date corrected by hand. An identity card carries the holder's birth date
	 * before anything else, so the automatic reading files it in 1988: this is
	 * the correction a human makes, and it is recorded as a manual field.
	 */
	documentDate?: string;
	sensitive?: boolean;
	physicalLocation?: string;
	/** Give the document an archive serial number. */
	asn?: boolean;
}

function iso(year: number, month: number, day: number): string {
	return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function lastDayOf(year: number, month: number): number {
	return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Walks `count` months forward from `year`/`month`. */
function months(
	year: number,
	month: number,
	count: number,
): [number, number][] {
	const list: [number, number][] = [];
	for (let index = 0; index < count; index += 1) {
		const absolute = year * 12 + month - 1 + index;
		list.push([Math.floor(absolute / 12), (absolute % 12) + 1]);
	}
	return list;
}

/* ---- Free: monthly Freebox invoice ------------------------------- */

function freeInvoices(): PlannedDocument[] {
	// Two months are missing on purpose: that is what the recurrence gap
	// detection and the `period_gap` reminders are there to show.
	const skipped = new Set(["2026-03", "2026-06"]);
	return months(2026, 1, 8)
		.filter(
			([year, month]) =>
				!skipped.has(`${year}-${String(month).padStart(2, "0")}`),
		)
		.map(([year, month]) => {
			const key = `free-${year}-${String(month).padStart(2, "0")}`;
			// A few months carry calls outside the plan: two identical invoices in
			// a row would make the extracted Total TTC look like a constant.
			const extra = [0, 0, 3.7, 0, 1.25, 0, 6.4, 2.1][month - 1] ?? 0;
			return {
				key,
				filename: `facture_free_${year}-${String(month).padStart(2, "0")}.pdf`,
				source: "mail" as const,
				build: () =>
					buildInvoice({
						issuer: letterhead("free"),
						recipient: customer("FR-4482913"),
						number: `${year}${String(month).padStart(2, "0")}-4482913`,
						issueDate: iso(year, month, 5),
						dueDate: iso(year, month, 20),
						periodStart: iso(year, month, 1),
						periodEnd: iso(year, month, lastDayOf(year, month)),
						lines: [
							{
								label: "Abonnement Freebox Ultra",
								detail: "Fibre 8 Gbit/s - TV - Téléphonie fixe",
								amount: 41.66,
							},
							{ label: "Option TV by CANAL", amount: 8.33 },
							...(extra > 0
								? [
										{
											label: "Communications hors forfait",
											detail: "Appels vers les mobiles",
											amount: extra,
										},
									]
								: []),
						],
						notes: [
							"Prélèvement automatique sur le compte se terminant par 0123.",
						],
						footer: ["Facture disponible dans votre Espace Abonné Freebox."],
					}),
			};
		});
}

/* ---- Payslips ---------------------------------------------------- */

function payslip(options: {
	employerKey: "bellecombe" | "nordwind";
	year: number;
	month: number;
	job: string;
	software: string;
	base: number;
	rate: string;
	/** Overtime, bonus, holiday pay: what makes two months differ. */
	extras?: { label: string; amount: number }[];
}): PlannedDocument {
	const { year, month } = options;
	const stamp = `${year}-${String(month).padStart(2, "0")}`;
	const extras = options.extras ?? [];
	const gross =
		Math.round(
			(options.base + extras.reduce((sum, item) => sum + item.amount, 0)) * 100,
		) / 100;
	const contributions = Math.round(gross * -0.2185 * 100) / 100;
	const taxableNet = Math.round((gross + contributions) * 100) / 100;
	const incomeTax = Math.round(taxableNet * 0.101 * 100) / 100;
	const net = Math.round((taxableNet - incomeTax) * 100) / 100;
	const slug = options.employerKey === "nordwind" ? "nordwind" : "bellecombe";

	return {
		key: `payslip-${slug}-${stamp}`,
		filename: `bulletin_paie_${slug}_${stamp}.pdf`,
		source: "folder",
		build: () =>
			buildPayslip({
				employer: letterhead(options.employerKey),
				employee: {
					name: HOUSEHOLD.owner,
					address: [...HOUSEHOLD.address],
					job: options.job,
					ssn: "1 88 05 69 123 042 17",
				},
				periodStart: iso(year, month, 1),
				periodEnd: iso(year, month, lastDayOf(year, month)),
				paidOn: iso(year, month, Math.min(28, lastDayOf(year, month))),
				lines: [
					{
						label: "Salaire de base",
						base: "151,67 h",
						rate: options.rate,
						amount: options.base,
					},
					...extras,
					{ label: "Cotisations salariales", amount: contributions },
				],
				gross,
				net,
				taxableNet,
				incomeTax,
				software: options.software,
				reference: `BP-${stamp}-${options.employerKey === "nordwind" ? "014" : "221"}`,
			}),
	};
}

function bellecombePayslips(): PlannedDocument[] {
	return months(2023, 1, 6).map(([year, month], index) =>
		payslip({
			employerKey: "bellecombe",
			year,
			month,
			job: "Technicien logistique",
			software: "Silae",
			base: 2480,
			rate: "16,35",
			extras:
				month === 6
					? [
							{
								label: "Indemnité compensatrice de congés payés",
								amount: 618.4,
							},
						]
					: index % 2 === 0
						? [{ label: "Heures supplémentaires (5 h)", amount: 102.19 }]
						: [],
		}),
	);
}

function nordwindPayslips(): PlannedDocument[] {
	return months(2025, 11, 10).map(([year, month], index) =>
		payslip({
			employerKey: "nordwind",
			year,
			month,
			job: "Développeur",
			software: "PayFit",
			// The annual raise takes effect in January.
			base: year >= 2026 ? 3835.2 : 3715.9,
			rate: year >= 2026 ? "25,29" : "24,50",
			extras:
				month === 12
					? [{ label: "Prime de fin d'année", amount: 1200 }]
					: index % 3 === 1
						? [{ label: "Heures supplémentaires (7 h)", amount: 214.38 }]
						: [],
		}),
	);
}

/* ---- EDF: bi-monthly electricity invoice ------------------------- */

function edfInvoices(): PlannedDocument[] {
	// Billed every two months and tracked quarterly; nothing arrived for the
	// first quarter of 2026, which the recurrence reports as a gap.
	// Year, issue month, consumption of the two months it covers.
	const issues: [number, number, number][] = [
		[2025, 11, 186.42],
		[2026, 5, 132.75],
		[2026, 8, 94.6],
	];
	return issues.map(([year, month, consumption]) => {
		const stamp = `${year}-${String(month).padStart(2, "0")}`;
		const fromMonth = month > 2 ? month - 2 : month + 10;
		const fromYear = month > 2 ? year : year - 1;
		return {
			key: `edf-${stamp}`,
			filename: `facture_edf_${stamp}.pdf`,
			source: "mail" as const,
			build: () =>
				buildInvoice({
					issuer: letterhead("edf"),
					recipient: customer("6018224471"),
					number: `EDF-${stamp}-6018224471`,
					issueDate: iso(year, month, 12),
					dueDate: iso(year, month, 27),
					periodStart: iso(fromYear, fromMonth, 1),
					periodEnd: iso(year, month, 10),
					vatRate: 20,
					lines: [
						{
							label: "Consommation d'électricité",
							detail: "Tarif Bleu - option base - 6 kVA",
							amount: consumption,
						},
						{ label: "Abonnement électricité", amount: 26.5 },
						{ label: "Contribution tarifaire d'acheminement", amount: 9.15 },
					],
					notes: [
						"Relevé de compteur estimé; un relevé réel sera fait au prochain passage.",
					],
				}),
		};
	});
}

/* ---- Basic-Fit: monthly membership ------------------------------- */

function basicFitInvoices(): PlannedDocument[] {
	const issues: [number, number][] = [
		[2026, 5],
		[2026, 7],
		[2026, 8],
	];
	return issues.map(([year, month]) => {
		const stamp = `${year}-${String(month).padStart(2, "0")}`;
		return {
			key: `basicfit-${stamp}`,
			filename: `basic-fit_${stamp}.pdf`,
			source: "mail" as const,
			categorySlug: "subscription",
			issuerKey: "basic-fit",
			applyTypeKey: "basicfit-membership",
			build: () =>
				buildInvoice({
					issuer: letterhead("basic-fit"),
					recipient: customer("BF-2941188"),
					number: `BF-${stamp}-2941188`,
					issueDate: iso(year, month, 3),
					periodStart: iso(year, month, 1),
					periodEnd: iso(year, month, lastDayOf(year, month)),
					paid: true,
					lines: [
						{
							label: "Abonnement Comfort",
							detail: "Club de Villeurbanne",
							amount: 24.99,
						},
					],
					footer: [
						"Abonnement sans engagement, résiliable à tout moment depuis l'application.",
					],
				}),
		};
	});
}

/* ---- Harmonie Mutuelle: yearly statement ------------------------- */

function harmonieStatements(): PlannedDocument[] {
	const years: [number, { date: string; label: string; amount: number }[]][] = [
		[
			2023,
			[
				{ date: "2023-03-14", label: "Consultation généraliste", amount: 8.4 },
				{ date: "2023-06-02", label: "Pharmacie", amount: 21.75 },
				{ date: "2023-11-28", label: "Soins dentaires", amount: 132.9 },
			],
		],
		[
			2024,
			[
				{
					date: "2024-02-09",
					label: "Optique - monture et verres",
					amount: 210,
				},
				{ date: "2024-05-21", label: "Consultation spécialiste", amount: 19.6 },
				{ date: "2024-09-30", label: "Pharmacie", amount: 34.2 },
			],
		],
		[
			2025,
			[
				{ date: "2025-01-17", label: "Consultation généraliste", amount: 8.4 },
				{
					date: "2025-04-08",
					label: "Kinésithérapie - 10 séances",
					amount: 88,
				},
				{ date: "2025-10-23", label: "Soins dentaires", amount: 156.4 },
			],
		],
	];
	return years.map(([year, rows]) => ({
		key: `harmonie-${year}`,
		filename: `harmonie_releve_${year}.pdf`,
		source: "link" as const,
		categorySlug: "health",
		issuerKey: "harmonie",
		applyTypeKey: "harmonie-statement",
		build: () =>
			buildStatement({
				title: `Relevé annuel des prestations ${year}`,
				kind: "RELEVÉ",
				issuer: letterhead("harmonie"),
				recipient: customer("HM-77401932"),
				reference: `HM-${year}-77401932`,
				issuedOn: `${year}-12-31`,
				issueLabel: "Établi le",
				periodStart: `${year}-01-01`,
				periodEnd: `${year}-12-31`,
				columns: ["PRESTATION", "REMBOURSÉ"],
				rows,
				totalLabel: "TOTAL REMBOURSÉ",
				footer: ["Document à conserver pour votre déclaration de revenus."],
			}),
	}));
}

/* ---- One-off documents ------------------------------------------- */

function oneOffDocuments(): PlannedDocument[] {
	return [
		{
			key: "id-card",
			filename: "carte_identite_camille_scan.pdf",
			documentDate: "2016-11-15",
			scan: true,
			source: "upload",
			categorySlug: "identity",
			issuerKey: "prefecture",
			applyTypeKey: "identity-document",
			validUntil: "2026-11-14",
			sensitive: true,
			physicalLocation: "Classeur bleu",
			asn: true,
			build: () =>
				buildIdentityCard({
					surname: "MOREAU",
					givenNames: "Camille",
					birthDate: "1988-05-14",
					birthPlace: "LYON (69)",
					sex: "M",
					height: "1,81 m",
					number: "160769401337",
					issuedOn: "2016-11-15",
					validUntil: "2026-11-14",
					authority: "Préfecture de la Loire",
				}),
		},
		{
			key: "rib-ca",
			filename: "rib_credit_agricole.pdf",
			source: "upload",
			categorySlug: "banking",
			issuerKey: "credit-agricole",
			applyTypeKey: "rib",
			physicalLocation: "Classeur bleu",
			asn: true,
			build: () =>
				buildRib({
					bank: letterhead("credit-agricole"),
					holder: {
						name: `${HOUSEHOLD.owner} ou ${HOUSEHOLD.partner}`,
						address: [...HOUSEHOLD.address],
					},
					agency: "Lyon Part-Dieu",
					bankCode: "30006",
					branchCode: "00011",
					accountNumber: "12345678901",
					ribKey: "36",
					iban: "FR76 3000 6000 1112 3456 7890 136",
					bic: "AGRIFRPP891",
					issuedOn: "2024-02-19",
				}),
		},
		{
			key: "boursorama-statement",
			filename: "boursorama_releve_2026-07.pdf",
			title: "Boursorama - account statement, July 2026",
			source: "link",
			categorySlug: "banking",
			issuerKey: "boursorama",
			build: () =>
				buildStatement({
					title: "Relevé de compte - juillet 2026",
					kind: "RELEVÉ DE COMPTE",
					issuer: letterhead("boursorama"),
					recipient: { name: HOUSEHOLD.owner, address: [...HOUSEHOLD.address] },
					reference: "IBAN FR76 3000 6000 1298 7654 3210 978",
					issuedOn: "2026-08-01",
					periodStart: "2026-07-01",
					periodEnd: "2026-07-31",
					columns: ["OPÉRATION", "MONTANT"],
					rows: [
						{
							date: "2026-07-03",
							label: "Prélèvement Basic-Fit",
							amount: -24.99,
						},
						{
							date: "2026-07-05",
							label: "Prélèvement Free Telecom",
							amount: -59.99,
						},
						{
							date: "2026-07-28",
							label: "Virement salaire Nordwind Digital",
							amount: 2610.55,
						},
						{
							date: "2026-07-30",
							label: "Prélèvement Maif habitation",
							amount: -31.4,
						},
					],
					totalLabel: "SOLDE DE LA PÉRIODE",
					footer: ["Relevé conservé 10 ans dans votre espace client."],
				}),
		},
		{
			key: "orange-contract",
			filename: "contrat_orange_mobile.pdf",
			title: "Orange - mobile contract",
			source: "upload",
			categorySlug: "contract",
			issuerKey: "orange",
			physicalLocation: "Carton 3",
			build: () =>
				buildContract({
					title: "Contrat d'abonnement mobile",
					issuer: letterhead("orange"),
					recipient: customer("OR-99120884"),
					reference: "OR-99120884",
					signedOn: "2024-03-12",
					place: HOUSEHOLD.city,
					intro: [
						"Le présent contrat définit les conditions de fourniture du service mobile souscrit par le client.",
					],
					clauses: [
						{
							heading: "Article 1 - Objet",
							body: [
								"Forfait Série Spéciale 140 Go, appels et SMS illimités en France métropolitaine.",
							],
						},
						{
							heading: "Article 2 - Durée et résiliation",
							body: [
								"Engagement de 24 mois à compter de la date de mise en service.",
								"Résiliation possible à tout moment moyennant le respect du préavis de 10 jours.",
							],
						},
						{
							heading: "Article 3 - Prix",
							body: [
								"Montant mensuel : 19,99 € TTC, prélevé le 8 de chaque mois.",
							],
						},
					],
					signatories: ["Pour Orange", `Le client - ${HOUSEHOLD.owner}`],
				}),
		},
		{
			key: "engie-contract",
			filename: "contrat_engie_gaz.pdf",
			title: "Engie - gas supply contract",
			source: "upload",
			categorySlug: "housing",
			issuerKey: "engie",
			physicalLocation: "Carton 3",
			build: () =>
				buildContract({
					title: "Contrat de fourniture de gaz naturel",
					issuer: letterhead("engie"),
					recipient: customer("EN-4471023"),
					reference: "EN-4471023",
					signedOn: "2023-09-04",
					place: HOUSEHOLD.city,
					intro: [
						"Contrat de fourniture de gaz naturel pour le logement situé au 18 rue Vendôme, 69003 Lyon.",
					],
					clauses: [
						{
							heading: "Article 1 - Offre souscrite",
							body: [
								"Offre Gaz Passerelle, prix du kWh indexé sur le prix repère de la CRE.",
							],
						},
						{
							heading: "Article 2 - Point de livraison",
							body: ["PCE 69003114872 - compteur relevé semestriellement."],
						},
						{
							heading: "Article 3 - Facturation",
							body: [
								"Mensualisation avec régularisation annuelle au mois de septembre.",
							],
						},
					],
					signatories: ["Pour Engie", `Le client - ${HOUSEHOLD.owner}`],
				}),
		},
		{
			key: "bellecombe-contract",
			filename: "contrat_travail_bellecombe.pdf",
			title: "Atelier Bellecombe - employment contract",
			source: "upload",
			categorySlug: "employment",
			issuerKey: "bellecombe",
			physicalLocation: "Carton 3",
			asn: true,
			build: () =>
				buildContract({
					title: "Contrat de travail à durée indéterminée",
					issuer: letterhead("bellecombe"),
					recipient: { name: HOUSEHOLD.owner, address: [...HOUSEHOLD.address] },
					reference: "CDI-2021-0442",
					signedOn: "2021-08-24",
					place: "Lyon",
					intro: [
						"Entre la société Atelier Bellecombe, ci-après l'employeur, et Camille Moreau, ci-après la salariée, il a été convenu ce qui suit.",
					],
					clauses: [
						{
							heading: "Article 1 - Engagement",
							body: [
								"Le salarié est engagé à compter du 1er septembre 2021 en qualité de technicien logistique.",
							],
						},
						{
							heading: "Article 2 - Rémunération",
							body: [
								"Salaire mensuel brut de 2 480,00 € pour 151,67 heures de travail.",
							],
						},
						{
							heading: "Article 3 - Lieu de travail",
							body: ["14 rue Bellecombe, 69006 Lyon."],
						},
					],
					signatories: [
						"Pour Atelier Bellecombe",
						`Le salarié - ${HOUSEHOLD.owner}`,
					],
				}),
		},
		{
			key: "nordwind-contract",
			filename: "contrat_travail_nordwind.pdf",
			title: "Nordwind Digital - employment contract",
			source: "upload",
			categorySlug: "employment",
			issuerKey: "nordwind",
			tagKeys: ["to-file"],
			physicalLocation: "Carton 3",
			asn: true,
			build: () =>
				buildContract({
					title: "Contrat de travail à durée indéterminée",
					issuer: letterhead("nordwind"),
					recipient: { name: HOUSEHOLD.owner, address: [...HOUSEHOLD.address] },
					reference: "CDI-2025-0118",
					signedOn: "2025-10-14",
					place: HOUSEHOLD.city,
					intro: [
						"Entre la société Nordwind Digital, ci-après l'employeur, et Camille Moreau, ci-après la salariée, il a été convenu ce qui suit.",
					],
					clauses: [
						{
							heading: "Article 1 - Engagement",
							body: [
								"Le salarié est engagé à compter du 2 novembre 2025 en qualité de développeur.",
							],
						},
						{
							heading: "Article 2 - Rémunération",
							body: [
								"Salaire mensuel brut de 3 715,90 € pour 151,67 heures de travail.",
							],
						},
						{
							heading: "Article 3 - Période d'essai",
							body: ["Période d'essai de quatre mois, renouvelable une fois."],
						},
					],
					signatories: [
						"Pour Nordwind Digital",
						`Le salarié - ${HOUSEHOLD.owner}`,
					],
				}),
		},
		{
			key: "maif-attestation",
			filename: "attestation_maif_habitation.pdf",
			title: "Maif - home insurance certificate 2026",
			source: "mail",
			categorySlug: "insurance",
			issuerKey: "maif",
			validUntil: "2027-01-31",
			build: () =>
				buildAttestation({
					title: "Attestation d'assurance habitation",
					issuer: letterhead("maif"),
					recipient: customer("3410299X"),
					reference: "3410299X-2026",
					issuedOn: "2026-02-01",
					place: "Niort",
					body: [
						"La Maif atteste que Camille Moreau est assurée au titre du contrat Habitation n° 3410299X",
						"pour le logement situé 18 rue Vendôme, 69003 Lyon.",
						"",
						"Les garanties couvrent notamment l'incendie, le dégât des eaux, le vol et la responsabilité civile.",
					],
					validUntil: "2027-01-31",
					signature: "Le service Habitation",
				}),
		},
		{
			key: "urssaf-attestation",
			filename: "attestation_urssaf_vigilance.pdf",
			title: "Urssaf - clearance certificate",
			source: "link",
			categorySlug: "administrative",
			issuerKey: "urssaf",
			tagKeys: ["tax-2025"],
			validUntil: "2026-12-31",
			build: () =>
				buildAttestation({
					title: "Attestation de vigilance",
					issuer: letterhead("urssaf"),
					recipient: { name: HOUSEHOLD.owner, address: [...HOUSEHOLD.address] },
					reference: "AV-2025-8841207",
					issuedOn: "2025-12-18",
					place: "Lyon",
					body: [
						"L'Urssaf atteste que le cotisant désigné ci-dessus est à jour de ses obligations",
						"de déclaration et de paiement au 30 novembre 2025.",
					],
					validUntil: "2026-12-31",
					signature: "Le directeur de l'Urssaf Rhône-Alpes",
				}),
		},
		{
			key: "impots-avis",
			filename: "avis_impot_2025.pdf",
			title: "Income tax notice 2025",
			source: "link",
			categorySlug: "taxes",
			issuerKey: "impots",
			tagKeys: ["tax-2025"],
			physicalLocation: "Carton 3",
			build: () =>
				buildStatement({
					title: "Avis d'impôt sur le revenu 2025",
					kind: "AVIS D'IMPÔT",
					issuer: letterhead("impots"),
					recipient: {
						name: `${HOUSEHOLD.owner} et ${HOUSEHOLD.partner}`,
						address: [...HOUSEHOLD.address],
					},
					reference: "Numéro fiscal 6904118820394",
					issuedOn: "2025-08-05",
					issueLabel: "Émis le",
					columns: ["ÉLÉMENT", "MONTANT"],
					rows: [
						{ date: "2025-08-05", label: "Revenu brut global", amount: 48520 },
						{
							date: "2025-08-05",
							label: "Revenu net imposable",
							amount: 43668,
						},
						{
							date: "2025-08-05",
							label: "Impôt sur le revenu net",
							amount: 3184,
						},
					],
					totalLabel: "MONTANT RESTANT À PAYER",
					footer: ["Date limite de paiement : 15 septembre 2025."],
				}),
		},
		{
			key: "cpam-droits",
			filename: "attestation_cpam_droits.pdf",
			title: "CPAM - entitlement certificate",
			source: "link",
			categorySlug: "health",
			issuerKey: "cpam",
			build: () =>
				buildAttestation({
					title: "Attestation de droits à l'assurance maladie",
					issuer: letterhead("cpam"),
					recipient: { name: HOUSEHOLD.owner, address: [...HOUSEHOLD.address] },
					reference: "N° de sécurité sociale 1 88 05 69 123 042 17",
					issuedOn: "2026-02-10",
					place: HOUSEHOLD.city,
					body: [
						"La Caisse primaire d'assurance maladie du Rhône atteste que l'assuré désigné",
						"ci-dessus bénéficie de la prise en charge de ses frais de santé.",
						"",
						"Ayants droit rattachés : Louise Moreau.",
					],
					signature: "La CPAM du Rhône",
				}),
		},
		{
			key: "prefecture-recepisse",
			filename: "recepisse_prefecture_carte_grise.pdf",
			title: "Provisional vehicle registration certificate",
			source: "mail",
			categorySlug: "administrative",
			issuerKey: "prefecture",
			tagKeys: ["urgent"],
			validUntil: "2026-10-05",
			build: () =>
				buildAttestation({
					title: "Certificat provisoire d'immatriculation",
					issuer: letterhead("prefecture"),
					recipient: { name: HOUSEHOLD.owner, address: [...HOUSEHOLD.address] },
					reference: "CPI-69-2026-338217",
					issuedOn: "2026-08-06",
					place: "Saint-Étienne",
					body: [
						"Le présent certificat autorise la circulation du véhicule immatriculé EF-318-LM",
						"dans l'attente de la réception du certificat d'immatriculation définitif.",
					],
					validUntil: "2026-10-05",
					signature: "Pour le préfet et par délégation",
				}),
		},
		{
			key: "conforama-invoice",
			filename: "facture_conforama_canape.pdf",
			title: "Conforama - Malmo corner sofa",
			source: "upload",
			categorySlug: "purchase",
			issuerKey: "conforama",
			tagKeys: ["warranty"],
			build: () =>
				buildInvoice({
					issuer: letterhead("conforama"),
					recipient: { name: HOUSEHOLD.owner, address: [...HOUSEHOLD.address] },
					number: "CF-2025-118420",
					issueDate: "2025-11-18",
					issueLabel: "Facture émise le",
					paid: true,
					lines: [
						{
							label: "Canapé d'angle Malmo",
							detail: "Tissu gris - garantie 2 ans",
							amount: 749.17,
						},
						{ label: "Livraison et installation", amount: 41.66 },
					],
					notes: [
						"Garantie constructeur de deux ans à compter de la date de livraison.",
					],
				}),
		},
		{
			key: "ikea-invoice",
			filename: "facture_ikea_cuisine.pdf",
			source: "upload",
			categorySlug: "purchase",
			issuerKey: "ikea",
			tagKeys: ["warranty"],
			build: () =>
				buildInvoice({
					issuer: letterhead("ikea"),
					recipient: { name: HOUSEHOLD.owner, address: [...HOUSEHOLD.address] },
					number: "IK-2026-004918",
					issueDate: "2026-01-22",
					paid: true,
					lines: [
						{
							label: "Cuisine METOD",
							detail: "Façades VOXTORP - garantie 25 ans",
							amount: 2415.83,
						},
						{ label: "Plan de travail EKBACKEN", amount: 191.66 },
						{ label: "Montage par un prestataire IKEA", amount: 375 },
					],
					notes: [
						"Garantie de 25 ans sur les caissons METOD, sur présentation de cette facture.",
					],
				}),
		},
		{
			key: "doctolib-invoice",
			filename: "doctolib_justificatif_rdv.pdf",
			title: "Doctolib - appointment record, Louise",
			source: "mail",
			categorySlug: "health",
			issuerKey: "doctolib",
			build: () =>
				buildAttestation({
					title: "Justificatif de rendez-vous",
					issuer: letterhead("doctolib"),
					recipient: { name: HOUSEHOLD.child, address: [...HOUSEHOLD.address] },
					reference: "RDV-2026-77120934",
					issuedOn: "2026-08-20",
					place: "Paris",
					body: [
						"Ce document atteste de la présence de Louise Moreau au rendez-vous du 20 août 2026",
						"auprès du Dr Claire Perrin, pédiatre, 8 rue Vauban, 69006 Lyon.",
					],
					signature: "Document généré par Doctolib",
				}),
		},
		{
			// Nothing identifies the sender: the pipeline honestly cannot file it,
			// which is exactly what the review queue exists for.
			key: "unknown-letter",
			filename: "courrier_scanne_2026-08-24.pdf",
			source: "folder",
			build: () =>
				buildLetter({
					sender: {
						name: "Syndicat des copropriétaires",
						address: ["Résidence des Tilleuls", "69003 Lyon"],
					},
					recipient: { name: HOUSEHOLD.owner, address: [...HOUSEHOLD.address] },
					place: HOUSEHOLD.city,
					date: "2026-08-24",
					subject: "Convocation à l'assemblée générale annuelle",
					body: [
						"Madame, Monsieur,",
						"",
						"Vous êtes convoqué à l'assemblée générale ordinaire des copropriétaires qui se tiendra",
						"le 22 septembre 2026 à 18 h 30, salle Jean Moulin.",
						"",
						"L'ordre du jour porte sur l'approbation des comptes, le vote du budget prévisionnel",
						"et le ravalement de la façade est.",
						"",
						"Veuillez agréer, Madame, Monsieur, l'expression de nos salutations distinguées.",
					],
					signature: "Le syndic",
				}),
		},
	];
}

/* ---- Near-duplicates and a failed upload -------------------------- */

/**
 * Documents that make the store look like a real one: the invoice downloaded
 * twice, and the upload that never made it through the pipeline.
 */
function troubleDocuments(): PlannedDocument[] {
	return [
		{
			key: "free-2026-08-duplicate",
			// Same file name, so the derived title matches the first copy: same
			// title and same date is what `possibleDuplicate` looks for.
			filename: "facture_free_2026-08.pdf",
			source: "upload",
			build: () =>
				buildInvoice({
					issuer: letterhead("free"),
					recipient: customer("FR-4482913"),
					number: "202608-4482913",
					issueDate: "2026-08-05",
					dueDate: "2026-08-20",
					periodStart: "2026-08-01",
					periodEnd: "2026-08-31",
					lines: [
						{
							label: "Abonnement Freebox Ultra",
							detail: "Fibre 8 Gbit/s - TV - Téléphonie fixe",
							amount: 41.66,
						},
						{ label: "Option TV by CANAL", amount: 8.33 },
					],
					notes: ["Duplicata téléchargé depuis l'Espace Abonné le 12/09/2026."],
				}),
		},
		{
			key: "ikea-invoice-duplicate",
			filename: "facture_ikea_cuisine.pdf",
			source: "upload",
			categorySlug: "purchase",
			issuerKey: "ikea",
			build: () =>
				buildInvoice({
					issuer: letterhead("ikea"),
					recipient: { name: HOUSEHOLD.owner, address: [...HOUSEHOLD.address] },
					number: "IK-2026-004918",
					issueDate: "2026-01-22",
					paid: true,
					lines: [
						{
							label: "Cuisine METOD",
							detail: "Façades VOXTORP - garantie 25 ans",
							amount: 2415.83,
						},
						{ label: "Plan de travail EKBACKEN", amount: 191.66 },
						{ label: "Montage par un prestataire IKEA", amount: 375 },
					],
					notes: ["Réédition de la facture demandée au service client."],
				}),
		},
		{
			key: "broken-upload",
			filename: "scan_2026-09-02_154412.pdf",
			source: "folder",
			broken: true,
			build: async () =>
				// A PDF header followed by nothing usable: accepted at intake (the
				// magic bytes are real) and rejected by `pdftotext` one step later.
				new TextEncoder().encode(`%PDF-1.7\n%âãÏÓ\n${"0".repeat(512)}\n`),
		},
	];
}

/** Everything the generator ingests, in the order it ingests it. */
export function planDocuments(): PlannedDocument[] {
	return [
		...bellecombePayslips(),
		...nordwindPayslips(),
		...freeInvoices(),
		...edfInvoices(),
		...basicFitInvoices(),
		...harmonieStatements(),
		...oneOffDocuments(),
		...troubleDocuments(),
	];
}

/* ------------------------------------------------------------------ */
/* Dossiers, saved searches, relations                                  */
/* ------------------------------------------------------------------ */

export const DEMO_DOSSIERS: {
	name: string;
	description: string;
	documentKeys: string[];
	closed?: boolean;
	/**
	 * Gets a public share link. Only a dossier without any sensitive document
	 * qualifies: the API refuses to open a link on the others.
	 */
	shared?: boolean;
}[] = [
	{
		name: "Achat maison Villeurbanne",
		description:
			"Everything the bank asked for: identity, bank details, employment contract, payslips and the last tax notice.",
		documentKeys: [
			"id-card",
			"rib-ca",
			"nordwind-contract",
			"payslip-nordwind-2026-06",
			"payslip-nordwind-2026-07",
			"payslip-nordwind-2026-08",
			"impots-avis",
			"boursorama-statement",
		],
	},
	{
		name: "Travaux cuisine 2026",
		description:
			"Kitchen fitting: what proves the purchase and covers the warranty.",
		documentKeys: ["ikea-invoice", "conforama-invoice", "engie-contract"],
		shared: true,
	},
	{
		name: "Impôts 2025",
		description: "Supporting documents of the 2025 income tax return.",
		documentKeys: [
			"impots-avis",
			"urssaf-attestation",
			"harmonie-2025",
			"payslip-nordwind-2025-11",
			"payslip-nordwind-2025-12",
		],
		closed: true,
	},
];

/** Contract to invoice/payslip links, the way the owner would wire them. */
export const DEMO_RELATIONS: {
	fromKey: string;
	toKey: string;
	kind: "version_of" | "page_of" | "supersedes" | "related_to" | "fulfills";
}[] = [
	{
		fromKey: "payslip-nordwind-2026-08",
		toKey: "nordwind-contract",
		kind: "fulfills",
	},
	{
		fromKey: "payslip-nordwind-2026-07",
		toKey: "nordwind-contract",
		kind: "fulfills",
	},
	{
		fromKey: "payslip-bellecombe-2023-06",
		toKey: "bellecombe-contract",
		kind: "fulfills",
	},
	{
		fromKey: "nordwind-contract",
		toKey: "bellecombe-contract",
		kind: "supersedes",
	},
	{ fromKey: "ikea-invoice", toKey: "conforama-invoice", kind: "related_to" },
];
