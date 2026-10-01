import { openDb } from "../src/db.js";
import { createEncryptor } from "../src/crypto.js";
import { createStore } from "../src/store.js";
import { createEngine } from "../src/cleanup/engine.js";
import { ArrHttpError, type ArrApi, type RawItem } from "../src/arr/client.js";
import type { Service, WatchInfo } from "../src/types.js";

export const DAY = 86_400_000;
export const GB = 1024 ** 3;
export const NOW = new Date("2026-06-01T00:00:00Z");

export class FakeArr implements ArrApi {
	calls: string[] = [];
	failDelete = false;
	items = new Map<number, RawItem>();
	files = new Map<number, RawItem[]>();
	constructor(readonly service: Service, items: RawItem[] = []) {
		for (const i of items) this.items.set(i.id, i);
	}
	async status() { return { appName: this.service }; }
	async list() { return [...this.items.values()].map((i) => structuredClone(i)); }
	async get(id: number) {
		const i = this.items.get(id);
		if (!i) throw new ArrHttpError("not found", 404);
		return structuredClone(i);
	}
	async tags() { return [{ id: 1, label: "keep" }, { id: 2, label: "kids" }]; }
	async qualityProfiles() { return [{ id: 1, name: "HD-1080p" }, { id: 2, name: "Any" }]; }
	async episodeFiles(id: number) { return structuredClone(this.files.get(id) ?? []); }
	async deleteItem(id: number, o: { deleteFiles: boolean }) {
		if (this.failDelete) throw new ArrHttpError("boom", 500);
		this.calls.push(`delete:${id}:${o.deleteFiles}`);
		this.items.delete(id);
	}
	async unmonitor(id: number) { this.calls.push(`unmonitor:${id}`); const i = this.items.get(id); if (i) i.monitored = false; }
	async deleteFiles(item: RawItem) { this.calls.push(`delete_files:${item.id}`); }
}

export function movie(id: number, over: RawItem = {}): RawItem {
	return {
		id, title: `Movie ${id}`, year: 2015, monitored: true, hasFile: true, status: "released", qualityProfileId: 1,
		sizeOnDisk: 10 * GB, added: new Date(NOW.getTime() - 400 * DAY).toISOString(), genres: ["Drama"], tags: [], runtime: 110,
		path: `/movies/Movie ${id}`, tmdbId: 1000 + id, imdbId: `tt${id}`, ratings: { tmdb: { value: 6.1 }, imdb: { value: 6.0 } },
		movieFile: { id: id * 10, path: `/movies/Movie ${id}/file.mkv`, size: 10 * GB, quality: { quality: { name: "Bluray-1080p", resolution: 1080 } }, mediaInfo: { videoCodec: "x264", audioCodec: "AAC", audioChannels: 2, resolution: "1920x1080" } },
		originalLanguage: { name: "English" }, ...over,
	};
}

export function series(id: number, over: RawItem = {}): RawItem {
	return {
		id, title: `Show ${id}`, year: 2012, monitored: true, status: "ended", qualityProfileId: 1, added: new Date(NOW.getTime() - 800 * DAY).toISOString(),
		genres: ["Comedy"], tags: [], runtime: 30, path: `/tv/Show ${id}`, tvdbId: 2000 + id, tmdbId: 3000 + id, ratings: { value: 7.5 },
		statistics: { sizeOnDisk: 40 * GB, episodeFileCount: 20 }, ...over,
	};
}

export function setup(opts: { radarr?: RawItem[]; sonarr?: RawItem[]; watch?: Record<string, WatchInfo> | "fail" | null } = {}) {
	const db = openDb(":memory:");
	const store = createStore(db, createEncryptor("test-secret"), () => clock.now);
	const clock = { now: new Date(NOW) };
	const arrs = new Map<string, FakeArr>();
	const radarr = store.instances.create({ name: "Radarr", type: "radarr", url: "http://radarr", apiKey: "k" });
	arrs.set(radarr.id, new FakeArr("radarr", opts.radarr ?? []));
	let sonarr;
	if (opts.sonarr) {
		sonarr = store.instances.create({ name: "Sonarr", type: "sonarr", url: "http://sonarr", apiKey: "k" });
		arrs.set(sonarr.id, new FakeArr("sonarr", opts.sonarr));
	}
	if (opts.watch !== undefined && opts.watch !== null) store.instances.create({ name: "Tautulli", type: "tautulli", url: "http://t", apiKey: "k" });
	const engine = createEngine({
		store,
		now: () => clock.now,
		log: { info() {}, warn() {}, error() {} },
		arr: (i) => arrs.get(i.id) as ArrApi,
		watch: () => ({
			async load() {
				if (opts.watch === "fail" || !opts.watch) throw new Error("tautulli down");
				const w = opts.watch;
				return { warnings: [], lookup: (item) => (item.tmdbId !== null ? w[`${item.kind}:${item.tmdbId}`] : undefined) };
			},
		}),
	});
	const rule = (name: string, expression: unknown, extra: Record<string, unknown> = {}) =>
		store.rules.create({
			name, enabled: true, priority: 0, mode: "cleanup", action: "delete", expression, serviceFilter: null, instanceFilter: null,
			excludeTags: null, excludeTitles: null, useGlobalRejectionMemory: true, rejectionMemoryDays: 0, ...extra,
		} as never);
	return { db, store, engine, clock, radarr, sonarr, arrs, radarrApi: arrs.get(radarr.id) as FakeArr, sonarrApi: sonarr ? (arrs.get(sonarr.id) as FakeArr) : undefined, rule };
}

export const old = (days: number) => ({ type: "age", params: { operator: "older_than", days } });
