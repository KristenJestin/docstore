// biome-ignore-all lint/suspicious/noTemplateCurlyInString: `${VAR}` is the placeholder syntax of the configuration file, written literally on purpose.
import { describe, expect, test } from "bun:test";
import {
	INBOX_MANAGED_KEY,
	MissingConfigVariableError,
	resolveConfigPlaceholders,
	serverConfigSchema,
	withInboxShortcut,
} from "./server-config";

/**
 * Server configuration file (`DOCSTORE_CONFIG`): placeholders, validation and
 * the `INBOX_PATH` shortcut. Everything here is pure — reading the file and
 * writing the rows lives in `@docstore/api`.
 */

const folderSource = {
	key: "inbox",
	name: "Server inbox",
	type: "folder",
	config: { path: "/data/inbox", recursive: true, afterImport: "keep" },
};

describe("resolveConfigPlaceholders", () => {
	const env = { MAIL_PASSWORD: "s3cret", INBOX: "/data/inbox" };

	test("replaces `${VAR}` anywhere in the tree", () => {
		const resolved = resolveConfigPlaceholders(
			{
				intakeSources: [
					{ config: { password: "${MAIL_PASSWORD}", port: 993 } },
					{ config: { path: "${INBOX}/scanner" } },
				],
			},
			env,
		);
		expect(resolved).toEqual({
			intakeSources: [
				{ config: { password: "s3cret", port: 993 } },
				{ config: { path: "/data/inbox/scanner" } },
			],
		});
	});

	test("leaves booleans, numbers and nulls alone", () => {
		expect(
			resolveConfigPlaceholders({ a: 1, b: true, c: null, d: "plain" }, env),
		).toEqual({ a: 1, b: true, c: null, d: "plain" });
	});

	test("a missing variable throws, naming the key and its path", () => {
		let caught: unknown;
		try {
			resolveConfigPlaceholders(
				{ intakeSources: [{ config: { password: "${NOPE}" } }] },
				env,
			);
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(MissingConfigVariableError);
		const error = caught as MissingConfigVariableError;
		expect(error.variable).toBe("NOPE");
		expect(error.message).toContain("NOPE");
		expect(error.message).toContain("intakeSources[0].config.password");
	});

	test("an empty variable counts as missing", () => {
		expect(() =>
			resolveConfigPlaceholders({ password: "${EMPTY}" }, { EMPTY: "" }),
		).toThrow(MissingConfigVariableError);
	});
});

describe("serverConfigSchema", () => {
	test("an empty object is a valid configuration", () => {
		const parsed = serverConfigSchema.parse({});
		expect(parsed.intakeSources).toEqual([]);
	});

	test("folds the top-level type into the config and applies the defaults", () => {
		const parsed = serverConfigSchema.parse({ intakeSources: [folderSource] });
		const source = parsed.intakeSources[0];
		expect(source?.enabled).toBe(true);
		expect(source?.defaults).toEqual({});
		expect(source?.config).toMatchObject({
			type: "folder",
			path: "/data/inbox",
			recursive: true,
			pollSeconds: 30,
			afterImport: "keep",
		});
	});

	test("the name falls back to the key", () => {
		const parsed = serverConfigSchema.parse({
			intakeSources: [{ ...folderSource, name: undefined }],
		});
		expect(parsed.intakeSources[0]?.name).toBe("inbox");
	});

	test("keeps the mailbox password in plaintext (encrypted on write)", () => {
		const parsed = serverConfigSchema.parse({
			intakeSources: [
				{
					key: "billing-mail",
					type: "mail",
					config: {
						host: "imap.example.test",
						username: "billing@example.test",
						password: "s3cret",
					},
				},
			],
		});
		expect(parsed.intakeSources[0]?.config).toMatchObject({
			type: "mail",
			port: 993,
			mailbox: "INBOX",
			password: "s3cret",
		});
	});

	test("reports a config error under the `config` path", () => {
		const result = serverConfigSchema.safeParse({
			intakeSources: [
				{
					key: "inbox",
					type: "folder",
					config: { path: "/data/inbox", afterImport: "move" },
				},
			],
		});
		expect(result.success).toBe(false);
		const paths = result.error?.issues.map((issue) => issue.path.join("."));
		expect(paths).toContain("intakeSources.0.config.moveTo");
	});

	test("rejects two sources sharing a key", () => {
		const result = serverConfigSchema.safeParse({
			intakeSources: [folderSource, { ...folderSource, name: "Twin" }],
		});
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.message).toContain("Duplicate");
	});

	test("rejects an unusable key", () => {
		expect(
			serverConfigSchema.safeParse({
				intakeSources: [{ ...folderSource, key: "not a key" }],
			}).success,
		).toBe(false);
	});
});

describe("withInboxShortcut", () => {
	const empty = { intakeSources: [] };

	test("synthesizes a managed folder source moving into `imported`", () => {
		const config = withInboxShortcut(empty, "/data/inbox");
		const source = config.intakeSources[0];
		expect(source?.key).toBe(INBOX_MANAGED_KEY);
		expect(source?.config).toMatchObject({
			type: "folder",
			path: "/data/inbox",
			recursive: true,
			afterImport: "move",
			moveTo: "/data/inbox/imported",
		});
	});

	test("does nothing without INBOX_PATH", () => {
		expect(withInboxShortcut(empty, undefined)).toBe(empty);
	});

	test("stands back when the file already watches that folder", () => {
		const declared = serverConfigSchema.parse({
			intakeSources: [
				{ key: "scanner", type: "folder", config: { path: "/data/inbox/" } },
			],
		});
		expect(withInboxShortcut(declared, "/data/inbox")).toBe(declared);
	});

	test("stands back when the `inbox` key is already taken", () => {
		const declared = serverConfigSchema.parse({
			intakeSources: [
				{ key: "inbox", type: "folder", config: { path: "/srv/other" } },
			],
		});
		expect(withInboxShortcut(declared, "/data/inbox")).toBe(declared);
	});
});
