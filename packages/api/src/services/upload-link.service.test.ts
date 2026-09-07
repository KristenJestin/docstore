import { describe, expect, test } from "bun:test";
import { shareLinkUrl } from "./share-link.service";
import { publicBaseUrl, uploadLinkUrl } from "./upload-link.service";

/**
 * Public URLs (SPEC §2 "Misc"): `PUBLIC_URL` wins when set, otherwise
 * `BETTER_AUTH_URL` takes over. Both `shareLink.url` and `uploadLink.url` go
 * through the same `publicBaseUrl()`.
 */

function withEnv(
	values: Record<string, string | undefined>,
	run: () => void,
): void {
	const previous: Record<string, string | undefined> = {};
	for (const key of Object.keys(values)) {
		previous[key] = process.env[key];
	}
	try {
		for (const [key, value] of Object.entries(values)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		run();
	} finally {
		for (const [key, value] of Object.entries(previous)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
}

describe("publicBaseUrl", () => {
	test("PUBLIC_URL takes precedence over BETTER_AUTH_URL", () => {
		withEnv(
			{
				PUBLIC_URL: "https://docs.example.test",
				BETTER_AUTH_URL: "https://internal.example.test",
			},
			() => {
				expect(publicBaseUrl()).toBe("https://docs.example.test");
			},
		);
	});

	test("falls back to BETTER_AUTH_URL when PUBLIC_URL is absent", () => {
		withEnv(
			{
				PUBLIC_URL: undefined,
				BETTER_AUTH_URL: "https://internal.example.test",
			},
			() => {
				expect(publicBaseUrl()).toBe("https://internal.example.test");
			},
		);
	});

	test("strips trailing slashes", () => {
		withEnv(
			{ PUBLIC_URL: "https://docs.example.test/", BETTER_AUTH_URL: undefined },
			() => {
				expect(publicBaseUrl()).toBe("https://docs.example.test");
			},
		);
	});

	test("uploadLinkUrl and shareLinkUrl are both built from PUBLIC_URL", () => {
		withEnv(
			{
				PUBLIC_URL: "https://docs.example.test",
				BETTER_AUTH_URL: "https://internal.example.test",
			},
			() => {
				expect(uploadLinkUrl("tok123")).toBe(
					"https://docs.example.test/u/tok123",
				);
				expect(shareLinkUrl("tok456")).toBe(
					"https://docs.example.test/s/tok456",
				);
			},
		);
	});
});
