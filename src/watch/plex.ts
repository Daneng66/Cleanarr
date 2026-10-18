import type { FetchFn } from "../arr/client.js";
import type { Instance, LibraryItem, WatchInfo } from "../types.js";

export interface WatchProvider {
	/** Web-app URL of the title in Plex, or null when Plex doesn't have it. Best effort: throws on connection problems. */
	link?(q: { kind: "movie" | "show"; title: string; tmdbId: number | null; tvdbId: number | null }): Promise<string | null>;
	/** Resolves lookup for the given items; throws when the history can't be read completely. */
	load(): Promise<{ lookup: (item: LibraryItem) => WatchInfo | undefined; certLookup?: (item: LibraryItem) => string | undefined; addedLookup?: (item: LibraryItem) => Date | undefined; warnings: string[] }>;
}

const PAGE = 500;
/** Stands in for plays whose account Plex doesn't list (removed or home users), so they still count as watched by someone. */
const UNKNOWN_USER = "(unknown account)";
/** Hard ceilings so a runaway library/history can't hang a run; exceeding them fails closed. */
const MAX_HISTORY_ROWS = 750_000;
const MAX_LIBRARY_ITEMS = 250_000;

interface PlexMeta {
	ratingKey?: string | number;
	grandparentRatingKey?: string | number;
	/** "/library/metadata/<ratingKey>"; some servers send only this on history rows. */
	grandparentKey?: string;
	type?: string;
	accountID?: number;
	viewedAt?: number;
	/** Episode rows: season and episode number. */
	parentIndex?: number;
	index?: number;
	Guid?: Array<{ id?: string }>;
	/** Library listing rows only: Plex's age rating for the movie/show, e.g. "TV-14". */
	contentRating?: string;
	/** Plex's unified numeric age rating (e.g. 14); some items have only this, no label. */
	contentRatingAge?: number;
	/** Library listing rows only: Unix seconds when Plex first scanned the title in. */
	addedAt?: number;
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
		async link({ kind, title, tmdbId, tvdbId }) {
			const want = [tmdbId !== null ? `tmdb://${tmdbId}` : "", tvdbId !== null ? `tvdb://${tvdbId}` : ""].filter(Boolean);
			if (!want.length) return null;
			const { items: sections } = await get<{ key: string; type: string }>("/library/sections");
			for (const sec of sections.filter((x) => x.type === kind)) {
				const { items } = await get<PlexMeta>(`/library/sections/${encodeURIComponent(sec.key)}/all?includeGuids=1&title=${encodeURIComponent(title)}`);
				const hit = items.find((m) => m.ratingKey !== undefined && m.Guid?.some((g) => want.includes(g.id ?? "")));
				if (!hit) continue;
				const res = await fetchFn(`${base}/`, { headers: { Accept: "application/json", "X-Plex-Token": instance.apiKey }, signal: AbortSignal.timeout(15_000) });
				const id = ((await res.json()) as { MediaContainer?: { machineIdentifier?: string } }).MediaContainer?.machineIdentifier;
				if (!res.ok || !id) return null;
				return `${base}/web/index.html#!/server/${id}/details?key=${encodeURIComponent(`/library/metadata/${hit.ratingKey}`)}`;
			}
			return null;
		},
		async load() {
			const warnings: string[] = [];
			const [{ items: sections }, { items: accounts }] = await Promise.all([
				get<{ key: string; type: string; title: string }>("/library/sections"),
				get<{ id: number; name: string }>("/accounts"),
			]);
			const names = new Map(accounts.map((a) => [a.id, a.name] as const));

			// ratingKey -> external ids for every movie / show Plex knows about.
			const guidsByKey = new Map<string, string[]>();
			// "tmdb:123" / "tvdb:456" -> Plex's content rating for that title.
			const certByExternalId = new Map<string, string>();
			// "tmdb:123" / "tvdb:456" -> when Plex first added that title (earliest wins if listed twice).
			const addedByExternalId = new Map<string, Date>();
			for (const s of sections.filter((x) => x.type === "movie" || x.type === "show")) {
				const metas = await paged<PlexMeta>(`/library/sections/${encodeURIComponent(s.key)}/all?includeGuids=1`, MAX_LIBRARY_ITEMS, `library "${s.title}"`);
				for (const m of metas) {
					if (m.ratingKey === undefined) continue;
					const guids = (m.Guid ?? []).map((g) => g.id ?? "").filter(Boolean);
					guidsByKey.set(String(m.ratingKey), guids);
					// Prefer the labeled rating (e.g. "TV-14"); some items only have Plex's numeric unified age rating.
					// Plex's API prefixes the label with a country code (e.g. "gb/U"); its own UI shows just "U".
					const rating = (m.contentRating || (typeof m.contentRatingAge === "number" ? String(m.contentRatingAge) : undefined))?.replace(/^[a-z]{2}\//i, "");
					for (const g of guids) {
						const mm = /^(tmdb|tvdb):\/\/(\d+)$/.exec(g);
						if (!mm) continue;
						const k = `${mm[1]}:${mm[2]}`;
						if (rating) certByExternalId.set(k, rating);
						if (typeof m.addedAt === "number" && m.addedAt > 0) {
							const d = new Date(m.addedAt * 1000);
							const prev = addedByExternalId.get(k);
							if (!prev || d < prev) addedByExternalId.set(k, d);
						}
					}
				}
			}

			type Agg = { kind: "movie" | "series" | "season"; last: number; count: number; users: Set<string>; episodes?: Map<string, Set<number>> };
			const roots = new Map<string, Agg>();
			const add = (key: string, kind: Agg["kind"], row: PlexMeta, user: string) => {
				const agg = roots.get(key) ?? { kind, last: 0, count: 0, users: new Set<string>() };
				agg.count++;
				if (typeof row.viewedAt === "number") agg.last = Math.max(agg.last, row.viewedAt);
				agg.users.add(user);
				roots.set(key, agg);
				return agg;
			};
			const history = await paged<PlexMeta>("/status/sessions/history/all?sort=viewedAt:desc", MAX_HISTORY_ROWS, "watch history");
			for (const row of history) {
				const isEpisode = row.type === "episode";
				if (!isEpisode && row.type !== "movie") continue;
				const key = String(isEpisode ? (row.grandparentRatingKey ?? /\/(\d+)$/.exec(row.grandparentKey ?? "")?.[1] ?? "") : (row.ratingKey ?? ""));
				if (!key) continue;
				const user = (row.accountID !== undefined ? names.get(row.accountID) : undefined) ?? UNKNOWN_USER;
				add(key, isEpisode ? "series" : "movie", row, user);
				if (isEpisode && typeof row.parentIndex === "number") {
					// Season aggregates are keyed "<show ratingKey>#<season>" and resolve through the show's guids.
					const season = add(`${key}#${row.parentIndex}`, "season", row, user);
					if (typeof row.index === "number") {
						season.episodes ??= new Map();
						const set = season.episodes.get(user) ?? new Set<number>();
						set.add(row.index);
						season.episodes.set(user, set);
					}
				}
			}

			const byKey = new Map<string, WatchInfo>();
			let unresolved = 0;
			for (const [rootKey, agg] of roots) {
				const [ratingKey, season] = rootKey.split("#");
				const guids = guidsByKey.get(ratingKey as string);
				if (!guids?.length) {
					if (season === undefined) unresolved++; // removed from Plex since it was watched
					continue;
				}
				for (const g of guids) {
					const m = /^(tmdb|tvdb):\/\/(\d+)$/.exec(g);
					if (!m) continue;
					const k = `${agg.kind}:${m[1]}:${m[2]}${season === undefined ? "" : `:${season}`}`;
					const prev = byKey.get(k);
					const next: WatchInfo = { lastWatchedAt: agg.last ? new Date(agg.last * 1000) : null, watchCount: agg.count, watchedBy: [...agg.users], ...(agg.episodes ? { episodesByUser: agg.episodes } : {}) };
					byKey.set(k, prev ? mergeInfo(prev, next) : next);
				}
			}
			if (unresolved) warnings.push(`${unresolved} Plex history item(s) are no longer in Plex libraries and were ignored`);

			return {
				warnings,
				lookup(item: LibraryItem) {
					if (item.kind === "movie") return item.tmdbId !== null ? byKey.get(`movie:tmdb:${item.tmdbId}`) : undefined;
					const kind = item.season ? "season" : "series";
					const sfx = item.season ? `:${item.season.number}` : "";
					return (item.tvdbId !== null ? byKey.get(`${kind}:tvdb:${item.tvdbId}${sfx}`) : undefined) ?? (item.tmdbId !== null ? byKey.get(`${kind}:tmdb:${item.tmdbId}${sfx}`) : undefined);
				},
				certLookup(item: LibraryItem) {
					return (item.tvdbId !== null ? certByExternalId.get(`tvdb:${item.tvdbId}`) : undefined) ?? (item.tmdbId !== null ? certByExternalId.get(`tmdb:${item.tmdbId}`) : undefined);
				},
				addedLookup(item: LibraryItem) {
					return (item.tvdbId !== null ? addedByExternalId.get(`tvdb:${item.tvdbId}`) : undefined) ?? (item.tmdbId !== null ? addedByExternalId.get(`tmdb:${item.tmdbId}`) : undefined);
				},
			};
		},
	};
}

