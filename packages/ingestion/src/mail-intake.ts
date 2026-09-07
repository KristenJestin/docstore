import type { IntakeSourceRow } from "@docstore/db/schema/intake";
import type { MailConfig } from "@docstore/shared/intake";
import type { IngestionContext } from "./context";
import { DuplicateOriginalError, UnsupportedMediaError } from "./errors";
import { intakeFile, isDuplicate } from "./intake";
import type { IntakeRunResult } from "./intake-log";
import { emptyRunResult, logIntake } from "./intake-log";
import type {
	MailClient,
	MailConnection,
	MailMessage,
	MailSearchOptions,
} from "./mail";
import { MAIL_FETCH_LIMIT, MailConnectionError } from "./mail";
import { MAGIC_BYTES_LENGTH, resolveIntakeMime } from "./media";

/**
 * IMAP mailbox (SPEC §5, mailbox intake source).
 *
 * The client is injected (`IngestionContext.createMailClient`): the tests use an
 * in-memory fake, production uses `imapflow`. An authentication error bubbles up
 * as is to feed `lastError`, without preventing the other sources from running.
 */

/** `YYYY-MM-DD` of a date, for `document.received_at`. */
function isoDate(date: Date): string {
	return date.toISOString().slice(0, 10);
}

/** Connection parameters, with the password decrypted along the way. */
export function mailConnection(
	ctx: IngestionContext,
	config: MailConfig,
	/** Plain-text password (draft of `intakeSource.test`). */
	password?: string,
): MailConnection {
	let secret = password;
	if (!secret) {
		if (!config.passwordEncrypted) {
			throw new MailConnectionError("No password stored for this mailbox.");
		}
		if (!ctx.decryptSecret) {
			throw new MailConnectionError(
				"Decryption unavailable: APP_SECRET is not configured on this server.",
			);
		}
		secret = ctx.decryptSecret(config.passwordEncrypted);
	}
	return {
		host: config.host,
		port: config.port,
		secure: config.secure,
		username: config.username,
		password: secret,
		mailbox: config.mailbox,
	};
}

export function mailSearchOptions(config: MailConfig): MailSearchOptions {
	return {
		onlyUnseen: config.onlyUnseen,
		...(config.from ? { from: config.from } : {}),
		...(config.subjectPattern ? { subjectPattern: config.subjectPattern } : {}),
		limit: MAIL_FETCH_LIMIT,
	};
}

/** Opens a client, runs `fn`, closes whatever happens. */
async function withClient<T>(
	ctx: IngestionContext,
	config: MailConfig,
	fn: (client: MailClient) => Promise<T>,
	password?: string,
): Promise<T> {
	if (!ctx.createMailClient) {
		throw new MailConnectionError(
			"No IMAP client available in this ingestion context.",
		);
	}
	const client = ctx.createMailClient(mailConnection(ctx, config, password));
	await client.connect();
	try {
		return await fn(client);
	} finally {
		await client.close().catch(() => {});
	}
}

/** Applies `afterImport` to a processed message. */
export async function applyMailAfterImport(
	client: MailClient,
	config: MailConfig,
	uid: number,
): Promise<void> {
	switch (config.afterImport) {
		case "delete":
			await client.delete(uid);
			return;
		case "move":
			if (config.moveTo) await client.move(uid, config.moveTo);
			return;
		default:
			await client.markSeen(uid);
	}
}

/** Attachments that can actually be ingested (pdf and images). */
function importableAttachments(message: MailMessage): {
	filename: string;
	mime: string;
	content: Uint8Array;
}[] {
	const kept: { filename: string; mime: string; content: Uint8Array }[] = [];
	for (const attachment of message.attachments) {
		try {
			const mime = resolveIntakeMime(
				attachment.content.subarray(0, MAGIC_BYTES_LENGTH),
				attachment.filename,
				attachment.mime,
			);
			kept.push({
				filename: attachment.filename,
				mime,
				content: attachment.content,
			});
		} catch (error) {
			if (!(error instanceof UnsupportedMediaError)) throw error;
		}
	}
	return kept;
}

export interface MailTestResult {
	ok: boolean;
	candidates: number;
	message: string;
}

/** `intakeSource.test` for a mailbox: connection + candidate messages. */
export async function testMailConfig(
	ctx: IngestionContext,
	config: MailConfig,
	password?: string,
): Promise<MailTestResult> {
	try {
		const candidates = await withClient(
			ctx,
			config,
			(client) => client.count(mailSearchOptions(config)),
			password,
		);
		return {
			ok: true,
			candidates,
			message: `Connection successful: ${candidates} candidate message(s) in "${config.mailbox}".`,
		};
	} catch (error) {
		return {
			ok: false,
			candidates: 0,
			message: error instanceof Error ? error.message : String(error),
		};
	}
}

/**
 * Polls a mailbox: one attachment = one document, the subject and the sender
 * are kept in `document.intake_meta` so that `buildSubject` hands them to the
 * rule engine (`mail.from`, `mail.subject`).
 */
export async function runMailSource(
	ctx: IngestionContext,
	source: IntakeSourceRow,
	config: MailConfig,
	createdById: string,
): Promise<IntakeRunResult> {
	const result = emptyRunResult();

	await withClient(ctx, config, async (client) => {
		const messages = await client.search(mailSearchOptions(config));

		for (const message of messages) {
			const label = message.subject || message.messageId;
			const attachments = importableAttachments(message);

			if (attachments.length === 0) {
				result.skipped += 1;
				await logIntake(ctx.db, {
					sourceId: source.id,
					filename: label,
					outcome: "skipped",
					message: config.attachmentsOnly
						? "No usable attachment (PDF or image)."
						: "No attachment; importing the body is not supported.",
				});
				await applyMailAfterImport(client, config, message.uid);
				continue;
			}

			for (const attachment of attachments) {
				try {
					const outcome = await intakeFile(ctx, {
						data: attachment.content,
						filename: attachment.filename,
						mime: attachment.mime,
						createdById,
						title: attachment.filename,
						source: "mail",
						sourceRef: message.messageId,
						receivedAt: isoDate(message.receivedAt),
						intakeMeta: {
							mail: {
								from: message.from,
								subject: message.subject,
								receivedAt: message.receivedAt.toISOString(),
							},
						},
						defaults: source.defaults,
					});

					if (isDuplicate(outcome)) {
						result.duplicates += 1;
						await logIntake(ctx.db, {
							sourceId: source.id,
							filename: attachment.filename,
							outcome: "duplicate",
							documentId: outcome.duplicateOf,
							message: `Content already present (document ${outcome.duplicateOf}).`,
						});
					} else {
						result.imported += 1;
						await logIntake(ctx.db, {
							sourceId: source.id,
							filename: attachment.filename,
							outcome: "imported",
							documentId: outcome.documentId,
						});
					}
				} catch (error) {
					const duplicate = error instanceof DuplicateOriginalError;
					if (duplicate) result.duplicates += 1;
					else result.errors += 1;
					await logIntake(ctx.db, {
						sourceId: source.id,
						filename: attachment.filename,
						outcome: duplicate ? "duplicate" : "error",
						message: error instanceof Error ? error.message : String(error),
					});
				}
			}

			await applyMailAfterImport(client, config, message.uid);
		}
	});

	return result;
}
