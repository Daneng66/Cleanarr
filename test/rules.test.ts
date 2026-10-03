import { describe, expect, it } from "vitest";
import { evaluateExpression, parseExpression, ExpressionError, requirements } from "../src/rules/expression.js";
import { normalizeItem } from "../src/arr/normalize.js";
import { passesFilters } from "../src/rules/filters.js";
import { safeRegex } from "../src/rules/regex.js";
import { DAY, GB, NOW, movie, series } from "./helpers.js";
import type { EvalContext } from "../src/rules/registry.js";
import type { RuleRecord, WatchInfo } from "../src/types.js";
import { describeTemplates, RULE_TEMPLATES } from "../src/rules/templates.js";
import { ruleCreate } from "../src/routes/schemas.js";

const maps = { tags: new Map([[1, "keep"]]), profiles: new Map([[1, "HD-1080p"]]) };
const item = (over = {}) => normalizeItem(movie(1, over), { instanceId: "i", service: "radarr", ...maps });
const ctx = (watch: EvalContext["watch"] = null, seerr: EvalContext["seerr"] = null): EvalContext => ({ now: NOW, watch, seerr, kidsMaxAge: 12 });
const ev = (expr: unknown, i = item(), c = ctx()) => evaluateExpression(parseExpression(expr), i, c);

describe("leaf rules", () => {
	it("age", () => {
		expect(ev({ type: "age", params: { operator: "older_than", days: 365 } }).state).toBe("true");
		expect(ev({ type: "age", params: { operator: "older_than", days: 500 } }).state).toBe("false");
	});
	it("age is unknown without an added date", () => {
		expect(ev({ type: "age", params: { operator: "older_than", days: 1 } }, item({ added: undefined })).state).toBe("unknown");
	});
	it("size, rating, genre, tags, path", () => {
		expect(ev({ type: "size", params: { operator: "greater_than", sizeGb: 5 } }).state).toBe("true");
		expect(ev({ type: "rating", params: { operator: "less_than", score: 6.5 } }).state).toBe("true");
		expect(ev({ type: "genre", params: { operator: "includes_any", genres: ["drama"] } }).state).toBe("true");
		expect(ev({ type: "tag_match", params: { operator: "includes_any", tags: ["keep"] } }, item({ tags: [1] })).state).toBe("true");
		expect(ev({ type: "file_path", params: { operator: "contains", value: "/movies/" } }).state).toBe("true");
	});
	it("file rules use file metadata and are unknown when files are not loaded", () => {
		expect(ev({ type: "video_codec", params: { codecs: ["x264"] } }).state).toBe("true");
		expect(ev({ type: "resolution", params: { operator: "at_most", lines: 720 } }).state).toBe("false");
		const s = normalizeItem(series(1), { instanceId: "i", service: "sonarr", ...maps });
		expect(ev({ type: "video_codec", params: { codecs: ["x264"] } }, s).state).toBe("unknown");
	});
	it("hdr_type treats missing HDR info as SDR", () => {
		expect(ev({ type: "hdr_type", params: { types: ["SDR"] } }).state).toBe("true");
	});
});

describe("three-valued logic", () => {
	const unknown = { type: "watch_count", params: { operator: "equals", count: 0 } }; // watch unavailable
	const t = { type: "monitored", params: {} };
	const f = { type: "unmonitored", params: {} };
	it("AND: false beats unknown; unknown beats true", () => {
		expect(ev({ op: "and", of: [f, unknown] }).state).toBe("false");
		expect(ev({ op: "and", of: [t, unknown] }).state).toBe("unknown");
	});
	it("OR: true beats unknown", () => {
		expect(ev({ op: "or", of: [t, unknown] }).state).toBe("true");
		expect(ev({ op: "or", of: [f, unknown] }).state).toBe("unknown");
	});
	it("NOT keeps unknown unknown", () => {
		expect(ev({ op: "not", of: unknown }).state).toBe("unknown");
		expect(ev({ op: "not", of: f }).state).toBe("true");
	});
	it("explains matches in the reason", () => {
		const r = ev({ op: "and", of: [{ type: "age", params: { operator: "older_than", days: 100 } }, { type: "size", params: { operator: "greater_than", sizeGb: 1 } }] });
		expect(r.reason).toContain("AND");
	});
});

