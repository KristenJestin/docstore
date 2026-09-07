import type { ChildProcess } from "node:child_process";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import {
	databaseNameFor,
	loadServerEnv,
	PORTLESS_APP_NAME,
	portlessUrlFor,
	resolveWorkspace,
	storagePathFor,
	withDatabase,
} from "./lib/workspace";

/**
 * One-command development launcher.
 *
 * `bun run dev` brings up the whole stack for **this checkout**: its own
 * database, its own storage folder, a free API port and a stable
 * `https://[<worktree>.]docstore.localhost` URL served by portless.
 *
 * The web dev server proxies every API path to the Hono server
 * (`apps/web/vite.config.ts`), so development runs on a single origin exactly
 * like production behind Caddy: no CORS, no split-port cookie quirks, and
 * `VITE_SERVER_URL=/`.
 *
 * `--no-portless` falls back to plain `http://localhost:3001`, still proxied,
 * for environments where the HTTPS proxy is not wanted.
 */

interface Options {
	portless: boolean;
}

function parseOptions(argv: string[]): Options {
	const options: Options = { portless: true };
	for (const arg of argv) {
		if (arg === "--no-portless") options.portless = false;
		else if (arg === "--portless") options.portless = true;
		else {
			console.error(`[dev] unknown flag "${arg}".`);
			process.exit(1);
		}
	}
	return options;
}

function canBind(port: number, host: string): Promise<boolean> {
	return new Promise((resolve) => {
		const probe = createServer();
		probe.once("error", () => resolve(false));
		probe.once("listening", () => probe.close(() => resolve(true)));
		probe.listen(port, host);
	});
}

/**
 * A port counts as free only when it is free on **both** loopback families.
 *
 * Vite binds `::1` alone while Bun binds `0.0.0.0`, and Windows happily grants
 * the wildcard while a specific address is taken: probing one family alone
 * hands out a port another dev server is already serving on `localhost`, which
 * then resolves to whichever of the two the OS feels like.
 */
async function isPortFree(port: number): Promise<boolean> {
	return (await canBind(port, "127.0.0.1")) && (await canBind(port, "::1"));
}

/**
 * First free port at or after `start`. The main checkout keeps 3000/3001;
 * worktrees (and a second launcher) walk up from there.
 */
async function findFreePort(start: number, span = 100): Promise<number> {
	for (let port = start; port < start + span; port += 1) {
		if (await isPortFree(port)) return port;
	}
	throw new Error(`No free port between ${start} and ${start + span}.`);
}

/** Prefixes every line of a child's output; `onLine` sees the raw text. */
function forwardOutput(
	child: ChildProcess,
	prefix: string,
	onLine?: (line: string) => void,
): void {
	for (const [stream, target] of [
		[child.stdout, process.stdout],
		[child.stderr, process.stderr],
	] as const) {
		if (!stream) continue;
		stream.setEncoding("utf8");
		let pending = "";
		stream.on("data", (chunk: string) => {
			pending += chunk;
			const lines = pending.split(/\r?\n/);
			pending = lines.pop() ?? "";
			for (const line of lines) {
				// An empty prefix leaves the child's own labels alone.
				target.write(prefix ? `${prefix} ${line}\n` : `${line}\n`);
				onLine?.(line);
			}
		});
	}
}

/**
 * Kills the whole child tree. On Windows a `SIGTERM` only reaches the direct
 * child, and portless (or `bun run`) sits between us and the real server.
 */
function killTree(child: ChildProcess | undefined): void {
	if (!child?.pid || child.exitCode !== null) return;
	if (process.platform === "win32") {
		try {
			execFileSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
				stdio: "ignore",
			});
		} catch {
			// Already gone.
		}
		return;
	}
	child.kill("SIGTERM");
}

/** Runs a command to completion, forwarding its output. */
function run(
	command: string,
	args: string[],
	options: { cwd: string; env: NodeJS.ProcessEnv; prefix: string },
): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: options.cwd,
			env: options.env,
			stdio: ["ignore", "pipe", "pipe"],
		});
		forwardOutput(child, options.prefix);
		child.on("error", reject);
		child.on("exit", (code) =>
			code === 0
				? resolve()
				: reject(new Error(`${command} exited with code ${code}.`)),
		);
	});
}

const URL_PATTERN = /https?:\/\/[a-z0-9.-]+\.localhost(?::\d+)?/i;

