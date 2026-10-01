import type { Db } from "../db.js";
import type { FetchFn } from "../arr/client.js";
import type { Instance, LibraryItem, WatchInfo } from "../types.js";

export interface WatchProvider {
	/** Resolves lookup for the given items; throws when the history can't be read completely. */
	load(): Promise<{ lookup: (item: LibraryItem) => WatchInfo | undefined; warnings: string[] }>;
}

interface HistoryRow {
	rating_key?: string | number | null;
	grandparent_rating_key?: string | number | null;
	media_type?: string;
	user?: string;
	friendly_name?: string;
	date?: number;
}

const PAGE = 1000;
/** Hard ceiling so a runaway history can't hang a run; exceeding it fails closed. */
const MAX_ROWS = 750_000;
const GUID_TTL_MS = 30 * 86_400_000;

export function createTautulliProvider(
	instance: Pick<Instance, "id" | "url" | "apiKey">,
	db: Db,
	fetchFn: FetchFn = fetch,
	now: () => Date = () => new Date(),
): WatchProvider {
	const base = instance.url.replace(/\/+$/, "");

	async function cmd<T>(command: string, params: Record<string, string | number> = {}): Promise<T> {
		const qs = new URLSearchParams({ apikey: instance.apiKey, cmd: command, ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) });
		const res = await fetchFn(`${base}/api/v2?${qs}`, { signal: AbortSignal.timeout(60_000) });
		if (!res.ok) throw new Error(`Tautulli ${command} failed: HTTP ${res.status}`);
		const body = (await res.json()) as { response?: { result?: string; message?: string; data?: T } };
		if (body.response?.result !== "success") throw new Error(`Tautulli ${command} failed: ${body.response?.message ?? "unknown error"}`);
		return body.response.data as T;
	}

	async function guidsFor(ratingKey: string): Promise<string[] | null> {
		const cached = db
			.prepare("SELECT guids, fetched_at FROM tautulli_guid_cache WHERE instance_id = ? AND rating_key = ?")
			.get(instance.id, ratingKey) as { guids: string; fetched_at: string } | undefined;
		if (cached && now().getTime() - Date.parse(cached.fetched_at) < GUID_TTL_MS) return JSON.parse(cached.guids);
		const meta = await cmd<{ guids?: string[] } | []>("get_metadata", { rating_key: ratingKey });
		const guids = !Array.isArray(meta) && Array.isArray(meta?.guids) ? meta.guids : [];
		if (guids.length === 0) return null; // not in Tautulli's DB any more (deleted from Plex)
		db.prepare("INSERT OR REPLACE INTO tautulli_guid_cache (instance_id, rating_key, guids, fetched_at) VALUES (?,?,?,?)").run(
			instance.id,
			ratingKey,
			JSON.stringify(guids),
			now().toISOString(),
		);
		return guids;
	}

	return {
		async load() {
			const warnings: string[] = [];
			type Agg = { kind: "movie" | "series"; last: number; count: number; users: Set<string> };
			const roots = new Map<string, Agg>();
			let start = 0;
			for (;;) {
				const page = await cmd<{ data: HistoryRow[]; recordsFiltered: number }>("get_history", {
					grouping: 0,
					include_activity: 0,
					length: PAGE,
					start,
					order_column: "date",
					order_dir: "desc",
				});
				for (const row of page.data ?? []) {
					const isEpisode = row.media_type === "episode";
					if (!isEpisode && row.media_type !== "movie") continue;
					const key = String(isEpisode ? row.grandparent_rating_key : row.rating_key ?? "");
					if (!key || key === "null" || key === "undefined") continue;
					const agg = roots.get(key) ?? { kind: isEpisode ? "series" : "movie", last: 0, count: 0, users: new Set<string>() };
					agg.count++;
					if (typeof row.date === "number") agg.last = Math.max(agg.last, row.date);
					const user = row.friendly_name || row.user;
					if (user) agg.users.add(user);
					roots.set(key, agg);
				}
				start += PAGE;
				if (start >= (page.recordsFiltered ?? 0) || !(page.data?.length)) break;
				if (start >= MAX_ROWS) throw new Error(`Tautulli history exceeds ${MAX_ROWS} rows; refusing to act on partial watch data`);
			}

			const byKey = new Map<string, WatchInfo>();
			const merge = (k: string, a: Agg) => {
				const prev = byKey.get(k);
				const next: WatchInfo = {
					lastWatchedAt: a.last ? new Date(a.last * 1000) : null,
					watchCount: a.count,
					watchedBy: [...a.users],
				};
				if (!prev) return byKey.set(k, next);
				byKey.set(k, {
					lastWatchedAt: [prev.lastWatchedAt, next.lastWatchedAt].filter((d): d is Date => !!d).sort((x, y) => y.getTime() - x.getTime())[0] ?? null,
					watchCount: prev.watchCount + next.watchCount,
					watchedBy: [...new Set([...prev.watchedBy, ...next.watchedBy])],
				});
			};

			const entries = [...roots.entries()];
			let unresolved = 0;
			for (let i = 0; i < entries.length; i += 8) {
				await Promise.all(
					entries.slice(i, i + 8).map(async ([ratingKey, agg]) => {
						const guids = await guidsFor(ratingKey);
						if (!guids) return void unresolved++;
						for (const g of guids) {
							const m = /^(tmdb|tvdb):\/\/(\d+)$/.exec(g);
							if (m) merge(`${agg.kind}:${m[1]}:${m[2]}`, agg);
						}
					}),
				);
			}
			if (unresolved) warnings.push(`${unresolved} Tautulli history item(s) could not be matched to external ids (removed from Plex?)`);

			return {
				warnings,
				lookup(item) {
					if (item.kind === "movie") return item.tmdbId !== null ? byKey.get(`movie:tmdb:${item.tmdbId}`) : undefined;
					return (item.tvdbId !== null ? byKey.get(`series:tvdb:${item.tvdbId}`) : undefined) ?? (item.tmdbId !== null ? byKey.get(`series:tmdb:${item.tmdbId}`) : undefined);
				},
			};
		},
	};
}

export async function testTautulli(instance: Pick<Instance, "url" | "apiKey">, fetchFn: FetchFn = fetch) {
	const qs = new URLSearchParams({ apikey: instance.apiKey, cmd: "get_server_info" });
	const res = await fetchFn(`${instance.url.replace(/\/+$/, "")}/api/v2?${qs}`, { signal: AbortSignal.timeout(15_000) });
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const body = (await res.json()) as { response?: { result?: string; message?: string } };
	if (body.response?.result !== "success") throw new Error(body.response?.message ?? "Tautulli rejected the request");
}