describe("watch rules", () => {
	const w = (info?: WatchInfo) => ctx(() => info);
	const notWatched = { type: "last_watched", params: { operator: "not_watched_in_days", days: 90 } };
	it("matches when last watch is old", () => {
		expect(ev(notWatched, item(), w({ lastWatchedAt: new Date(NOW.getTime() - 200 * DAY), watchCount: 2, watchedBy: [] })).state).toBe("true");
		expect(ev(notWatched, item(), w({ lastWatchedAt: new Date(NOW.getTime() - 10 * DAY), watchCount: 2, watchedBy: [] })).state).toBe("false");
	});
	it("never-watched only matches if the item has been in the library longer than the window", () => {
		expect(ev(notWatched, item(), w(undefined)).state).toBe("true");
		const fresh = item({ added: new Date(NOW.getTime() - 5 * DAY).toISOString() });
		expect(ev(notWatched, fresh, w(undefined)).state).toBe("false");
	});
	it("unavailable watch data or unmatched ids is unknown, never 'unwatched'", () => {
		expect(ev(notWatched, item(), ctx(null)).state).toBe("unknown");
		expect(ev(notWatched, item({ tmdbId: undefined }), w(undefined)).state).toBe("unknown");
	});
	it("watched_by", () => {
		const c = w({ lastWatchedAt: null, watchCount: 1, watchedBy: ["Alice"] });
		expect(ev({ type: "watched_by", params: { operator: "watched_by_any", users: ["alice"] } }, item(), c).state).toBe("true");
	});
});

describe("expression validation", () => {
	it("rejects unknown types, bad params, empty groups and over-deep trees", () => {
		expect(() => parseExpression({ type: "nope", params: {} })).toThrow(ExpressionError);
		expect(() => parseExpression({ type: "age", params: { operator: "older_than", days: 0 } })).toThrow(/days/);
		expect(() => parseExpression({ op: "and", of: [] })).toThrow();
		let deep: unknown = { type: "monitored", params: {} };
		for (let i = 0; i < 10; i++) deep = { op: "not", of: deep };
		expect(() => parseExpression(deep)).toThrow(/deeper/);
	});
	it("reports data requirements", () => {
		expect(requirements(parseExpression({ op: "or", of: [{ type: "video_codec", params: { codecs: ["x264"] } }, { type: "watch_count", params: { operator: "equals", count: 0 } }] }))).toEqual({ files: true, watch: true, seerr: false });
	});
	it("rejects catastrophic regexes", () => {
		expect(safeRegex("(a+)+$")).toBeNull();
		expect(safeRegex("^Movie \\d+$")).not.toBeNull();
		expect(() => parseExpression({ type: "file_path", params: { operator: "matches", value: "(a+)+" } })).toThrow();
	});
});

describe("filters", () => {
	const base: RuleRecord = { id: "r", name: "r", enabled: true, priority: 0, mode: "cleanup", action: "delete", expression: {}, serviceFilter: null, instanceFilter: null, excludeTags: null, excludeTitles: null };
	it("excludes by tag label, title pattern, service and instance", () => {
		const tagged = item({ tags: [1] });
		expect(passesFilters(tagged, { ...base, excludeTags: ["KEEP"] }).ok).toBe(false);
		expect(passesFilters(item(), { ...base, excludeTitles: ["^Movie 1$"] }).ok).toBe(false);
		expect(passesFilters(item(), { ...base, serviceFilter: ["sonarr"] }).ok).toBe(false);
		expect(passesFilters(item(), { ...base, instanceFilter: ["other"] }).ok).toBe(false);
		expect(passesFilters(item(), base).ok).toBe(true);
	});
	it("fails closed on an unsafe exclude pattern", () => {
		expect(passesFilters(item(), { ...base, excludeTitles: ["(a+)+"] }).ok).toBe(false);
	});
});

describe("normalize", () => {
	it("derives size, rating and sonarr stats", () => {
		const s = normalizeItem(series(5), { instanceId: "i", service: "sonarr", ...maps });
		expect(s.sizeOnDisk).toBe(40 * GB);
		expect(s.rating).toBe(7.5);
		expect(s.files).toBeNull();
		expect(s.kind).toBe("series");
	});
});

