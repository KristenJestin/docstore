import type { ImapFlow, MailboxLockObject } from "imapflow";
import type {
	MailAttachment,
	MailClient,
	MailConnection,
	MailMessage,
	MailSearchOptions,
} from "./mail";
import {
	MAIL_FETCH_LIMIT,
	MailConnectionError,
	matchesMailFilters,
} from "./mail";

/**
 * IMAP implementation of `MailClient`, on top of `imapflow` + `mailparser`.
 *
 * `imapflow` and `mailparser` are loaded lazily: the ingestion tests never have
 * to instantiate them, and a server without any mail source does not pay their
 * startup cost.
 */

async function loadImapFlow(): Promise<typeof import("imapflow").ImapFlow> {
	const module = await import("imapflow");
	return module.ImapFlow;
}

async function parseAttachments(source: Buffer): Promise<MailAttachment[]> {
	const { simpleParser } = await import("mailparser");
	const parsed = await simpleParser(source);
	return parsed.attachments
		.filter((attachment) => attachment.content)
		.map((attachment, index) => ({
			filename: attachment.filename ?? `attachment-${index + 1}`,
			mime: attachment.contentType ?? "application/octet-stream",
			content: new Uint8Array(attachment.content),
		}));
}

function envelopeFrom(envelope: {
	from?: { name?: string; address?: string }[];
}): string {
	const first = envelope.from?.[0];
	if (!first) return "";
	return first.address ?? first.name ?? "";
}

class ImapMailClient implements MailClient {
	private client: ImapFlow | null = null;
	private lock: MailboxLockObject | null = null;

	constructor(private readonly connection: MailConnection) {}

	async connect(): Promise<void> {
		const ImapFlowCtor = await loadImapFlow();
		const client = new ImapFlowCtor({
			host: this.connection.host,
			port: this.connection.port,
			secure: this.connection.secure,
			auth: {
				user: this.connection.username,
				pass: this.connection.password,
			},
			// The imapflow log is verbose and contains the credentials.
			logger: false,
		});
		try {
			await client.connect();
			this.lock = await client.getMailboxLock(this.connection.mailbox);
		} catch (error) {
			await client.logout().catch(() => {});
			throw new MailConnectionError(
				`Unable to connect to IMAP on ${this.connection.host}:${this.connection.port} — ${
					error instanceof Error ? error.message : String(error)
				}`,
				{ cause: error },
			);
		}
		this.client = client;
	}

	private require(): ImapFlow {
		if (!this.client) {
			throw new MailConnectionError("IMAP client not connected.");
		}
		return this.client;
	}

	/** Candidate uids, filtered on the sender and the subject. */
	private async candidates(options: MailSearchOptions): Promise<number[]> {
		const client = this.require();
		const found = await client.search(
			options.onlyUnseen ? { seen: false } : { all: true },
			{ uid: true },
		);
		const uids = Array.isArray(found) ? found : [];
		if (uids.length === 0) return [];
		if (!options.from && !options.subjectPattern) {
			return uids.slice(0, options.limit ?? MAIL_FETCH_LIMIT);
		}

		const kept: number[] = [];
		for await (const message of client.fetch(
			{ uid: uids.join(",") },
			{ uid: true, envelope: true },
			{ uid: true },
		)) {
			const envelope = message.envelope;
			if (!envelope) continue;
			if (
				matchesMailFilters(
					{ from: envelopeFrom(envelope), subject: envelope.subject ?? "" },
					options,
				)
			) {
				kept.push(message.uid);
			}
		}
		return kept.slice(0, options.limit ?? MAIL_FETCH_LIMIT);
	}

	async count(options: MailSearchOptions): Promise<number> {
		return (await this.candidates(options)).length;
	}

	async search(options: MailSearchOptions): Promise<MailMessage[]> {
		const client = this.require();
		const uids = await this.candidates(options);
		const messages: MailMessage[] = [];

		for (const uid of uids) {
			const fetched = await client.fetchOne(
				String(uid),
				{ uid: true, envelope: true, source: true },
				{ uid: true },
			);
			// `fetchOne` returns `false` when the message has disappeared meanwhile.
			if (fetched === false) continue;
			if (!fetched.source) continue;
			const envelope = fetched.envelope;
			messages.push({
				uid,
				messageId: envelope?.messageId ?? `uid:${uid}`,
				from: envelope ? envelopeFrom(envelope) : "",
				subject: envelope?.subject ?? "",
				receivedAt: envelope?.date ?? new Date(),
				attachments: await parseAttachments(fetched.source),
			});
		}

		return messages;
	}

	async markSeen(uid: number): Promise<void> {
		await this.require().messageFlagsAdd({ uid: String(uid) }, ["\\Seen"], {
			uid: true,
		});
	}

	async move(uid: number, mailbox: string): Promise<void> {
		await this.require().messageMove({ uid: String(uid) }, mailbox, {
			uid: true,
		});
	}

	async delete(uid: number): Promise<void> {
		await this.require().messageDelete({ uid: String(uid) }, { uid: true });
	}

	async close(): Promise<void> {
		this.lock?.release();
		this.lock = null;
		const client = this.client;
		this.client = null;
		await client?.logout().catch(() => {});
	}
}

/** Default factory of `IngestionContext.createMailClient`. */
export function createImapClient(connection: MailConnection): MailClient {
	return new ImapMailClient(connection);
}
