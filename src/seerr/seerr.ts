import type { FetchFn } from "../arr/client.js";
import type { Instance, LibraryItem } from "../types.js";

export interface SeerrRequest {
	id: number;
	/** 1 pending, 2 approved, 5 completed (declined requests are dropped). */
	status: number;
	createdAt: Date;
	updatedAt: Date;
	is4k: boolean;
	/** Every name this requester is known by (display, username, Plex name, email), for matching watch history. */
	requesters: string[];
	/** TV requests: the season numbers asked for; null for movies or when Seerr didn't say. */
	seasons?: number[] | null;
	/** Seerr's media record behind the request; deleting it clears the title and all its requests. */
	mediaId?: number;
}

export interface SeerrProvider {
	load(): Promise<{ lookup: (item: LibraryItem) => SeerrRequest[]; warnings: string[] }>;
	/** Removes the title's media record (and so its requests) from Seerr. Returns how many records were deleted. */
	clear(item: LibraryItem): Promise<number>;
}

const PAGE = 100;
const MAX_REQUESTS = 100_000;
const DECLINED = 3;

export function createSeerrProvider(instance: Pick<Instance, "url" | "apiKey">, fetchFn: FetchFn = fetch): SeerrProvider {
	const base = instance.url.replace(/\/+$/, "");
	const headers = { "X-Api-Key": instance.apiKey, Accept: "application/json" };
	const provider: SeerrProvider = {
		async clear(item) {
			const ids = new Set((await this.load()).lookup(item).flatMap((r) => (r.mediaId === undefined ? [] : [r.mediaId])));
			for (const id of ids) {
				const res = await fetchFn(`${base}/api/v1/media/${id}`, { method: "DELETE", headers, signal: AbortSignal.timeout(15_000) });
				if (!res.ok && res.status !== 404) throw new Error(`Seerr media delete failed: HTTP ${res.status}`);
			}
			return ids.size;
		},
		async load() {
			const byKey = new Map<string, SeerrRequest[]>();
			let skip = 0;
			for (;;) {
				const res = await fetchFn(`${base}/api/v1/request?take=${PAGE}&skip=${skip}&filter=all&sort=added`, {
					headers: { "X-Api-Key": instance.apiKey, Accept: "application/json" },
					signal: AbortSignal.timeout(60_000),
				});
				if (!res.ok) throw new Error(`Seerr request list failed: HTTP ${res.status}`);
				const body = (await res.json()) as { pageInfo?: { results?: number }; results?: any[] };
				const rows = body.results ?? [];
				for (const r of rows) {
					if (r.status === DECLINED || !r.media) continue;
					const u = r.requestedBy ?? {};
					const req: SeerrRequest = {
						id: r.id,
						mediaId: typeof r.media.id === "number" ? r.media.id : undefined,
						status: r.status,
						createdAt: new Date(r.createdAt),
						updatedAt: new Date(r.updatedAt ?? r.createdAt),
						is4k: r.is4k === true,
						seasons: Array.isArray(r.seasons) && r.seasons.length ? r.seasons.map((x: any) => x.seasonNumber).filter((n: unknown): n is number => typeof n === "number") : null,
						requesters: [u.displayName, u.username, u.plexUsername, u.jellyfinUsername, u.email].filter((x): x is string => typeof x === "string" && x.length > 0),
					};
					const kind = r.media.mediaType === "movie" ? "movie" : "series";
					for (const [src, id] of [["tmdb", r.media.tmdbId], ["tvdb", r.media.tvdbId]] as const) {
						if (typeof id !== "number") continue;
						const k = `${kind}:${src}:${id}`;
						byKey.set(k, [...(byKey.get(k) ?? []), req]);
					}
				}
				skip += PAGE;
				if (!rows.length || skip >= (body.pageInfo?.results ?? 0)) break;
				if (skip >= MAX_REQUESTS) throw new Error(`Seerr has more than ${MAX_REQUESTS} requests; refusing to act on partial request data`);
			}
			return {
				warnings: [],
				lookup(item) {
					const hits = item.kind === "movie"
						? [...(item.tmdbId !== null ? (byKey.get(`movie:tmdb:${item.tmdbId}`) ?? []) : [])]
						: [...(item.tvdbId !== null ? (byKey.get(`series:tvdb:${item.tvdbId}`) ?? []) : []), ...(item.tmdbId !== null ? (byKey.get(`series:tmdb:${item.tmdbId}`) ?? []) : [])];
					const unique = [...new Map(hits.map((h) => [h.id, h])).values()]; // same request can be indexed under both ids
					// A season item only counts requests that asked for that season.
					return item.season ? unique.filter((r) => !r.seasons || r.seasons.includes(item.season!.number)) : unique;
				},
			};
		},
	};
	return provider;
}

/** Display names of every Seerr user, for picking requesters in the rule editor. */
export async function listSeerrUsers(instance: Pick<Instance, "url" | "apiKey">, fetchFn: FetchFn = fetch): Promise<string[]> {
	const base = instance.url.replace(/\/+$/, "");
	const names: string[] = [];
	for (let skip = 0; skip < 10_000; skip += PAGE) {
		const res = await fetchFn(`${base}/api/v1/user?take=${PAGE}&skip=${skip}`, { headers: { "X-Api-Key": instance.apiKey, Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
		if (!res.ok) throw new Error(`Seerr user list failed: HTTP ${res.status}`);
		const body = (await res.json()) as { pageInfo?: { results?: number }; results?: any[] };
		for (const u of body.results ?? []) {
			const name = [u.displayName, u.username, u.plexUsername, u.email].find((x) => typeof x === "string" && x.length > 0);
			if (name) names.push(name);
		}
		if (!body.results?.length || skip + PAGE >= (body.pageInfo?.results ?? 0)) break;
	}
	return names;
}

export async function testSeerr(instance: Pick<Instance, "url" | "apiKey">, fetchFn: FetchFn = fetch) {
	const res = await fetchFn(`${instance.url.replace(/\/+$/, "")}/api/v1/request?take=1`, {
		headers: { "X-Api-Key": instance.apiKey, Accept: "application/json" },
		signal: AbortSignal.timeout(15_000),
	});
	if (res.status === 401 || res.status === 403) throw new Error(`Seerr rejected the API key (HTTP ${res.status})`);
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
}
