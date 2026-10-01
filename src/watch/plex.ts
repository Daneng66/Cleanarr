import type { FetchFn } from "../arr/client.js";
import type { Instance, LibraryItem, WatchInfo } from "../types.js";

export interface WatchProvider {
	/** Resolves lookup for the given items; throws when the history can't be read completely. */
	load(): Promise<{ lookup: (item: LibraryItem) => WatchInfo | undefined; warnings: string[] }>;
}

const PAGE = 500;
/** Hard ceilings so a runaway library/history can't hang a run; exceeding them fails closed. */
const MAX_HISTORY_ROWS = 750_000;
const MAX_LIBRARY_ITEMS = 250_000;

interface PlexMeta {
	ratingKey?: string | number;
	grandparentRatingKey?: string | number;
	type?: string;
	accountID?: number;
	viewedAt?: number;
	Guid?: Array<{ id?: string }>;
}

/**
 * Reads watch history straight from Plex for every account on the server.
 * Requires the server owner's token: history for other users is only visible to the owner.
 */
export function createPlexProvider(instance: Pick<Instance, "url" | "apiKey">, fetchFn: FetchFn = fetch): WatchProvider {
	const base = instance.url.replace(/\/+$/, "");

	async function get<T>(path: string, start?: number): Promise<{ items: T[]; total: number }> {
		const res = await fetchFn(`${base}${path}`, {
			headers: {
				Accept: "application/json",
				"X-Plex-Token": instance.apiKey,
				"X-Plex-Client-Identifier": "cleanarr",
				"X-Plex-Product": "Cleanarr",
				...(start !== undefined ? { "X-Plex-Container-Start": String(start), "X-Plex-Container-Size": String(PAGE) } : {}),
			},
			signal: AbortSignal.timeout(60_000),
		});
		if (!res.ok) throw new Error(`Plex ${path.split("?")[0]} failed: HTTP ${res.status}${res.status === 401 ? " (check the X-Plex-Token)" : ""}`);
		const body = (await res.json()) as { MediaContainer?: Record<string, any> };
		const c = body.MediaContainer ?? {};
		const items = (c.Metadata ?? c.Directory ?? c.Account ?? []) as T[];
		return { items, total: typeof c.totalSize === "number" ? c.totalSize : (c.size ?? items.length) };
	}

	async function paged<T>(path: string, cap: number, what: string): Promise<T[]> {
		const out: T[] = [];
		for (let start = 0; ; start += PAGE) {
			const page = await get<T>(path, start);
			out.push(...page.items);
			if (out.length > cap) throw new Error(`Plex ${what} exceeds ${cap} rows; refusing to act on partial watch data`);
			if (!page.items.length || start + PAGE >= page.total) break;
		}
		return out;
	}

	return {
		async load() {
			const warnings: string[] = [];
			const [{ items: sections }, { items: accounts }] = await Promise.all([
				get<{ key: string; type: string; title: string }>("/library/sections"),
				get<{ id: number; name: string }>("/accounts"),
			]);
			const names = new Map(accounts.map((a) => [a.id, a.name] as const));

			// ratingKey -> external ids for every movie / show Plex knows about.
			const guidsByKey = new Map<string, string[]>();
			for (const s of sections.filter((x) => x.type === "movie" || x.type === "show")) {
				const metas = await paged<PlexMeta>(`/library/sections/${encodeURIComponent(s.key)}/all?includeGuids=1`, MAX_LIBRARY_ITEMS, `library "${s.title}"`);
				for (const m of metas) {
					if (m.ratingKey === undefined) continue;
					guidsByKey.set(String(m.ratingKey), (m.Guid ?? []).map((g) => g.id ?? "").filter(Boolean));
				}
			}

			type Agg = { kind: "movie" | "series"; last: number; count: number; users: Set<string> };
			const roots = new Map<string, Agg>();
			const history = await paged<PlexMeta>("/status/sessions/history/all?sort=viewedAt:desc", MAX_HISTORY_ROWS, "watch history");
			for (const row of history) {
				const isEpisode = row.type === "episode";
				if (!isEpisode && row.type !== "movie") continue;
				const key = String(isEpisode ? (row.grandparentRatingKey ?? "") : (row.ratingKey ?? ""));
				if (!key) continue;
				const agg = roots.get(key) ?? { kind: isEpisode ? "series" : "movie", last: 0, count: 0, users: new Set<string>() };
				agg.count++;
				if (typeof row.viewedAt === "number") agg.last = Math.max(agg.last, row.viewedAt);
				const user = row.accountID !== undefined ? names.get(row.accountID) : undefined;
				if (user) agg.users.add(user);
				roots.set(key, agg);
			}

			const byKey = new Map<string, WatchInfo>();
			let unresolved = 0;
			for (const [ratingKey, agg] of roots) {
				const guids = guidsByKey.get(ratingKey);
				if (!guids?.length) {
					unresolved++; // removed from Plex since it was watched
					continue;
				}
				for (const g of guids) {
					const m = /^(tmdb|tvdb):\/\/(\d+)$/.exec(g);
					if (!m) continue;
					const k = `${agg.kind}:${m[1]}:${m[2]}`;
					const prev = byKey.get(k);
					const next: WatchInfo = { lastWatchedAt: agg.last ? new Date(agg.last * 1000) : null, watchCount: agg.count, watchedBy: [...agg.users] };
					byKey.set(k, prev ? mergeInfo(prev, next) : next);
				}
			}
			if (unresolved) warnings.push(`${unresolved} Plex history item(s) are no longer in Plex libraries and were ignored`);

			return {
				warnings,
				lookup(item: LibraryItem) {
					if (item.kind === "movie") return item.tmdbId !== null ? byKey.get(`movie:tmdb:${item.tmdbId}`) : undefined;
					return (item.tvdbId !== null ? byKey.get(`series:tvdb:${item.tvdbId}`) : undefined) ?? (item.tmdbId !== null ? byKey.get(`series:tmdb:${item.tmdbId}`) : undefined);
				},
			};
		},
	};
}

function mergeInfo(a: WatchInfo, b: WatchInfo): WatchInfo {
	const dates = [a.lastWatchedAt, b.lastWatchedAt].filter((d): d is Date => !!d).sort((x, y) => y.getTime() - x.getTime());
	return { lastWatchedAt: dates[0] ?? null, watchCount: a.watchCount + b.watchCount, watchedBy: [...new Set([...a.watchedBy, ...b.watchedBy])] };
}

export async function testPlex(instance: Pick<Instance, "url" | "apiKey">, fetchFn: FetchFn = fetch) {
	const res = await fetchFn(`${instance.url.replace(/\/+$/, "")}/library/sections`, {
		headers: { Accept: "application/json", "X-Plex-Token": instance.apiKey, "X-Plex-Client-Identifier": "cleanarr" },
		signal: AbortSignal.timeout(15_000),
	});
	if (res.status === 401) throw new Error("Plex rejected the token (HTTP 401)");
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
}
