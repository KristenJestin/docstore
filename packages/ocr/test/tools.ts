import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExternalTools } from "../src/tools";
import { resolveTools } from "../src/tools";

/**
 * Tool paths for the tests: environment variables first, otherwise the default
 * locations of the Windows dev machine when they exist, otherwise resolution
 * through the PATH (Linux / Docker / CI).
 */
const WINDOWS_FALLBACKS = {
	tesseract: "C:\\Program Files\\Tesseract-OCR\\tesseract.exe",
	tessdata: "D:\\Projects\\documents\\.tools\\tessdata",
	poppler: join(
		homedir(),
		"AppData",
		"Local",
		"Microsoft",
		"WinGet",
		"Packages",
		"oschwartz10612.Poppler_Microsoft.Winget.Source_8wekyb3d8bbwe",
		"poppler-25.07.0",
		"Library",
		"bin",
	),
} as const;

function pick(
	envValue: string | undefined,
	fallback: string,
): string | undefined {
	if (envValue && envValue.length > 0) return envValue;
	return existsSync(fallback) ? fallback : undefined;
}

export const testToolOptions: ExternalTools = {
	tesseractPath: pick(process.env.TESSERACT_PATH, WINDOWS_FALLBACKS.tesseract),
	tessdataPrefix: pick(process.env.TESSDATA_PREFIX, WINDOWS_FALLBACKS.tessdata),
	popplerPath: pick(process.env.POPPLER_PATH, WINDOWS_FALLBACKS.poppler),
};

export const testTools = resolveTools(testToolOptions);
