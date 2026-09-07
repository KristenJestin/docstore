import type { RouterClient } from "@orpc/server";

import { protectedProcedure, publicProcedure } from "../index";
import { apiKeyRouter } from "./api-key";
import { categoryRouter } from "./category";
import { customFieldRouter } from "./custom-field";
import { documentRouter } from "./document";
import { documentTypeRouter } from "./document-type";
import { dossierRouter } from "./dossier";
import { exportRouter } from "./export";
import { extractionRuleRouter } from "./extraction-rule";
import { fileRouter } from "./file";
import { intakeSourceRouter } from "./intake-source";
import { partyRouter } from "./party";
import { reminderRouter } from "./reminder";
import { reviewRouter } from "./review";
import { ruleRouter } from "./rule";
import { savedSearchRouter } from "./saved-search";
import { settingsRouter } from "./settings";
import { shareLinkRouter } from "./share-link";
import { tagRouter } from "./tag";
import { uploadLinkRouter } from "./upload-link";
import { webhookRouter } from "./webhook";

export const appRouter = {
	healthCheck: publicProcedure.handler(() => {
		return "OK";
	}),
	privateData: protectedProcedure.handler(({ context }) => {
		return {
			message: "This is private",
			user: context.session?.user,
		};
	}),
	party: partyRouter,
	document: documentRouter,
	file: fileRouter,
	category: categoryRouter,
	tag: tagRouter,
	customField: customFieldRouter,
	rule: ruleRouter,
	extractionRule: extractionRuleRouter,
	review: reviewRouter,
	documentType: documentTypeRouter,
	dossier: dossierRouter,
	savedSearch: savedSearchRouter,
	reminder: reminderRouter,
	settings: settingsRouter,
	apiKey: apiKeyRouter,
	intakeSource: intakeSourceRouter,
	export: exportRouter,
	shareLink: shareLinkRouter,
	uploadLink: uploadLinkRouter,
	webhook: webhookRouter,
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
