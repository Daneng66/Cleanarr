import { readFileSync } from "node:fs";
import { join } from "node:path";
import pino from "pino";
import { createArrClient } from "./arr/client.js";
import { createEngine } from "./cleanup/engine.js";
import { createScheduler } from "./cleanup/scheduler.js";
import { loadConfig } from "./config.js";
import { createEncryptor, resolveSecret } from "./crypto.js";
import { openDb } from "./db.js";
import { buildApp } from "./server.js";
import { createStore } from "./store.js";
import { createTautulliProvider } from "./watch/tautulli.js";

const cfg = loadConfig();
const log = pino({ level: cfg.logLevel });
const db = openDb(join(cfg.dataDir, "cleanarr.db"));
const store = createStore(db, createEncryptor(resolveSecret(cfg.dataDir, cfg.secretKey)));
const engine = createEngine({ store, log, arr: (i) => createArrClient(i), watch: (i) => createTautulliProvider(i, db) });

let version = "dev";
try {
	version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
} catch {}

const app = buildApp({ store, db, engine, apiKey: cfg.apiKey, logger: { level: cfg.logLevel }, version });
const scheduler = createScheduler({ store, engine, log });

if (!cfg.apiKey) log.warn("CLEANARR_API_KEY is not set: the UI and API are unauthenticated. Only expose Cleanarr on a trusted network.");
await app.listen({ port: cfg.port, host: cfg.host });
scheduler.start();

for (const sig of ["SIGINT", "SIGTERM"] as const) {
	process.on(sig, async () => {
		scheduler.stop();
		await app.close();
		db.close();
		process.exit(0);
	});
}
