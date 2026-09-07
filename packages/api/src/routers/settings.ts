import {
	serverInfoSchema,
	setSettingInput,
	settingsSchema,
} from "@docstore/shared/settings";
import { z } from "zod";
import { protectedProcedure, writeProcedure } from "../index";
import {
	getServerInfo,
	getSettings,
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
		.handler(({ input, context }) => setSetting(context.db, input)),

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
