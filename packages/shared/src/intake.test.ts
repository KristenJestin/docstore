import { describe, expect, test } from "bun:test";
import {
	effectivePollSeconds,
	folderConfigSchema,
	intakeSourceConfigInputSchema,
	isDue,
	mailConfigInputSchema,
	toPublicConfig,
} from "./intake";

describe("effectivePollSeconds", () => {
	test("rounds up to the next minute, with a one-minute floor", () => {
		expect(effectivePollSeconds(5)).toBe(60);
		expect(effectivePollSeconds(30)).toBe(60);
		expect(effectivePollSeconds(60)).toBe(60);
		expect(effectivePollSeconds(61)).toBe(120);
		expect(effectivePollSeconds(300)).toBe(300);
	});
});

describe("isDue", () => {
	const now = new Date("2026-03-04T12:00:00.000Z");

	test("a source that has never been polled is due", () => {
		expect(isDue(null, 300, now)).toBe(true);
	});

	test("waits for the effective interval", () => {
		const twoMinutesAgo = new Date(now.getTime() - 120_000);
		expect(isDue(twoMinutesAgo, 300, now)).toBe(false);
		expect(isDue(twoMinutesAgo, 60, now)).toBe(true);
	});

	test("tolerates a little lag so that a minute is not skipped", () => {
		// 59 s after the last poll of a source set to 60 s.
		const almost = new Date(now.getTime() - 59_000);
		expect(isDue(almost, 60, now)).toBe(true);
	});
});

describe("toPublicConfig", () => {
	test("replaces the encrypted password with `hasPassword`", () => {
		const publicConfig = toPublicConfig({
			type: "mail",
			host: "imap.example.test",
			port: 993,
			secure: true,
			username: "camille",
			passwordEncrypted: "v1.aaa.bbb.ccc",
			mailbox: "INBOX",
			pollSeconds: 300,
			onlyUnseen: true,
			afterImport: "mark_seen",
			attachmentsOnly: true,
			importBodyAsPdf: false,
		});
		expect(publicConfig).toMatchObject({ type: "mail", hasPassword: true });
		expect(JSON.stringify(publicConfig)).not.toContain("v1.aaa");
	});

	test("leaves a folder configuration as is", () => {
		const folder = folderConfigSchema.parse({
			type: "folder",
			path: "/data/inbox",
		});
		expect(toPublicConfig(folder)).toEqual(folder);
	});
});

describe("validation", () => {
	test("applies the folder default values", () => {
		const parsed = folderConfigSchema.parse({
			type: "folder",
			path: "/data/inbox",
		});
		expect(parsed).toMatchObject({
			recursive: false,
			pollSeconds: 30,
			afterImport: "keep",
		});
	});

	test("`move` requires a destination", () => {
		const result = folderConfigSchema.safeParse({
			type: "folder",
			path: "/data/inbox",
			afterImport: "move",
		});
		expect(result.success).toBe(false);
	});

	test("applies the mailbox default values", () => {
		const parsed = mailConfigInputSchema.parse({
			type: "mail",
			host: "imap.gmail.com",
			username: "me@gmail.com",
			password: "abcd efgh ijkl mnop",
		});
		expect(parsed).toMatchObject({
			port: 993,
			secure: true,
			mailbox: "INBOX",
			pollSeconds: 300,
			onlyUnseen: true,
			afterImport: "mark_seen",
			attachmentsOnly: true,
			importBodyAsPdf: false,
		});
	});

	test("rejects `importBodyAsPdf: true` (out of scope for v1)", () => {
		const result = mailConfigInputSchema.safeParse({
			type: "mail",
			host: "imap.gmail.com",
			username: "me@gmail.com",
			importBodyAsPdf: true,
		});
		expect(result.success).toBe(false);
	});

	test("the union discriminates on `type`", () => {
		const folder = intakeSourceConfigInputSchema.parse({
			type: "folder",
			path: "/data/inbox",
		});
		expect(folder.type).toBe("folder");

		const mail = intakeSourceConfigInputSchema.parse({
			type: "mail",
			host: "imap.example.test",
			username: "camille",
		});
		expect(mail.type).toBe("mail");
	});
});