import type { SeerrRequest } from "../src/seerr/seerr.js";
describe("seerr rules", () => {
	const req = (over: Partial<SeerrRequest> = {}): SeerrRequest => ({ id: 1, status: 2, createdAt: new Date(NOW.getTime() - 200 * DAY), updatedAt: NOW, is4k: false, requesters: ["Alice", "alice@example.com"], ...over });
	const s = (reqs: SeerrRequest[]) => ctx(null, () => reqs);
	it("is_requested / not_requested", () => {
		expect(ev({ type: "seerr_is_requested", params: { operator: "not_requested" } }, item(), s([])).state).toBe("true");
		expect(ev({ type: "seerr_is_requested", params: { operator: "is_requested" } }, item(), s([req()])).state).toBe("true");
	});
	it("requested_by matches any known alias", () => {
		expect(ev({ type: "seerr_requested_by", params: { operator: "any_of", users: ["ALICE@example.com"] } }, item(), s([req()])).state).toBe("true");
		expect(ev({ type: "seerr_requested_by", params: { operator: "none_of", users: ["bob"] } }, item(), s([req()])).state).toBe("true");
	});
	it("request_age uses the newest request; never requested never matches", () => {
		const p = { type: "seerr_request_age", params: { operator: "older_than", days: 100 } };
		expect(ev(p, item(), s([req()])).state).toBe("true");
		expect(ev(p, item(), s([req(), req({ id: 2, createdAt: new Date(NOW.getTime() - 5 * DAY) })])).state).toBe("false");
		expect(ev(p, item(), s([])).state).toBe("false");
	});
	it("request_count", () => {
		expect(ev({ type: "seerr_request_count", params: { operator: "greater_than", count: 1 } }, item(), s([req(), req({ id: 2 })])).state).toBe("true");
	});
	it("unavailable Seerr or unmatched ids is unknown, never 'not requested'", () => {
		const p = { type: "seerr_is_requested", params: { operator: "not_requested" } };
		expect(ev(p, item(), ctx(null, null)).state).toBe("unknown");
		expect(ev(p, item({ tmdbId: undefined }), s([])).state).toBe("unknown");
	});
	describe("requester_watched (cross-service)", () => {
		const watch = (users: string[]) => () => ({ lastWatchedAt: NOW, watchCount: users.length, watchedBy: users });
		const p = (operator: string) => ({ type: "seerr_requester_watched", params: { operator } });
		it("true when the requester appears in watch history", () => {
			expect(ev(p("requester_watched"), item(), ctx(watch(["alice"]), () => [req()])).state).toBe("true");
			expect(ev(p("requester_not_watched"), item(), ctx(watch(["bob"]), () => [req()])).state).toBe("true");
			expect(ev(p("requester_not_watched"), item(), ctx(watch(["alice"]), () => [req()])).state).toBe("false");
		});
		it("no request never matches either way; missing evidence is unknown", () => {
			expect(ev(p("requester_not_watched"), item(), ctx(watch([]), () => [])).state).toBe("false");
			expect(ev(p("requester_watched"), item(), ctx(watch([]), () => [])).state).toBe("false");
			expect(ev(p("requester_not_watched"), item(), ctx(null, () => [req()])).state).toBe("unknown");
			expect(ev(p("requester_not_watched"), item(), ctx(watch([]), null)).state).toBe("unknown");
		});
		it("a requester with no name to match is unknown, not 'not watched'", () => {
			expect(ev(p("requester_not_watched"), item(), ctx(watch(["x"]), () => [req({ requesters: [] })])).state).toBe("unknown");
		});
		it("requires both providers", () => {
			expect(requirements(parseExpression(p("requester_watched")))).toEqual({ files: false, watch: true, seerr: true });
		});
	});
});

