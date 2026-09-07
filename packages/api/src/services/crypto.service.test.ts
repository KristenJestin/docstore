import { describe, expect, test } from "bun:test";
import {
	APP_SECRET_MIN_LENGTH,
	appSecret,
	DecryptionError,
	decryptSecret,
	encryptSecret,
	isEncryptedSecret,
	MissingAppSecretError,
} from "./crypto.service";

const KEY = "test-key-long-enough-0123456789abcdef";
const OTHER_KEY = "another-key-just-as-long-9876543210fedcba";

describe("crypto.service", () => {
	test("encrypts and decrypts a string", () => {
		const encrypted = encryptSecret("imap-password", KEY);
		expect(encrypted).not.toContain("imap-password");
		expect(isEncryptedSecret(encrypted)).toBe(true);
		expect(decryptSecret(encrypted, KEY)).toBe("imap-password");
	});

	test("two ciphertexts of the same text differ (random iv)", () => {
		const first = encryptSecret("secret", KEY);
		const second = encryptSecret("secret", KEY);
		expect(first).not.toBe(second);
		expect(decryptSecret(second, KEY)).toBe("secret");
	});

	test("rejects a wrong key", () => {
		const encrypted = encryptSecret("secret", KEY);
		expect(() => decryptSecret(encrypted, OTHER_KEY)).toThrow(DecryptionError);
	});

	test("rejects tampered content", () => {
		const encrypted = encryptSecret("secret", KEY);
		const tampered = `${encrypted.slice(0, -2)}ZZ`;
		expect(() => decryptSecret(tampered, KEY)).toThrow(DecryptionError);
	});

	test("rejects an unknown format", () => {
		expect(() => decryptSecret("not-a-secret", KEY)).toThrow(DecryptionError);
		expect(isEncryptedSecret("not-a-secret")).toBe(false);
	});

	test("preserves non-ASCII characters", () => {
		// Accented characters are the point of this fixture, not stray French.
		const value = "password-àéî-🔐";
		expect(decryptSecret(encryptSecret(value, KEY), KEY)).toBe(value);
	});

	test("appSecret rejects a missing or too short key", () => {
		const previous = process.env.APP_SECRET;
		try {
			process.env.APP_SECRET = "";
			expect(() => appSecret()).toThrow(MissingAppSecretError);
			process.env.APP_SECRET = "x".repeat(APP_SECRET_MIN_LENGTH - 1);
			expect(() => appSecret()).toThrow(MissingAppSecretError);
			process.env.APP_SECRET = "x".repeat(APP_SECRET_MIN_LENGTH);
			expect(appSecret()).toHaveLength(APP_SECRET_MIN_LENGTH);
		} finally {
			if (previous === undefined) delete process.env.APP_SECRET;
			else process.env.APP_SECRET = previous;
		}
	});
});