function mergeInfo(a: WatchInfo, b: WatchInfo): WatchInfo {
	const dates = [a.lastWatchedAt, b.lastWatchedAt].filter((d): d is Date => !!d).sort((x, y) => y.getTime() - x.getTime());
	const episodesByUser = mergeEpisodes([a.episodesByUser, b.episodesByUser]);
	return { lastWatchedAt: dates[0] ?? null, watchCount: a.watchCount + b.watchCount, watchedBy: [...new Set([...a.watchedBy, ...b.watchedBy])], ...(episodesByUser ? { episodesByUser } : {}) };
}

/** Union of per-user watched episode sets; undefined when none of the inputs has any. */
export function mergeEpisodes(maps: Array<Map<string, Set<number>> | undefined>): Map<string, Set<number>> | undefined {
	const present = maps.filter((m): m is Map<string, Set<number>> => !!m);
	if (!present.length) return undefined;
	const out = new Map<string, Set<number>>();
	for (const m of present) for (const [u, eps] of m) out.set(u, new Set([...(out.get(u) ?? []), ...eps]));
	return out;
}

export async function testPlex(instance: Pick<Instance, "url" | "apiKey">, fetchFn: FetchFn = fetch) {
	const res = await fetchFn(`${instance.url.replace(/\/+$/, "")}/library/sections`, {
		headers: { Accept: "application/json", "X-Plex-Token": instance.apiKey, "X-Plex-Client-Identifier": "cleanarr" },
		signal: AbortSignal.timeout(15_000),
	});
	if (res.status === 401) throw new Error("Plex rejected the token (HTTP 401)");
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
}
