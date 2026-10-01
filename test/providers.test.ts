import { describe, expect, it } from "vitest";
import { createPlexProvider, testPlex } from "../src/watch/plex.js";
import { createSeerrProvider, testSeerr } from "../src/seerr/seerr.js";
import Database from "better-sqlite3";
import { migrate } from "../src/db.js";
import { createEncryptor } from "../src/crypto.js";
import { normalizeItem } from "../src/arr/normalize.js";
import { testConnection } from "../src/services.js";
import { movie, series } from "./helpers.js";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const maps = { tags: new Map<number, string>(), profiles: new Map<number, string>() };
const mItem = (id: number) => normalizeItem(movie(id), { instanceId: "i", service: "radarr", ...maps });
const sItem = (id: number) => normalizeItem(series(id), { instanceId: "i", service: "sonarr", ...maps });

/** Fake Plex: library sections, per-section items with guids, accounts and paged history. */
function fakePlex(opts: { history?: any[]; failHistory?: boolean } = {}) {
	const requests: Array<{ url: string; token: string | null; start: string | null }> = [];
	const sections = [{ key: "1", type: "movie", title: "Movies" }, { key: "2", type: "show", title: "TV" }, { key: "3", type: "artist", title: "Music" }];
	const items: Record<string, any[]> = {
		"1": [{ ratingKey: "100", Guid: [{ id: "imdb://tt1" }, { id: "tmdb://1001" }] }, { ratingKey: "101", Guid: [{ id: "tmdb://1002" }] }],
		"2": [{ ratingKey: "200", Guid: [{ id: "tvdb://2001" }, { id: "tmdb://3001" }] }],
	};
	const history = opts.history ?? [];
	const fn = (async (input: any, init?: any) => {
		const u = new URL(String(input));
		const h = init?.headers ?? {};
		requests.push({ url: u.pathname + u.search, token: h["X-Plex-Token"] ?? null, start: h["X-Plex-Container-Start"] ?? null });
		if (h["X-Plex-Token"] !== "tok") return json({}, 401);
		if (u.pathname === "/library/sections") return json({ MediaContainer: { Directory: sections } });
		if (u.pathname === "/accounts") return json({ MediaContainer: { Account: [{ id: 1, name: "owner" }, { id: 2, name: "Alice" }] } });
		const m = /^\/library\/sections\/(\d+)\/all$/.exec(u.pathname);
		if (m) return json({ MediaContainer: { totalSize: items[m[1]!]?.length ?? 0, Metadata: items[m[1]!] ?? [] } });
		if (u.pathname === "/status/sessions/history/all") {
			if (opts.failHistory) return json({}, 500);
			const start = Number(h["X-Plex-Container-Start"] ?? 0);
			const size = Number(h["X-Plex-Container-Size"] ?? 500);
			return json({ MediaContainer: { totalSize: history.length, Metadata: history.slice(start, start + size) } });
		}
		return json({}, 404);
	}) as typeof fetch;
	return { fn, requests };
}

