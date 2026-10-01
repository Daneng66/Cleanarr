import type { FetchFn } from "../arr/client.js";
import type { Instance } from "../types.js";
import { createPlexProvider, testPlex, type WatchProvider } from "./plex.js";

export type { WatchProvider };

export function createWatchProvider(instance: Instance, fetchFn: FetchFn = fetch): WatchProvider {
	if (instance.type === "plex") return createPlexProvider(instance, fetchFn);
	throw new Error(`${instance.type} is not a watch-history source`);
}

export { testPlex };
