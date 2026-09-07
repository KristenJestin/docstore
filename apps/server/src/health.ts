import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { IngestionBinding } from "@docstore/ingestion";

/**
 * `GET /health` payload.
 *
 * Beyond the queue, it answers the three questions a deployment actually asks:
 * can the server write files, are the OCR binaries reachable, and is encryption
 * at rest armed. Everything is derived from the ingestion binding — a degraded
 * server (no ingestion) reports `false` everywhere, which is exactly its state.
 */

export interface StorageHealth {
	/** Storage root; `null` when the ingestion pipeline did not start. */
	path: string | null;
	writable: boolean;
}

export interface OcrHealth {
	tesseract: boolean;
	poppler: boolean;
}

export interface HealthReport {
	status: "ok";
	queue: { started: boolean; pending: number | null; worker: number };
	storage: StorageHealth;
	ocr: OcrHealth;
	/** Encryption at rest of sensitive documents (SPEC §8 iteration 7). */
	encryption: boolean;
}

/** Probe file name; removed right after the write. */
const PROBE = ".docstore-health";

/**
 * Really writes a byte rather than calling `access(W_OK)`: on Windows the
 * latter says nothing useful about a directory, and the failure mode we care
 * about (read-only mount, exhausted volume) only shows up on a real write.
 */
export async function checkStorageWritable(path: string): Promise<boolean> {
	const probe = join(path, PROBE);
	try {
		await mkdir(path, { recursive: true });
		await writeFile(probe, "");
		return true;
	} catch {
		return false;
	} finally {
		await rm(probe, { force: true }).catch(() => {});
	}
}

export async function buildHealthReport(
	ingestion: IngestionBinding | undefined,
): Promise<HealthReport> {
	const queue = ingestion?.queue
		? await ingestion.queue.health()
		: { started: false, pending: null };

	const path = ingestion?.ctx.storagePath ?? null;
	const tools = ingestion?.ctx.tools;

	return {
		status: "ok",
		queue: {
			...queue,
			worker: ingestion?.worker ? ingestion.worker.workerIds.length : 0,
		},
		storage: {
			path,
			writable: path === null ? false : await checkStorageWritable(path),
		},
		// `resolveTools` throws when a binary is missing, so a live context proves
		// both families are present.
		ocr: {
			tesseract: Boolean(tools?.tesseract),
			poppler: Boolean(tools?.pdftotext && tools.pdftoppm && tools.pdfinfo),
		},
		encryption: ingestion?.ctx.encryptionEnabled ?? false,
	};
}