async function main(): Promise<void> {
	const options = parseOptions(process.argv.slice(2));
	const workspace = resolveWorkspace();
	const serverEnv = loadServerEnv(workspace.root);

	const baseDatabaseUrl = serverEnv.DATABASE_URL;
	if (!baseDatabaseUrl) {
		throw new Error("DATABASE_URL is missing from apps/server/.env.");
	}

	const database = databaseNameFor(workspace);
	const databaseUrl = withDatabase(baseDatabaseUrl, database);
	const storagePath = storagePathFor(workspace, serverEnv.STORAGE_PATH);
	mkdirSync(storagePath, { recursive: true });

	const apiPort = await findFreePort(3000);

	// Database first: the server seeds and starts pg-boss against it, and
	// pg-boss lives in the same database, so the whole queue isolates too.
	console.log(`[dev] preparing database ${database}…`);
	await run(
		"bun",
		["run", join("packages", "db", "src", "dev-db.ts"), "prepare"],
		{
			cwd: workspace.root,
			env: { ...process.env, DATABASE_URL: databaseUrl },
			// `dev-db.ts` labels its own lines `[db]`.
			prefix: "",
		},
	);

	const apiTarget = `http://127.0.0.1:${apiPort}`;
	const webEnv: NodeJS.ProcessEnv = {
		...process.env,
		API_PROXY_TARGET: apiTarget,
		// Single origin: the browser talks to the page's own host and the Vite
		// proxy forwards the API paths.
		VITE_SERVER_URL: "/",
		// The SSR pass runs inside the dev server, which is not a browser: it
		// calls the API directly rather than through its own proxy.
		SERVER_URL: apiTarget,
	};

	let web: ChildProcess;
	let publicUrl: string;

	if (options.portless) {
		// `run --name` rather than the shorter `portless <name> <cmd>`: only the
		// `run` form adds the worktree prefix (`tooling-check.docstore.localhost`),
		// the positional form serves the bare name and two worktrees would then
		// fight over the same hostname. portless assigns the port itself (PORT,
		// 4000–4999) and injects `--port` into the Vite command.
		web = spawn(
			"portless",
			["run", "--name", PORTLESS_APP_NAME, "--", "bun", "run", "dev"],
			{
				cwd: join(workspace.root, "apps", "web"),
				env: webEnv,
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
		web.on("error", (error) => {
			console.error(
				`[dev] cannot run portless (${error.message}). Install it with "npm install -g portless", or use "bun run dev --no-portless".`,
			);
		});
		const expected = portlessUrlFor(workspace);
		publicUrl = await waitForPortlessUrl(web, expected);
		if (publicUrl !== expected) {
			console.log(
				`[dev] portless serves ${publicUrl} (expected ${expected}); using the reported one.`,
			);
		}
	} else {
		// Never the port the API just claimed: it is not listening yet, so a plain
		// `findFreePort(3001)` would happily hand it out twice.
		const webPort = await findFreePort(Math.max(3001, apiPort + 1));
		publicUrl = `http://localhost:${webPort}`;
		web = spawn("bun", ["run", "dev"], {
			cwd: join(workspace.root, "apps", "web"),
			env: { ...webEnv, PORT: String(webPort) },
			stdio: ["ignore", "pipe", "pipe"],
		});
		forwardOutput(web, "[web]");
		web.on("error", (error) => console.error(`[dev] web: ${error.message}`));
	}

	// Run from the repository root so `--hot` watches the workspace packages too
	// (from apps/server it only watches that folder and silently keeps stale
	// copies of packages/*). The .env values are passed explicitly because dotenv
	// only reads ./.env relative to the cwd.
	const api = spawn("bun", ["run", "--hot", "apps/server/src/index.ts"], {
		cwd: workspace.root,
		env: {
			...process.env,
			...serverEnv,
			PORT: String(apiPort),
			DATABASE_URL: databaseUrl,
			STORAGE_PATH: storagePath,
			// Everything the browser sees is the public origin: auth base, allowed
			// origin and the base of the `/u/<token>` and `/s/<token>` pages.
			BETTER_AUTH_URL: publicUrl,
			CORS_ORIGIN: publicUrl,
			PUBLIC_URL: publicUrl,
		},
		stdio: ["ignore", "pipe", "pipe"],
	});
	forwardOutput(api, "[api]");
	api.on("error", (error) => console.error(`[dev] api: ${error.message}`));

	let stopping = false;
	const stop = (code = 0) => {
		if (stopping) return;
		stopping = true;
		console.log("\n[dev] shutting down…");
		killTree(api);
		killTree(web);
		setTimeout(() => process.exit(code), 300);
	};

	for (const child of [api, web]) {
		child.on("exit", (exitCode) => {
			if (!stopping) stop(exitCode ?? 0);
		});
	}
	process.on("SIGINT", () => stop(0));
	process.on("SIGTERM", () => stop(0));

	console.log(
		[
			"",
			"  docstore dev",
			`  app        ${publicUrl}`,
			`  api        ${apiTarget} (proxied under ${publicUrl})`,
			`  health     ${publicUrl}/health`,
			`  worktree   ${workspace.isWorktree ? workspace.name : "main"}`,
			`  database   ${database}`,
			`  storage    ${storagePath}`,
			"",
		].join("\n"),
	);
}

/**
 * Reads the public URL off portless' own output instead of guessing it: it is
 * portless that decides the worktree prefix, and the API needs the exact value
 * for `BETTER_AUTH_URL`. Falls back to the computed one if nothing shows up.
 */
function waitForPortlessUrl(
	child: ChildProcess,
	fallback: string,
): Promise<string> {
	return new Promise((resolve) => {
		let settled = false;
		const done = (url: string) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(url);
		};
		const timer = setTimeout(() => {
			console.log(`[dev] portless did not report a URL; assuming ${fallback}.`);
			done(fallback);
		}, 30_000);
		forwardOutput(child, "[web]", (line) => {
			const match = URL_PATTERN.exec(line);
			if (match) done(match[0]);
		});
		child.on("exit", () => done(fallback));
	});
}

main().catch((error) => {
	console.error(`[dev] ${error instanceof Error ? error.message : error}`);
	process.exit(1);
});
