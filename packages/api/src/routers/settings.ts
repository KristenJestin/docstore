import { hasScope } from "@docstore/shared/api-key";
import {
	ADMIN_SETTING_KEYS,
	serverInfoSchema,
	setSettingInput,
	settingsSchema,
	signUpStatusSchema,
} from "@docstore/shared/settings";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { protectedProcedure, publicProcedure, writeProcedure } from "../index";
import {
	getServerInfo,
	getSettings,
	getSignUpStatus,
	setSetting,
} from "../services/settings.service";

const TAGS = ["Settings"];

export const settingsRouter = {
	get: protectedProcedure
		.route({
			method: "GET",
			path: "/settings",
			tags: TAGS,
			summary: "Application settings (thresholds of the review queue)",
		})
		.input(z.object({}))
		.output(settingsSchema)
		.handler(({ context }) => getSettings(context.db)),

	set: writeProcedure
		.route({
			method: "PUT",
			path: "/settings",
			tags: TAGS,
			summary: "Update a setting (the value is validated against the key)",
		})
		.input(setSettingInput)
		.output(settingsSchema)
		.handler(({ input, context }) => {
			// Opening sign-up lets someone new into the whole library: a session
			// or an `admin` key only, never a plain `write` key (issue #16).
			if (
				ADMIN_SETTING_KEYS.includes(input.key) &&
				context.apiKey &&
				!hasScope(context.apiKey.scopes, "admin")
			) {
				throw new ORPCError("FORBIDDEN", {
					message: `Changing "${input.key}" requires the "admin" scope.`,
				});
			}
			return setSetting(context.db, input);
		}),

	/**
	 * Public on purpose: the sign-up page is shown signed out and has to say
	 * whether an account can be created. It only answers open or closed, and
	 * the server enforces it on the sign-up endpoint itself.
	 */
	signUpStatus: publicProcedure
		.route({
			method: "GET",
			path: "/settings/sign-up-status",
			tags: TAGS,
			summary: "Whether the sign-up page may create an account",
		})
		.input(z.object({}))
		.output(signUpStatusSchema)
		.handler(({ context }) => getSignUpStatus(context.db)),

	serverInfo: protectedProcedure
		.route({
			method: "GET",
			path: "/settings/server-info",
			tags: TAGS,
			summary: "Origins, version and server configuration file",
		})
		.input(z.object({}))
		.output(serverInfoSchema)
		.handler(({ context }) => getServerInfo(context.db)),
};
