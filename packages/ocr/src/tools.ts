import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Paths of the external binaries. Everything is injected: the package never
 * reads `process.env` (see CLAUDE.md — the paths come from the configuration
 * of the calling application).
 */
export interface ExternalTools {
	/** Path of the `tesseract` executable, or of the directory holding it. */
	tesseractPath?: string;
	/** `tessdata` directory passed to the child through `TESSDATA_PREFIX`. */
	tessdataPrefix?: string;
	/** Directory holding `pdftotext`, `pdftoppm` and `pdfinfo`. */
	popplerPath?: string;
}

/** Verified full paths, ready to be executed. */
export interface ResolvedTools {
	tesseract: string;
	tessdataPrefix?: string;
	pdftotext: string;
	pdftoppm: string;
	pdfinfo: string;
}

/** An external binary is not found, or the provided path is invalid. */
export class MissingToolError extends Error {
	readonly tool: string;
	readonly searched: string[];

	constructor(tool: string, searched: string[]) {
		super(
			`External tool not found: "${tool}". Locations tried: ${
				searched.length > 0 ? searched.join(", ") : "(none)"
			}. Provide an explicit path (tesseractPath / popplerPath) or add the binary to the PATH.`,
		);
		this.name = "MissingToolError";
		this.tool = tool;
		this.searched = searched;
	}
}

/** Execution of an external binary failed (non-zero code, timeout, ...). */
export class ExternalToolError extends Error {
	readonly command: string[];
	readonly exitCode: number | null;
	readonly stderr: string;

	constructor(
		command: string[],
		exitCode: number | null,
		stderr: string,
		reason?: string,
	) {
		super(
			`${command[0]} failed${reason ? ` (${reason})` : ` (code ${exitCode})`}: ${
				stderr.trim().slice(0, 2000) || "(empty stderr)"
			}`,
		);
		this.name = "ExternalToolError";
		this.command = command;
		this.exitCode = exitCode;
		this.stderr = stderr;
	}
}

const IS_WINDOWS = process.platform === "win32";

function withExeSuffix(name: string): string {
	return IS_WINDOWS && !name.toLowerCase().endsWith(".exe")
		? `${name}.exe`
		: name;
}

function isDirectory(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

/**
 * Resolves a binary: explicit path (file or directory), otherwise the PATH.
 * Throws `MissingToolError` when nothing is found.
 */
export function resolveExecutable(name: string, hint?: string): string {
	const searched: string[] = [];

	if (hint && hint.length > 0) {
		const candidates = isDirectory(hint)
			? [join(hint, withExeSuffix(name)), join(hint, name)]
			: [hint, withExeSuffix(hint)];
		for (const candidate of candidates) {
			searched.push(candidate);
			if (existsSync(candidate) && !isDirectory(candidate)) return candidate;
		}
		// An invalid explicit path is never rescued by the PATH: a clear error
		// is better than an unexpected binary.
		throw new MissingToolError(name, searched);
	}

	const fromPath = Bun.which(name);
	searched.push(`PATH (${name})`);
	if (fromPath) return fromPath;

	throw new MissingToolError(name, searched);
}

/**
 * Checks that every required binary is present and returns their full paths.
 */
export function resolveTools(options: ExternalTools = {}): ResolvedTools {
	const { tesseractPath, tessdataPrefix, popplerPath } = options;

	if (tessdataPrefix && !isDirectory(tessdataPrefix)) {
		throw new MissingToolError("tessdata", [tessdataPrefix]);
	}

	return {
		tesseract: resolveExecutable("tesseract", tesseractPath),
		tessdataPrefix,
		pdftotext: resolveExecutable("pdftotext", popplerPath),
		pdftoppm: resolveExecutable("pdftoppm", popplerPath),
		pdfinfo: resolveExecutable("pdfinfo", popplerPath),
	};
}

/** Maximum delay per external binary call. */
export const DEFAULT_TOOL_TIMEOUT_MS = 60_000;

export interface RunToolOptions {
	timeoutMs?: number;
	env?: Record<string, string | undefined>;
	cwd?: string;
}

export interface RunToolResult {
	stdout: Uint8Array;
	stderr: string;
}

/** Runs an external binary with a timeout and captured stderr. */
export async function runTool(
	command: string[],
	options: RunToolOptions = {},
): Promise<RunToolResult> {
	const timeoutMs = options.timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;
	const proc = Bun.spawn(command, {
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
		cwd: options.cwd,
		env: options.env ? { ...process.env, ...options.env } : process.env,
	});

	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		proc.kill();
	}, timeoutMs);

	try {
		const [stdout, stderr, exitCode] = await Promise.all([
			Bun.readableStreamToBytes(proc.stdout),
			Bun.readableStreamToText(proc.stderr),
			proc.exited,
		]);

		if (timedOut) {
			throw new ExternalToolError(
				command,
				exitCode,
				stderr,
				`timed out (${timeoutMs} ms)`,
			);
		}
		if (exitCode !== 0) {
			throw new ExternalToolError(command, exitCode, stderr);
		}
		return { stdout, stderr };
	} finally {
		clearTimeout(timer);
	}
}

/** Same as `runTool` but returns stdout decoded as UTF-8. */
export async function runToolText(
	command: string[],
	options: RunToolOptions = {},
): Promise<string> {
	const { stdout } = await runTool(command, options);
	return new TextDecoder("utf-8").decode(stdout);
}

/** Environment to pass to tesseract (TESSDATA_PREFIX when provided). */
export function tesseractEnv(
	tools: ResolvedTools,
): Record<string, string | undefined> | undefined {
	return tools.tessdataPrefix
		? { TESSDATA_PREFIX: tools.tessdataPrefix }
		: undefined;
}
