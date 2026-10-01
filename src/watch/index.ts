import type { FetchFn } from "../arr/client.js";
import type { Db } from "../db.js";
import type { Instance } from "../types.js";
import { createPlexProvider, testPlex } from "./plex.js";
import { createTautulliProvider, testTautulli, type WatchProvider } from "./tautulli.js";

export type { WatchProvider };

export function createWatchProvider(instance: Instance, db: Db, fetchFn: FetchFn = fetch): WatchProvider {
	if (instance.type === "plex") return createPlexProvider(instance, fetchFn);
	if (instance.type === "tautulli") return createTautulliProvider(instance, db, fetchFn);
	throw new Error(`${instance.type} is not a watch-history source`);
}

export { testPlex, testTautulli };
