import {
	createCipheriv,
	createDecipheriv,
	randomBytes,
	scryptSync,
} from "node:crypto";

/**
 * Symmetric encryption of stored secrets (IMAP passwords in iteration 6,
 * Sensitive documents in iteration 7).
 *
 * AES-256-GCM, key derived from `APP_SECRET` with scrypt. The format is
 * `v1.<iv>.<tag>.<ciphertext>` in base64url: the leading version leaves the
 * door open to an algorithm rotation without guessing the shape of the field.
 *
 * The key is never read when the module loads: `APP_SECRET` is only needed
 * when a secret is actually encrypted or decrypted, which lets unit tests pass
 * their own key.
 */

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
/** Fixed salt: the key must be reproducible from one start to the next. */
const SALT = "docstore.secret.v1";

/** Minimum length of `APP_SECRET`, aligned with `@docstore/env`. */
export const APP_SECRET_MIN_LENGTH = 32;

export class MissingAppSecretError extends Error {
	constructor() {
		super(
			`APP_SECRET is missing or too short (${APP_SECRET_MIN_LENGTH} characters minimum): stored secrets cannot be encrypted.`,
		);
		this.name = "MissingAppSecretError";
	}
}

export class DecryptionError extends Error {
	constructor(reason: string) {
		super(`Decryption failed: ${reason}.`);
		this.name = "DecryptionError";
	}
}

/** Current application secret, read lazily. */
export function appSecret(): string {
	const value = process.env.APP_SECRET;
	if (!value || value.length < APP_SECRET_MIN_LENGTH) {
		throw new MissingAppSecretError();
	}
	return value;
}

const keyCache = new Map<string, Buffer>();

/** AES-256 key derived from the secret (cached: scrypt is slow on purpose). */
export function deriveKey(secret: string): Buffer {
	const cached = keyCache.get(secret);
	if (cached) return cached;
	const key = scryptSync(secret, SALT, KEY_LENGTH);
	keyCache.set(secret, key);
	return key;
}

/** Encrypts a string. The result can be stored as-is in the database. */
export function encryptSecret(
	plaintext: string,
	secret: string = appSecret(),
): string {
	const iv = randomBytes(IV_LENGTH);
	const cipher = createCipheriv(ALGORITHM, deriveKey(secret), iv);
	const encrypted = Buffer.concat([
		cipher.update(plaintext, "utf8"),
		cipher.final(),
	]);
	return [
		VERSION,
		iv.toString("base64url"),
		cipher.getAuthTag().toString("base64url"),
		encrypted.toString("base64url"),
	].join(".");
}

/**
 * Decrypts a string produced by `encryptSecret`.
 *
 * Throws `DecryptionError` if the format is invalid or if the key does not
 * match (the GCM tag guarantees authenticity: a wrong key fails, it never
 * returns a plausible value).
 */
export function decryptSecret(
	payload: string,
	secret: string = appSecret(),
): string {
	const parts = payload.split(".");
	if (parts.length !== 4 || parts[0] !== VERSION) {
		throw new DecryptionError("unexpected format");
	}
	const [, ivPart, tagPart, dataPart] = parts as [
		string,
		string,
		string,
		string,
	];
	try {
		const decipher = createDecipheriv(
			ALGORITHM,
			deriveKey(secret),
			Buffer.from(ivPart, "base64url"),
		);
		decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
		return Buffer.concat([
			decipher.update(Buffer.from(dataPart, "base64url")),
			decipher.final(),
		]).toString("utf8");
	} catch {
		throw new DecryptionError("wrong key or tampered content");
	}
}

/** True if the value has the shape of a secret encrypted by this module. */
export function isEncryptedSecret(value: string): boolean {
	return value.startsWith(`${VERSION}.`) && value.split(".").length === 4;
}