describe("Plex provider", () => {
	const day = (n: number) => 1_700_000_000 + n * 86_400;
	it("aggregates all users' history onto movies and shows via external ids", async () => {
		const { fn } = fakePlex({
			history: [
				{ type: "movie", ratingKey: "100", accountID: 1, viewedAt: day(5) },
				{ type: "movie", ratingKey: "100", accountID: 2, viewedAt: day(9) },
				{ type: "episode", ratingKey: "9001", grandparentRatingKey: "200", accountID: 2, viewedAt: day(3) },
				{ type: "episode", ratingKey: "9002", grandparentRatingKey: "200", accountID: 2, viewedAt: day(4) },
				{ type: "track", ratingKey: "5", accountID: 1, viewedAt: day(1) },
			],
		});
		const { lookup, warnings } = await createPlexProvider({ url: "http://plex:32400/", apiKey: "tok" }, fn).load();
		const m = lookup(mItem(1));
		expect(m?.watchCount).toBe(2);
		expect(m?.watchedBy.sort()).toEqual(["Alice", "owner"]);
		expect(m?.lastWatchedAt?.getTime()).toBe(day(9) * 1000);
		expect(lookup(sItem(1))?.watchCount).toBe(2); // series matched by tvdb 2001
		expect(lookup(mItem(2))).toBeUndefined(); // in Plex, never watched
		expect(warnings).toEqual([]);
	});
	it("pages through large histories", async () => {
		const history = Array.from({ length: 1234 }, (_, i) => ({ type: "movie", ratingKey: "100", accountID: 1, viewedAt: day(i) }));
		const { fn, requests } = fakePlex({ history });
		const { lookup } = await createPlexProvider({ url: "http://plex", apiKey: "tok" }, fn).load();
		expect(lookup(mItem(1))?.watchCount).toBe(1234);
		expect(requests.filter((r) => r.url.startsWith("/status/sessions/history")).map((r) => r.start)).toEqual(["0", "500", "1000"]);
	});
	it("only reads movie and show sections", async () => {
		const { fn, requests } = fakePlex();
		await createPlexProvider({ url: "http://plex", apiKey: "tok" }, fn).load();
		expect(requests.some((r) => r.url.includes("/library/sections/3/"))).toBe(false);
	});
	it("warns about history for items no longer in Plex", async () => {
		const { fn } = fakePlex({ history: [{ type: "movie", ratingKey: "999", accountID: 1, viewedAt: day(1) }] });
		const { warnings } = await createPlexProvider({ url: "http://plex", apiKey: "tok" }, fn).load();
		expect(warnings[0]).toMatch(/no longer in Plex/);
	});
	it("throws (so rules fail closed) on a bad token or a failed history read", async () => {
		await expect(createPlexProvider({ url: "http://plex", apiKey: "wrong" }, fakePlex().fn).load()).rejects.toThrow(/401.*token/i);
		await expect(createPlexProvider({ url: "http://plex", apiKey: "tok" }, fakePlex({ failHistory: true }).fn).load()).rejects.toThrow(/history.*500/);
	});
	it("connection test", async () => {
		await expect(testPlex({ url: "http://plex", apiKey: "tok" }, fakePlex().fn)).resolves.toBeUndefined();
		await expect(testPlex({ url: "http://plex", apiKey: "bad" }, fakePlex().fn)).rejects.toThrow(/rejected the token/);
	});
});

