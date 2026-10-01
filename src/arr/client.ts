import type { Instance, Service } from "../types.js";

export class ArrHttpError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
	}
}

/** Raw Sonarr/Radarr API surface used by Cleanarr. Tests substitute fakes for this. */
export interface ArrApi {
	readonly service: Service;
	status(): Promise<{ appName?: string; version?: string; instanceName?: string }>;
	list(): Promise<RawItem[]>;
	get(id: number): Promise<RawItem>;
	tags(): Promise<Array<{ id: number; label: string }>>;
	qualityProfiles(): Promise<Array<{ id: number; name: string }>>;
	/** Sonarr only: all episode files of a series. Radarr embeds the file in the movie. */
	episodeFiles(seriesId: number): Promise<RawFile[]>;
	deleteItem(id: number, opts: { deleteFiles: boolean }): Promise<void>;
	unmonitor(id: number): Promise<void>;
	deleteFiles(item: RawItem): Promise<void>;
	/** Sonarr only: every episode of a series (aired or not). */
	episodes(seriesId: number): Promise<RawItem[]>;
	/** Sonarr only: delete one season's episode files and unmonitor that season. */
	deleteSeason(seriesId: number, season: number): Promise<void>;
}

// biome-ignore lint/suspicious/noExplicitAny: upstream payloads are loosely typed and normalised in normalize.ts
export type RawItem = Record<string, any>;
// biome-ignore lint/suspicious/noExplicitAny: see above
export type RawFile = Record<string, any>;

export type FetchFn = typeof fetch;

export function createArrClient(
	instance: Pick<Instance, "type" | "url" | "apiKey">,
	fetchFn: FetchFn = fetch,
): ArrApi {
	if (instance.type !== "sonarr" && instance.type !== "radarr") {
		throw new Error(`Not an *arr instance: ${instance.type}`);
	}
	const service = instance.type;
	const base = instance.url.replace(/\/+$/, "");
	const root = service === "radarr" ? "movie" : "series";

	async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
		const res = await fetchFn(`${base}/api/v3${path}`, {
			method,
			headers: {
				"X-Api-Key": instance.apiKey,
				Accept: "application/json",
				...(body !== undefined ? { "Content-Type": "application/json" } : {}),
			},
			body: body !== undefined ? JSON.stringify(body) : undefined,
			signal: AbortSignal.timeout(60_000),
		});
		if (!res.ok) {
			const text = await res.text().catch(() => "");
			throw new ArrHttpError(`${service} ${method} ${path} failed: ${res.status} ${text.slice(0, 200)}`, res.status);
		}
		if (res.status === 204) return undefined as T;
		const text = await res.text();
		return (text ? JSON.parse(text) : undefined) as T;
	}

	return {
		service,
		status: () => call("GET", "/system/status"),
		list: () => call("GET", `/${root}`),
		get: (id) => call("GET", `/${root}/${id}`),
		tags: () => call("GET", "/tag"),
		qualityProfiles: () => call("GET", "/qualityprofile"),
		episodeFiles: (seriesId) =>
			service === "sonarr" ? call("GET", `/episodefile?seriesId=${seriesId}`) : Promise.resolve([]),
		deleteItem: (id, { deleteFiles }) =>
			call("DELETE", `/${root}/${id}?deleteFiles=${deleteFiles}&addImportExclusion=false`),
		async unmonitor(id) {
			const current = await call<RawItem>("GET", `/${root}/${id}`);
			const next: RawItem = { ...current, monitored: false };
			if (Array.isArray(current.seasons)) {
				next.seasons = current.seasons.map((s: RawItem) => ({ ...s, monitored: false }));
			}
			await call("PUT", `/${root}/${id}`, next);
		},
		episodes: (seriesId) => (service === "sonarr" ? call("GET", `/episode?seriesId=${seriesId}`) : Promise.resolve([])),
		async deleteSeason(seriesId, season) {
			// Unmonitor first so Sonarr doesn't grab the episodes again the moment their files go.
			const current = await call<RawItem>("GET", `/series/${seriesId}`);
			const seasons = Array.isArray(current.seasons) ? current.seasons.map((s: RawItem) => (s.seasonNumber === season ? { ...s, monitored: false } : s)) : current.seasons;
			await call("PUT", `/series/${seriesId}`, { ...current, seasons });
			const files = await call<RawFile[]>("GET", `/episodefile?seriesId=${seriesId}`);
			const ids = files.filter((f) => f.seasonNumber === season).map((f) => f.id).filter((id): id is number => typeof id === "number");
			if (ids.length) await call("DELETE", "/episodefile/bulk", { episodeFileIds: ids });
		},
		async deleteFiles(item) {
			if (service === "radarr") {
				const fileId = item.movieFile?.id ?? item.movieFileId;
				if (fileId) await call("DELETE", `/moviefile/${fileId}`);
				return;
			}
			const files = await call<RawFile[]>("GET", `/episodefile?seriesId=${item.id}`);
			const ids = files.map((f) => f.id).filter((id): id is number => typeof id === "number");
			if (ids.length) await call("DELETE", "/episodefile/bulk", { episodeFileIds: ids });
		},
	};
}