describe("content rating", () => {
	const kids = RULE_TEMPLATES.find((x) => x.id === "protect-kids")!.expression;
	it("matches listed ratings case-insensitively and is unknown without one", () => {
		expect(ev({ type: "certification", params: { operator: "includes_any", ratings: ["pg"] } }, item({ certification: "PG" })).state).toBe("true");
		expect(ev({ type: "certification", params: { operator: "includes_any", ratings: ["G", "PG"] } }, item({ certification: "PG-13" })).state).toBe("false");
		expect(ev({ type: "certification", params: { operator: "excludes_all", ratings: ["R"] } }, item({ certification: "PG" })).state).toBe("true");
		expect(ev({ type: "certification", params: { operator: "includes_any", ratings: ["G"] } }, item({ certification: undefined })).state).toBe("unknown");
	});
	it("suitable_for_kids understands children's ratings from other countries, including 12s, never PG-13/A", () => {
		const k = (cert: string) => ev({ type: "certification", params: { operator: "suitable_for_kids" } }, item({ certification: cert })).state;
		for (const c of ["G", "PG", "U", "FSK 6", "6", "AL", "TV-Y7", "tv-g", "Btl", "L", "12", "12A", "12a", "12+", "-12", "FSK 12"]) expect(k(c), c).toBe("true");
		for (const c of ["PG-13", "A", "R", "15", "TV-PG", "TV-MA", "FSK 16", "-16", "MA15+"]) expect(k(c), c).toBe("false");
		expect(() => parseExpression({ type: "certification", params: { operator: "includes_any" } })).toThrow();
	});
	it("suitable_for_kids follows the configured max age", () => {
		const k = (cert: string, kidsMaxAge: number) => evaluateExpression(parseExpression({ type: "certification", params: { operator: "suitable_for_kids" } }), item({ certification: cert }), { ...ctx(), kidsMaxAge }).state;
		expect([k("PG", 0), k("G", 0), k("PG-13", 13), k("TV-14", 13), k("TV-14", 14), k("FSK 16", 16), k("NR", 18)]).toEqual(["false", "true", "true", "false", "true", "true", "false"]);
	});
	it("kids template: a children's rating protects, PG-13, R and no rating do not", () => {
		expect(ev(kids, item({ certification: "PG" })).state).toBe("true");
		expect(ev(kids, item({ certification: "PG-13", genres: ["Family"] })).state).toBe("false");
		expect(ev(kids, item({ certification: "R" })).state).toBe("false");
		expect(ev(kids, item({ certification: undefined })).state).toBe("false");
	});
	it("kids shows template: TV-Y7 protects, TV-PG and TV-MA do not", () => {
		const shows = RULE_TEMPLATES.find((x) => x.id === "protect-kids-shows")!.expression;
		const show = (over = {}) => normalizeItem(series(1, over), { instanceId: "i", service: "sonarr", ...maps });
		expect(ev(shows, show({ certification: "TV-Y7", genres: ["Animation"] })).state).toBe("true");
		expect(ev(shows, show({ certification: "TV-PG", genres: ["Children"] })).state).toBe("false");
		expect(ev(shows, show({ certification: "TV-MA", genres: ["Drama"] })).state).toBe("false");
	});
});

describe("rule templates", () => {
	it("every template is a valid rule as the create API would accept it", () => {
		for (const t of RULE_TEMPLATES) expect(() => ruleCreate.parse({ name: t.title, mode: t.mode, action: t.action, expression: t.expression, serviceFilter: t.serviceFilter ?? null }), t.id).not.toThrow();
	});
	it("has unique ids and says what each one needs", () => {
		expect(new Set(RULE_TEMPLATES.map((t) => t.id)).size).toBe(RULE_TEMPLATES.length);
		const byId = Object.fromEntries(describeTemplates().map((t) => [t.id, t.needs]));
		expect(byId.stale).toMatchObject({ watch: true, seerr: false });
		expect(byId["requester-done"]).toMatchObject({ watch: true, seerr: true });
		expect(byId["protect-keep-tag"]).toMatchObject({ watch: false, seerr: false });
	});
});

describe("schedule", () => {
	it("computes next run by days/weeks/months at a time, clamping month ends", async () => {
		const { nextRun } = await import("../src/schedule.js");
		const s = (intervalEvery: number, intervalUnit: "days" | "weeks" | "months") => ({ intervalEvery, intervalUnit, runTime: "04:30" });
		expect(nextRun(new Date(2026, 0, 31, 9), s(1, "months")).getTime()).toBe(new Date(2026, 1, 28, 4, 30).getTime());
		expect(nextRun(new Date(2026, 0, 1, 9), s(2, "weeks")).getTime()).toBe(new Date(2026, 0, 15, 4, 30).getTime());
		expect(nextRun(new Date(2026, 0, 1, 9), s(3, "days")).getTime()).toBe(new Date(2026, 0, 4, 4, 30).getTime());
	});
});