function fakeSeerr(requests: any[], key = "sk") {
	const calls: string[] = [];
	const fn = (async (input: any, init?: any) => {
		const u = new URL(String(input));
		calls.push(u.search);
		if (init?.headers?.["X-Api-Key"] !== key) return json({}, 403);
		const take = Number(u.searchParams.get("take")), skip = Number(u.searchParams.get("skip"));
		return json({ pageInfo: { results: requests.length }, results: requests.slice(skip, skip + take) });
	}) as typeof fetch;
	return { fn, calls };
}
const sreq = (id: number, media: any, over: any = {}) => ({ id, status: 2, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-02T00:00:00Z", is4k: false, media, requestedBy: { displayName: "Alice", plexUsername: "alice_plex", email: "a@x.io" }, ...over });

describe("Seerr provider", () => {
	it("indexes requests by tmdb/tvdb id and collects requester aliases", async () => {
		const { fn } = fakeSeerr([sreq(1, { mediaType: "movie", tmdbId: 1001 }), sreq(2, { mediaType: "tv", tvdbId: 2001, tmdbId: 3001 }), sreq(3, { mediaType: "movie", tmdbId: 1001 }, { requestedBy: { displayName: "Bob" } })]);
		const { lookup } = await createSeerrProvider({ url: "http://seerr:5055/", apiKey: "sk" }, fn).load();
		expect(lookup(mItem(1)).map((r) => r.id).sort()).toEqual([1, 3]);
		expect(lookup(mItem(1))[0]?.requesters).toEqual(["Alice", "alice_plex", "a@x.io"]);
		expect(lookup(sItem(1))).toHaveLength(1); // found under both tvdb and tmdb, returned once
		expect(lookup(mItem(2))).toEqual([]);
	});
	it("ignores declined requests", async () => {
		const { fn } = fakeSeerr([sreq(1, { mediaType: "movie", tmdbId: 1001 }, { status: 3 })]);
		const { lookup } = await createSeerrProvider({ url: "http://s", apiKey: "sk" }, fn).load();
		expect(lookup(mItem(1))).toEqual([]);
	});
	it("pages through all requests", async () => {
		const all = Array.from({ length: 250 }, (_, i) => sreq(i + 1, { mediaType: "movie", tmdbId: 5000 + i }));
		const { fn, calls } = fakeSeerr(all);
		await createSeerrProvider({ url: "http://s", apiKey: "sk" }, fn).load();
		expect(calls).toHaveLength(3);
	});
	it("throws on auth failure so request rules fail closed", async () => {
		await expect(createSeerrProvider({ url: "http://s", apiKey: "bad" }, fakeSeerr([]).fn).load()).rejects.toThrow(/403/);
		await expect(testSeerr({ url: "http://s", apiKey: "bad" }, fakeSeerr([]).fn)).rejects.toThrow(/rejected the API key/);
	});
});

describe("testConnection", () => {
	it("never leaks the API key in errors", async () => {
		const r = await testConnection({ type: "radarr", url: "http://127.0.0.1:1", apiKey: "supersecret" });
		expect(r.ok).toBe(false);
		expect(JSON.stringify(r)).not.toContain("supersecret");
	});
});

describe("migration 2", () => {
	it("upgrades a v1 database: renames tautulli_* rule types, keeps instances, allows plex/seerr", () => {
		const db = new Database(":memory:");
		migrate(db, 1); // schema as shipped before Plex/Seerr support
		const enc = createEncryptor("x");
		db.prepare("INSERT INTO instances (id,name,type,url,api_key_enc,enabled,created_at) VALUES ('t1','Tautulli','tautulli','http://t',?,1,'2026-01-01')").run(enc.encrypt("k"));
		const expr = JSON.stringify({ op: "and", of: [{ type: "tautulli_last_watched", params: { operator: "not_watched_in_days", days: 90 } }, { type: "tautulli_watch_count", params: { operator: "equals", count: 0 } }, { type: "tautulli_watched_by", params: { operator: "watched_by_any", users: ["a"] } }, { type: "age", params: { operator: "older_than", days: 5 } }] });
		db.prepare("INSERT INTO rules (id,name,expression,created_at,updated_at) VALUES ('r1','old',?,'2026-01-01','2026-01-01')").run(expr);
		expect(() => db.prepare("INSERT INTO instances (id,name,type,url,api_key_enc,created_at) VALUES ('p','P','plex','http://p','x','now')").run()).toThrow(/CHECK/);

		migrate(db, 2);

		const types = (JSON.parse((db.prepare("SELECT expression FROM rules WHERE id='r1'").get() as { expression: string }).expression).of as Array<{ type: string }>).map((n) => n.type);
		expect(types).toEqual(["last_watched", "watch_count", "watched_by", "age"]);
		expect(db.prepare("SELECT type FROM instances WHERE id='t1'").get()).toEqual({ type: "tautulli" });
		expect(() => db.prepare("INSERT INTO instances (id,name,type,url,api_key_enc,created_at) VALUES ('p','P','plex','http://p','x','now')").run()).not.toThrow();
		expect(() => db.prepare("INSERT INTO instances (id,name,type,url,api_key_enc,created_at) VALUES ('s','S','seerr','http://s','x','now')").run()).not.toThrow();
		expect(db.pragma("user_version", { simple: true })).toBe(2);
	});
});

describe("migration 3", () => {
	it("drops Tautulli instances and its cache, keeps everything else", () => {
		const db = new Database(":memory:");
		migrate(db, 2);
		db.prepare("INSERT INTO instances (id,name,type,url,api_key_enc,created_at) VALUES ('t','T','tautulli','http://t','x','now')").run();
		db.prepare("INSERT INTO instances (id,name,type,url,api_key_enc,created_at) VALUES ('p','P','plex','http://p','x','now')").run();

		migrate(db);

		expect(db.prepare("SELECT id FROM instances").all()).toEqual([{ id: "p" }]);
		expect(db.prepare("SELECT name FROM sqlite_master WHERE name='tautulli_guid_cache'").get()).toBeUndefined();
		expect(() => db.prepare("INSERT INTO instances (id,name,type,url,api_key_enc,created_at) VALUES ('t2','T','tautulli','http://t','x','now')").run()).toThrow(/CHECK/);
		expect(db.pragma("user_version", { simple: true })).toBe(3);
	});
});
