/**
 * Mailbox client abstraction (SPEC §5, mailbox intake source).
 *
 * The pipeline only knows this interface: the real IMAP implementation lives in
 * `mail-imap.ts`, and the tests inject an in-memory fake. No dependency on
 * `imapflow` is visible from here.
 */

/** Connection parameters, password already decrypted. */
export interface MailConnection {
	host: string;
	port: number;
	secure: boolean;
	username: string;
	password: string;
	mailbox: string;
}

export interface MailAttachment {
	filename: string;
	/** Type declared by the message; always re-checked against the bytes. */
	mime: string;
	content: Uint8Array;
}

export interface MailMessage {
	/** IMAP identifier in the current mailbox. */
	uid: number;
	/** `Message-ID` of the message, used as `document.source_ref`. */
	messageId: string;
	from: string;
	subject: string;
	receivedAt: Date;
	attachments: MailAttachment[];
}

/** Selection criteria applied server-side then refined in memory. */
export interface MailSearchOptions {
	onlyUnseen: boolean;
	/** Case-insensitive substring on the sender. */
	from?: string;
	/** Regular expression tested against the subject. */
	subjectPattern?: string;
	/** Cap on the messages processed in one run. */
	limit?: number;
}

export interface MailClient {
	/** Opens the connection and selects the mailbox. */
	connect(): Promise<void>;
	/** Number of candidate messages, without downloading the attachments. */
	count(options: MailSearchOptions): Promise<number>;
	/** Candidate messages, attachments included. */
	search(options: MailSearchOptions): Promise<MailMessage[]>;
	markSeen(uid: number): Promise<void>;
	move(uid: number, mailbox: string): Promise<void>;
	delete(uid: number): Promise<void>;
	close(): Promise<void>;
}

export type MailClientFactory = (connection: MailConnection) => MailClient;

/** IMAP connection or authentication error. */
export class MailConnectionError extends Error {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = "MailConnectionError";
	}
}

/** Maximum number of messages processed per run. */
export const MAIL_FETCH_LIMIT = 50;

/** In-memory filter shared by every implementation. */
export function matchesMailFilters(
	message: Pick<MailMessage, "from" | "subject">,
	options: MailSearchOptions,
): boolean {
	if (
		options.from &&
		!message.from.toLowerCase().includes(options.from.toLowerCase())
	) {
		return false;
	}
	if (options.subjectPattern) {
		try {
			if (!new RegExp(options.subjectPattern, "i").test(message.subject)) {
				return false;
			}
		} catch {
			// Invalid pattern: we do not filter rather than rejecting everything.
			return true;
		}
	}
	return true;
}
