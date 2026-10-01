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
}

export interface SeerrProvider {
	load(): Promise<{ lookup: (item: LibraryItem) => SeerrRequest[]; warnings: string[] }>;
}

const PAGE = 100;
const MAX_REQUESTS = 100_000;
const DECLINED = 3;

export function createSeerrProvider(instance: Pick<Instance, "url" | "apiKey">, fetchFn: FetchFn = fetch): SeerrProvider {
	const base = instance.url.replace(/\/+$/, "");
	return {
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
						status: r.status,
						createdAt: new Date(r.createdAt),
						updatedAt: new Date(r.updatedAt ?? r.createdAt),
						is4k: r.is4k === true,
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
					return [...new Map(hits.map((h) => [h.id, h])).values()]; // same request can be indexed under both ids
				},
			};
		},
	};
}

export async function testSeerr(instance: Pick<Instance, "url" | "apiKey">, fetchFn: FetchFn = fetch) {
	const res = await fetchFn(`${instance.url.replace(/\/+$/, "")}/api/v1/request?take=1`, {
		headers: { "X-Api-Key": instance.apiKey, Accept: "application/json" },
		signal: AbortSignal.timeout(15_000),
	});
	if (res.status === 401 || res.status === 403) throw new Error(`Seerr rejected the API key (HTTP ${res.status})`);
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
}
