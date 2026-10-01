import { createArrClient } from "./arr/client.js";
import type { Db } from "./db.js";
import { createSeerrProvider, testSeerr } from "./seerr/seerr.js";
import type { Instance } from "./types.js";
import { createWatchProvider, testPlex } from "./watch/index.js";

/** Production wiring from stored instances to their service clients. */
export function createProviders(db: Db) {
	return {
		arr: (i: Instance) => createArrClient(i),
		watch: (i: Instance) => createWatchProvider(i),
		seerr: (i: Instance) => createSeerrProvider(i),
	};
}

/** Connectivity check used by the "Test connection" button. Never echoes the API key. */
export async function testConnection(i: Pick<Instance, "type" | "url" | "apiKey">): Promise<{ ok: true } | { ok: false; error: string }> {
	try {
		if (i.type === "sonarr" || i.type === "radarr") await createArrClient(i).status();
		else if (i.type === "plex") await testPlex(i);
		else await testSeerr(i);
		return { ok: true };
	} catch (e) {
		return { ok: false, error: (e as Error).message.split(i.apiKey).join("***") };
	}
}
