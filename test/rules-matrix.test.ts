import { describe, expect, it } from "vitest";
import { ExpressionError, MAX_DEPTH, MAX_NODES, evaluateExpression, matchedReasons, parseExpression, requirements, usesType } from "../src/rules/expression.js";
import { RULE_TYPES, describeRuleTypes, type EvalContext, type Tri } from "../src/rules/registry.js";
import { firstAction, servicesOf, slotOf, toActions } from "../src/rules/actions.js";
import { passesFilters } from "../src/rules/filters.js";
import { getRegexError, safeRegex } from "../src/rules/regex.js";
import { DAY, GB, NOW, movie, old, setup } from "./helpers.js";
import type { FileInfo, LibraryItem, RuleRecord, WatchInfo } from "../src/types.js";
import type { SeerrRequest } from "../src/seerr/seerr.js";

// ── Builders ────────────────────────────────────────────────────────────────

const ago = (days: number) => new Date(NOW.getTime() - days * DAY);
const file = (over: Partial<FileInfo> = {}): FileInfo => ({
	id: 1, path: "/movies/Movie 1/file.mkv", size: 10 * GB, dateAdded: null, quality: "Bluray-1080p", resolution: 1080,
	videoCodec: "x264", audioCodec: "AAC", audioChannels: 2, hdr: null, releaseGroup: "GRP", customFormatScore: 0, languages: ["English"], ...over,
});
const base = (over: Partial<LibraryItem> = {}): LibraryItem => ({
	instanceId: "i", service: "radarr", arrId: 1, kind: "movie", title: "Movie 1", year: 2015, monitored: true, hasFile: true, status: "released",
	qualityProfileId: 1, qualityProfileName: "HD-1080p", sizeOnDisk: 10 * GB, added: ago(400), genres: ["Drama"], certification: "PG",
	tags: ["keep"], rating: 6.1, imdbRating: 6.0, runtime: 110, path: "/movies/Movie 1", originalLanguage: "English",
	tmdbId: 1001, tvdbId: null, imdbId: "tt1", files: [file()], fileCount: 1, poster: null, ...over,
});
type Ep = { number: number; airDate: Date | null; added: Date | null; hasFile: boolean };
const ep = (number: number, over: Partial<Ep> = {}): Ep => ({ number, airDate: ago(300), added: ago(200), hasFile: true, ...over });
const season = (episodes: Ep[], over: Partial<LibraryItem> = {}): LibraryItem =>
	base({ service: "sonarr", kind: "season", title: "Show 1", status: "ended", tmdbId: 3001, tvdbId: 2001, files: null, season: { number: 1, episodes }, ...over });

const ctx = (watch: EvalContext["watch"] = null, seerr: EvalContext["seerr"] = null, kidsMaxAge = 12): EvalContext => ({ now: NOW, watch, seerr, kidsMaxAge });
const watchInfo = (over: Partial<WatchInfo> = {}): WatchInfo => ({ lastWatchedAt: null, watchCount: 0, watchedBy: [], ...over });
const withWatch = (w?: Partial<WatchInfo> | null, seerr: EvalContext["seerr"] = null) => ctx(() => (w === null ? undefined : watchInfo(w)), seerr);
const request = (over: Partial<SeerrRequest> = {}): SeerrRequest => ({ id: 1, status: 2, createdAt: ago(200), updatedAt: NOW, is4k: false, requesters: ["Alice"], ...over });
const withSeerr = (reqs: SeerrRequest[], watch: EvalContext["watch"] = null) => ctx(watch, () => reqs);

const ev = (expr: unknown, item = base(), c = ctx()) => evaluateExpression(parseExpression(expr), item, c);
const st = (expr: unknown, item = base(), c = ctx()): Tri => ev(expr, item, c).state;

// Three leaves with a fixed outcome on `base()` under `ctx()`.
const T = { type: "monitored", params: {} };
const F = { type: "unmonitored", params: {} };
const U = { type: "watch_count", params: { operator: "equals", count: 0 } }; // watch provider unavailable
const TRI: Array<[string, Tri, unknown]> = [["T", "true", T], ["F", "false", F], ["U", "unknown", U]];

// ── Three-valued logic: exhaustive ──────────────────────────────────────────

describe("three-valued logic, exhaustive", () => {
	it("the fixed leaves really are true / false / unknown", () => {
		expect([st(T), st(F), st(U)]).toEqual(["true", "false", "unknown"]);
	});

	const refAnd = (s: Tri[]): Tri => (s.includes("false") ? "false" : s.includes("unknown") ? "unknown" : "true");
	const refOr = (s: Tri[]): Tri => (s.includes("true") ? "true" : s.includes("unknown") ? "unknown" : "false");
	const refNot = (s: Tri): Tri => (s === "unknown" ? "unknown" : s === "true" ? "false" : "true");

	// Every ordered combination of 1–3 operands.
	const combos: Array<typeof TRI> = [];
	for (const a of TRI) {
		combos.push([a]);
		for (const b of TRI) {
			combos.push([a, b]);
			for (const c of TRI) combos.push([a, b, c]);
		}
	}

	it("AND over every combination of 1–3 operands", () => {
		for (const k of combos) {
			const got = st({ op: "and", of: k.map((x) => x[2]) });
			expect(got, `AND(${k.map((x) => x[0]).join(",")})`).toBe(refAnd(k.map((x) => x[1])));
		}
	});
	it("OR over every combination of 1–3 operands", () => {
		for (const k of combos) {
			const got = st({ op: "or", of: k.map((x) => x[2]) });
			expect(got, `OR(${k.map((x) => x[0]).join(",")})`).toBe(refOr(k.map((x) => x[1])));
		}
	});
	it("NOT over each state", () => {
		for (const [n, s, e] of TRI) expect(st({ op: "not", of: e }), `NOT(${n})`).toBe(refNot(s));
	});
	it("operand order never changes the result", () => {
		for (const k of combos.filter((c) => c.length === 3)) {
			const rev = [...k].reverse();
			for (const op of ["and", "or"] as const) {
				expect(st({ op, of: k.map((x) => x[2]) })).toBe(st({ op, of: rev.map((x) => x[2]) }));
			}
		}
	});
	it("a single-operand group is that operand", () => {
		for (const [, , e] of TRI) {
			expect(st({ op: "and", of: [e] })).toBe(st(e));
			expect(st({ op: "or", of: [e] })).toBe(st(e));
		}
	});
	it("double negation is the identity, triple is a single NOT", () => {
		for (const [, , e] of TRI) {
			expect(st({ op: "not", of: { op: "not", of: e } })).toBe(st(e));
			expect(st({ op: "not", of: { op: "not", of: { op: "not", of: e } } })).toBe(st({ op: "not", of: e }));
		}
	});
	it("De Morgan holds in all nine pairs (unknown included)", () => {
		for (const [an, , a] of TRI)
			for (const [bn, , b] of TRI) {
				const not = (x: unknown) => ({ op: "not", of: x });
				expect(st(not({ op: "and", of: [a, b] })), `¬(${an}∧${bn})`).toBe(st({ op: "or", of: [not(a), not(b)] }));
				expect(st(not({ op: "or", of: [a, b] })), `¬(${an}∨${bn})`).toBe(st({ op: "and", of: [not(a), not(b)] }));
			}
	});
	it("AND/OR distribute over each other for every triple", () => {
		for (const [, , a] of TRI)
			for (const [, , b] of TRI)
				for (const [, , c] of TRI) {
					expect(st({ op: "and", of: [a, { op: "or", of: [b, c] }] })).toBe(st({ op: "or", of: [{ op: "and", of: [a, b] }, { op: "and", of: [a, c] }] }));
					expect(st({ op: "or", of: [a, { op: "and", of: [b, c] }] })).toBe(st({ op: "and", of: [{ op: "or", of: [a, b] }, { op: "or", of: [a, c] }] }));
				}
	});
	it("an unknown anywhere in an AND of otherwise-true leaves is unknown, never true", () => {
		expect(st({ op: "and", of: [T, T, T, U, T] })).toBe("unknown");
		expect(st({ op: "and", of: [T, { op: "or", of: [F, U] }] })).toBe("unknown");
	});
	it("a deeply nested false still wins over unknowns above it", () => {
		expect(st({ op: "and", of: [U, { op: "or", of: [U, { op: "and", of: [T, F] }] }, T] })).toBe("unknown"); // OR(U, F) = U
		expect(st({ op: "and", of: [U, { op: "and", of: [T, F] }] })).toBe("false");
	});
});

// ── Reasons and matched reasons ─────────────────────────────────────────────

describe("reasons", () => {
	it("AND joins every reason, OR keeps only the true branches", () => {
		expect(ev({ op: "and", of: [T, { op: "not", of: F }] }).reason).toBe("(Item is monitored AND NOT (Item is unmonitored))");
		expect(ev({ op: "or", of: [F, T] }).reason).toBe("Item is monitored");
		expect(ev({ op: "or", of: [F, F] }).reason).toBe("(Item is unmonitored OR Item is unmonitored)");
	});
	it("evaluation nodes record their children, operator and leaf type", () => {
		const n = ev({ op: "and", of: [T, { op: "not", of: F }] });
		expect(n.op).toBe("and");
		expect(n.children?.map((c) => c.op ?? c.type)).toEqual(["monitored", "not"]);
		expect(n.children?.[1]?.children?.[0]?.type).toBe("unmonitored");
	});
	it("matchedReasons is empty unless the whole node is true", () => {
		expect(matchedReasons(ev({ op: "and", of: [T, F] }))).toEqual([]);
		expect(matchedReasons(ev({ op: "and", of: [T, U] }))).toEqual([]);
		expect(matchedReasons(ev(F))).toEqual([]);
	});
	it("matchedReasons flattens nested groups, drops false OR branches and treats NOT as one entry", () => {
		const e = { op: "and", of: [T, { op: "or", of: [F, { type: "size", params: { operator: "greater_than", sizeGb: 1 } }] }, { op: "not", of: F }] };
		expect(matchedReasons(ev(e)).map((m) => m.type)).toEqual(["monitored", "size", "not"]);
	});
	it("an OR with two true branches reports both", () => {
		expect(matchedReasons(ev({ op: "or", of: [T, { type: "size", params: { operator: "greater_than", sizeGb: 1 } }, F] })).map((m) => m.type)).toEqual(["monitored", "size"]);
	});
	it("an unregistered rule type evaluates to unknown rather than throwing", () => {
		const n = evaluateExpression({ type: "ghost", params: {} }, base(), ctx());
		expect(n.state).toBe("unknown");
		expect(n.reason).toMatch(/Unknown rule type ghost/);
	});
});

// ── Parsing and structural limits ───────────────────────────────────────────

describe("expression structure", () => {
	const chain = (nots: number, leaf: unknown = T) => {
		let e: unknown = leaf;
		for (let i = 0; i < nots; i++) e = { op: "not", of: e };
		return e;
	};
	it("accepts nesting up to the depth limit and rejects one level more", () => {
		expect(() => parseExpression(chain(MAX_DEPTH - 1))).not.toThrow();
		expect(() => parseExpression(chain(MAX_DEPTH))).toThrow(/deeper/);
	});
	it("accepts exactly MAX_NODES nodes and rejects one more", () => {
		const leaves = (n: number) => Array.from({ length: n }, () => T);
		expect(() => parseExpression({ op: "and", of: leaves(MAX_NODES - 1) })).not.toThrow(); // group + leaves = MAX_NODES
		expect(() => parseExpression({ op: "and", of: leaves(MAX_NODES) })).toThrow(/nodes/);
	});
	it.each([
		["null", null],
		["a string", "age"],
		["an array", [T]],
		["an empty object", {}],
		["an unknown operator", { op: "xor", of: [T] }],
		["an empty AND", { op: "and", of: [] }],
		["an empty OR", { op: "or", of: [] }],
		["AND with a non-array", { op: "and", of: T }],
		["NOT with an array", { op: "not", of: [T] }],
		["NOT without a child", { op: "not" }],
		["a group containing garbage", { op: "or", of: [T, 5] }],
		["an unknown type", { type: "teleport", params: {} }],
	])("rejects %s", (_n, raw) => {
		expect(() => parseExpression(raw)).toThrow(ExpressionError);
	});
	it("reports every problem, not just the first, with a path", () => {
		try {
			parseExpression({ op: "and", of: [{ type: "nope", params: {} }, { type: "age", params: { operator: "older_than", days: 0 } }] });
			expect.unreachable();
		} catch (e) {
			expect(e).toBeInstanceOf(ExpressionError);
			expect((e as ExpressionError).issues.length).toBeGreaterThanOrEqual(2);
			expect((e as ExpressionError).issues.join("|")).toMatch(/\$\.of\[0\].*nope/);
			expect((e as ExpressionError).issues.join("|")).toMatch(/\$\.of\[1\]\(age\)\.days/);
		}
	});
	it("treats missing params as an empty object, so parameterless types parse", () => {
		expect(parseExpression({ type: "monitored" })).toEqual({ type: "monitored", params: {} });
		expect(() => parseExpression({ type: "age" })).toThrow();
	});
	it("returns a normalised tree: zod defaults applied and unknown keys dropped", () => {
		expect(parseExpression({ type: "seerr_requester_watched", params: { junk: 1 } })).toEqual({ type: "seerr_requester_watched", params: { operator: "requester_watched" } });
	});
	it("usesType finds a type at any depth", () => {
		const e = parseExpression({ op: "and", of: [T, { op: "not", of: { op: "or", of: [F, { type: "genre", params: { operator: "includes_any", genres: ["x"] } }] } }] });
		expect(usesType(e, "genre")).toBe(true);
		expect(usesType(e, "age")).toBe(false);
	});
});

describe("requirements", () => {
	const req = (...exprs: unknown[]) => requirements(parseExpression(exprs.length === 1 ? exprs[0] : { op: "and", of: exprs }));
	it("library-only rules need nothing", () => {
		expect(req(T)).toEqual({ files: false, watch: false, seerr: false });
		expect(req({ type: "genre", params: { operator: "includes_any", genres: ["x"] } })).toEqual({ files: false, watch: false, seerr: false });
	});
	it("each need maps to the right providers", () => {
		expect(req({ type: "video_codec", params: { codecs: ["x264"] } })).toEqual({ files: true, watch: false, seerr: false });
		expect(req({ type: "last_watched", params: { operator: "watched_within_days", days: 1 } })).toEqual({ files: false, watch: true, seerr: false });
		expect(req({ type: "seerr_is_requested", params: { operator: "is_requested" } })).toEqual({ files: false, watch: false, seerr: true });
		expect(req({ type: "seerr_requester_watched", params: {} })).toEqual({ files: false, watch: true, seerr: true });
		expect(req({ type: "stale_unwatched_episode", params: { days: 30 } })).toEqual({ files: true, watch: true, seerr: false });
	});
	it("combinations are the union, whatever the nesting or negation", () => {
		const e = { op: "or", of: [{ op: "not", of: { type: "audio_codec", params: { codecs: ["aac"] } } }, { op: "and", of: [T, { type: "seerr_request_count", params: { operator: "equals", count: 0 } }] }] };
		expect(req(e)).toEqual({ files: true, watch: false, seerr: true });
		expect(req(e, { type: "watch_count", params: { operator: "equals", count: 0 } })).toEqual({ files: true, watch: true, seerr: true });
	});
});

// ── Registry completeness ───────────────────────────────────────────────────

/** One valid parameter set per registered type. A new type without an entry fails the completeness test. */
const VALID: Record<string, Record<string, unknown>> = {
	age: { operator: "older_than", days: 30 },
	size: { operator: "greater_than", sizeGb: 1 },
	rating: { operator: "less_than", score: 5 },
	imdb_rating: { operator: "unrated" },
	status: { statuses: ["ended"] },
	monitored: {},
	no_monitored_seasons: {},
	unmonitored: {},
	genre: { operator: "includes_any", genres: ["drama"] },
	certification: { operator: "suitable_for_kids" },
	year_range: { minYear: 2000 },
	no_file: {},
	quality_profile: { profiles: ["HD-1080p"] },
	language: { operator: "is", languages: ["English"] },
	tag_match: { operator: "includes_any", tags: ["keep"] },
	file_path: { operator: "contains", value: "movies" },
	runtime: { operator: "less_than", minutes: 90 },
	resolution: { operator: "at_most", lines: 720 },
	video_codec: { codecs: ["x264"] },
	audio_codec: { codecs: ["aac"] },
	audio_channels: { operator: "greater_than", channels: 2 },
	hdr_type: { types: ["SDR"] },
	custom_format_score: { operator: "greater_than", score: 0 },
	release_group: { groups: ["GRP"] },
	last_watched: { operator: "not_watched_in_days", days: 30 },
	watch_count: { operator: "equals", count: 0 },
	watched_by: { operator: "watched_by_any", users: ["alice"] },
	stale_unwatched_episode: { days: 30 },
	seerr_is_requested: { operator: "is_requested" },
	seerr_requested_by: { operator: "any_of", users: ["alice"] },
	seerr_request_age: { operator: "older_than", days: 30 },
	seerr_request_count: { operator: "greater_than", count: 0 },
	seerr_requester_watched: {},
	season_requester_watched: {},
	watched_by_others: {},
};

describe("registry", () => {
	it("every registered rule type has a valid example here (add one when you add a type)", () => {
		expect(Object.keys(VALID).sort()).toEqual([...RULE_TYPES.keys()].sort());
	});
	it("every example parses and evaluates to a three-valued state on every kind of item", () => {
		const items = [
			base(), base({ files: null }), base({ files: [] }), base({ tmdbId: null, tvdbId: null }),
			season([ep(1), ep(2)]), season([]), base({ service: "sonarr", kind: "series", monitoredSeasons: 0, files: null }),
		];
		const contexts = [ctx(), withWatch(), withWatch({ watchCount: 3, watchedBy: ["Alice"], lastWatchedAt: ago(5) }, () => [request()]), withSeerr([])];
		for (const type of RULE_TYPES.keys())
			for (const item of items)
				for (const c of contexts) {
					const s = evaluateExpression(parseExpression({ type, params: VALID[type] }), item, c).state;
					expect(["true", "false", "unknown"], `${type}`).toContain(s);
				}
	});
	it("the description exposed to the editor lists every type with a group and its fields", () => {
		const d = describeRuleTypes();
		expect(d.map((x) => x.type).sort()).toEqual([...RULE_TYPES.keys()].sort());
		for (const x of d) {
			expect(x.label, x.type).toBeTruthy();
			expect(["Library", "File", "Watch history", "Requests"], x.type).toContain(x.group);
			for (const f of x.fields) expect(f.name && f.label, x.type).toBeTruthy();
		}
	});
	it("file-metadata rules are unknown, never false, while file details are not loaded", () => {
		for (const [type, def] of RULE_TYPES) {
			if (def.group !== "File") continue;
			expect(st({ type, params: VALID[type] }, base({ files: null })), type).toBe("unknown");
		}
	});
	it("watch rules are unknown when the watch provider is unavailable, or the item has no ids", () => {
		for (const [type, def] of RULE_TYPES) {
			if (!def.needs?.includes("watch")) continue;
			const c = def.needs.includes("seerr") ? ctx(null, () => [request()]) : ctx(null);
			expect(st({ type, params: VALID[type] }, season([ep(1)]), c), `${type} (no provider)`).toBe("unknown");
			const open = def.needs.includes("seerr") ? ctx(() => watchInfo(), () => [request()]) : withWatch({});
			expect(st({ type, params: VALID[type] }, season([ep(1)], { tmdbId: null, tvdbId: null }), open), `${type} (no ids)`).toBe("unknown");
		}
	});
	it("request rules are unknown when Seerr is unavailable, or the item has no ids", () => {
		for (const [type, def] of RULE_TYPES) {
			if (!def.needs?.includes("seerr")) continue;
			const c = def.needs.includes("watch") ? ctx(() => watchInfo(), null) : ctx(null, null);
			expect(st({ type, params: VALID[type] }, season([ep(1)]), c), `${type} (no provider)`).toBe("unknown");
			const open = ctx(() => watchInfo(), () => [request()]);
			expect(st({ type, params: VALID[type] }, season([ep(1)], { tmdbId: null, tvdbId: null }), open), `${type} (no ids)`).toBe("unknown");
		}
	});
});

describe("parameter validation per type", () => {
	const bad = (type: string, params: unknown) => expect(() => parseExpression({ type, params }), `${type} ${JSON.stringify(params)}`).toThrow(ExpressionError);
	const good = (type: string, params: unknown) => expect(() => parseExpression({ type, params }), `${type} ${JSON.stringify(params)}`).not.toThrow();
	it("numeric thresholds: bounds and integer-ness", () => {
		bad("age", { operator: "older_than", days: 0 });
		bad("age", { operator: "older_than", days: 1.5 });
		bad("age", { operator: "older_than", days: "30" });
		bad("age", { operator: "sideways", days: 5 });
		bad("age", { days: 5 });
		good("age", { operator: "newer_than", days: 1 });
		bad("size", { operator: "greater_than", sizeGb: 0 });
		bad("size", { operator: "greater_than", sizeGb: -2 });
		good("size", { operator: "less_than", sizeGb: 0.5 });
		bad("runtime", { operator: "greater_than", minutes: 0 });
		bad("watch_count", { operator: "equals", count: -1 });
		bad("watch_count", { operator: "equals", count: 1.5 });
		good("watch_count", { operator: "less_than", count: 0 });
		bad("last_watched", { operator: "not_watched_in_days", days: 0 });
		bad("seerr_request_count", { operator: "equals", count: -1 });
		bad("resolution", { operator: "equals", lines: 0 });
		bad("stale_unwatched_episode", { days: 0 });
	});
	it("ratings: 0–10, and a score unless unrated", () => {
		bad("rating", { operator: "less_than" });
		bad("rating", { operator: "greater_than", score: 11 });
		bad("rating", { operator: "greater_than", score: -1 });
		good("rating", { operator: "greater_than", score: 0 });
		good("rating", { operator: "less_than", score: 10 });
		good("rating", { operator: "unrated" });
		bad("imdb_rating", { operator: "greater_than" });
		good("imdb_rating", { operator: "unrated" });
	});
	it("list parameters must be non-empty lists of non-empty strings", () => {
		for (const [type, key, extra] of [
			["genre", "genres", { operator: "includes_any" }], ["tag_match", "tags", { operator: "excludes_all" }], ["status", "statuses", {}],
			["video_codec", "codecs", {}], ["audio_codec", "codecs", {}], ["hdr_type", "types", {}], ["release_group", "groups", {}],
			["quality_profile", "profiles", {}], ["language", "languages", { operator: "is" }], ["watched_by", "users", { operator: "watched_by_any" }],
			["seerr_requested_by", "users", { operator: "any_of" }],
		] as const) {
			bad(type, { ...extra, [key]: [] });
			bad(type, { ...extra, [key]: [""] });
			bad(type, { ...extra, [key]: "drama" });
			bad(type, extra);
			good(type, { ...extra, [key]: ["x"] });
		}
	});
	it("certification needs ratings unless it's the kids check", () => {
		bad("certification", { operator: "includes_any" });
		bad("certification", { operator: "excludes_all", ratings: [] });
		good("certification", { operator: "suitable_for_kids" });
		good("certification", { operator: "excludes_all", ratings: ["R"] });
	});
	it("year_range needs at least one bound", () => {
		bad("year_range", {});
		bad("year_range", { minYear: 1999.5 });
		good("year_range", { minYear: 1999 });
		good("year_range", { maxYear: 2005 });
		good("year_range", { minYear: 1990, maxYear: 2005 });
	});
	it("file_path regexes are validated at parse time, plain operators are not", () => {
		bad("file_path", { operator: "matches", value: "(a+)+$" });
		bad("file_path", { operator: "matches", value: "(" });
		bad("file_path", { operator: "matches", value: "x".repeat(201) });
		bad("file_path", { operator: "contains", value: "" });
		good("file_path", { operator: "contains", value: "(a+)+" });
		good("file_path", { operator: "matches", value: "^/movies/.+" });
	});
	it("requester rules default the operator and accept an optional user list", () => {
		good("seerr_requester_watched", {});
		good("seerr_requester_watched", { operator: "requester_not_watched", users: ["alice"] });
		bad("seerr_requester_watched", { operator: "someone" });
		bad("seerr_requester_watched", { users: [] });
		good("season_requester_watched", { users: ["alice"] });
		good("watched_by_others", {});
	});
});

// ── Leaf rules: boundaries and operator matrices ────────────────────────────

describe("library leaf rules", () => {
	describe("age", () => {
		const age = (operator: string, days: number, item = base({ added: ago(100) })) => st({ type: "age", params: { operator, days } }, item);
		it("is strict at the boundary in both directions", () => {
			expect([age("older_than", 99), age("older_than", 100), age("older_than", 101)]).toEqual(["true", "false", "false"]);
			expect([age("newer_than", 99), age("newer_than", 100), age("newer_than", 101)]).toEqual(["false", "false", "true"]);
		});
		it("never matches when nothing is downloaded, whatever the date", () => {
			expect(age("older_than", 1, base({ hasFile: false }))).toBe("false");
			expect(age("newer_than", 9999, base({ hasFile: false }))).toBe("false");
		});
		it("is unknown without an added date", () => {
			expect(age("older_than", 1, base({ added: null }))).toBe("unknown");
		});
		it("counts whole days, so a few hours short of a day is still the earlier day", () => {
			const i = base({ added: new Date(NOW.getTime() - 100 * DAY + 3_600_000) });
			expect(age("older_than", 99, i)).toBe("false"); // 99 whole days
			expect(age("older_than", 98, i)).toBe("true");
		});
	});

	it("size: strict thresholds in GB", () => {
		const sz = (operator: string, sizeGb: number) => st({ type: "size", params: { operator, sizeGb } }, base({ sizeOnDisk: 10 * GB }));
		expect([sz("greater_than", 9.99), sz("greater_than", 10), sz("less_than", 10), sz("less_than", 10.01)]).toEqual(["true", "false", "false", "true"]);
		expect(st({ type: "size", params: { operator: "less_than", sizeGb: 1 } }, base({ sizeOnDisk: 0 }))).toBe("true");
	});

	describe.each([["rating", "rating"], ["imdb_rating", "imdbRating"]] as const)("%s", (type, field) => {
		const r = (params: Record<string, unknown>, value: number | null) => st({ type, params }, base({ [field]: value }));
		it("compares strictly", () => {
			expect([r({ operator: "less_than", score: 6 }, 6), r({ operator: "less_than", score: 6 }, 5.9), r({ operator: "greater_than", score: 6 }, 6), r({ operator: "greater_than", score: 6 }, 6.1)]).toEqual(["false", "true", "false", "true"]);
		});
		it("is unknown when missing, unless asking for unrated", () => {
			expect(r({ operator: "less_than", score: 6 }, null)).toBe("unknown");
			expect(r({ operator: "greater_than", score: 6 }, null)).toBe("unknown");
			expect(r({ operator: "unrated" }, null)).toBe("true");
		});
		it("treats a zero rating as unrated", () => {
			expect(r({ operator: "unrated" }, 0)).toBe("true");
			expect(r({ operator: "unrated" }, 7)).toBe("false");
		});
	});

	it("status: case-insensitive, any of the list, null never matches", () => {
		const s = (statuses: string[], status: string | null) => st({ type: "status", params: { statuses } }, base({ status }));
		expect([s(["ended"], "Ended"), s(["ended", "released"], "released"), s(["ended"], "continuing"), s(["ended"], null)]).toEqual(["true", "true", "false", "false"]);
	});

	it("monitored / unmonitored / no_file are exact opposites on their own flag", () => {
		for (const monitored of [true, false]) {
			expect(st({ type: "monitored", params: {} }, base({ monitored }))).toBe(monitored ? "true" : "false");
			expect(st({ type: "unmonitored", params: {} }, base({ monitored }))).toBe(monitored ? "false" : "true");
		}
		expect(st({ type: "no_file", params: {} }, base({ hasFile: false }))).toBe("true");
		expect(st({ type: "no_file", params: {} }, base({ hasFile: true }))).toBe("false");
	});

	it("no_monitored_seasons: series only, and only when the count is known", () => {
		const n = (over: Partial<LibraryItem>) => st({ type: "no_monitored_seasons", params: {} }, base({ kind: "series", service: "sonarr", ...over }));
		expect([n({ monitoredSeasons: 0 }), n({ monitoredSeasons: 2 }), n({ monitoredSeasons: undefined })]).toEqual(["true", "false", "false"]);
		expect(st({ type: "no_monitored_seasons", params: {} }, base({ monitoredSeasons: 0 }))).toBe("false"); // a movie
	});

	it("genre: includes_any / excludes_all, case-insensitive, empty genres", () => {
		const g = (operator: string, genres: string[], have: string[]) => st({ type: "genre", params: { operator, genres } }, base({ genres: have }));
		expect([
			g("includes_any", ["drama", "comedy"], ["Comedy"]), g("includes_any", ["horror"], ["Drama"]), g("includes_any", ["drama"], []),
			g("excludes_all", ["horror"], ["Drama"]), g("excludes_all", ["horror", "drama"], ["Drama", "Comedy"]), g("excludes_all", ["horror"], []),
		]).toEqual(["true", "false", "false", "true", "false", "true"]);
	});

	describe("certification", () => {
		const cert = (params: Record<string, unknown>, certification: string | null, kidsMaxAge = 12) => st({ type: "certification", params }, base({ certification }), ctx(null, null, kidsMaxAge));
		it("includes_any / excludes_all", () => {
			expect([cert({ operator: "includes_any", ratings: ["PG", "G"] }, "pg"), cert({ operator: "includes_any", ratings: ["G"] }, "R"), cert({ operator: "excludes_all", ratings: ["R", "NC-17"] }, "PG"), cert({ operator: "excludes_all", ratings: ["R"] }, "r")]).toEqual(["true", "false", "true", "false"]);
		});
		it("an unrated title is unknown for lists but definitely not suitable for kids", () => {
			expect(cert({ operator: "includes_any", ratings: ["G"] }, null)).toBe("unknown");
			expect(cert({ operator: "excludes_all", ratings: ["R"] }, null)).toBe("unknown");
			expect(cert({ operator: "suitable_for_kids" }, null)).toBe("false");
		});
		it("unrecognised ratings are never suitable for kids, even at a high max age", () => {
			expect(cert({ operator: "suitable_for_kids" }, "Banana", 18)).toBe("false");
			expect(cert({ operator: "suitable_for_kids" }, "NR", 18)).toBe("false");
		});
		it("suitable_for_kids is inclusive of the configured max age and sweeps across the scale", () => {
			const at = (c: string) => [6, 7, 12, 13, 14, 17, 18].filter((m) => cert({ operator: "suitable_for_kids" }, c, m) === "true");
			expect(at("G")).toEqual([6, 7, 12, 13, 14, 17, 18]);
			expect(at("PG")).toEqual([7, 12, 13, 14, 17, 18]);
			expect(at("PG-13")).toEqual([13, 14, 17, 18]);
			expect(at("TV-14")).toEqual([14, 17, 18]);
			expect(at("R")).toEqual([17, 18]);
			expect(at("NC-17")).toEqual([18]);
		});
		it("tolerates whitespace around the rating", () => {
			expect(cert({ operator: "suitable_for_kids" }, "  PG  ")).toBe("true");
		});
	});

	it("year_range: open ends, inclusive bounds, null year is unknown", () => {
		const y = (params: Record<string, unknown>, year: number | null) => st({ type: "year_range", params }, base({ year }));
		expect([
			y({ minYear: 2000 }, 2000), y({ minYear: 2000 }, 1999), y({ maxYear: 2000 }, 2000), y({ maxYear: 2000 }, 2001),
			y({ minYear: 1990, maxYear: 2000 }, 1995), y({ minYear: 1990, maxYear: 2000 }, 2010), y({ minYear: 1990 }, null),
		]).toEqual(["true", "false", "true", "false", "true", "false", "unknown"]);
	});

	it("quality_profile and language: any-of, case-insensitive, null is unknown", () => {
		const q = (profiles: string[], v: string | null) => st({ type: "quality_profile", params: { profiles } }, base({ qualityProfileName: v }));
		expect([q(["hd-1080p", "any"], "HD-1080p"), q(["any"], "HD-1080p"), q(["any"], null)]).toEqual(["true", "false", "unknown"]);
		const l = (operator: string, languages: string[], v: string | null) => st({ type: "language", params: { operator, languages } }, base({ originalLanguage: v }));
		expect([l("is", ["english"], "English"), l("is", ["french"], "English"), l("is_not", ["french"], "English"), l("is_not", ["english"], "English"), l("is", ["english"], null), l("is_not", ["english"], null)])
			.toEqual(["true", "false", "true", "false", "unknown", "unknown"]);
	});

	it("tag_match: includes_any / excludes_all, case-insensitive, untagged items", () => {
		const t = (operator: string, tags: string[], have: string[]) => st({ type: "tag_match", params: { operator, tags } }, base({ tags: have }));
		expect([t("includes_any", ["KEEP"], ["keep"]), t("includes_any", ["keep"], []), t("excludes_all", ["keep", "kids"], ["Kids"]), t("excludes_all", ["keep"], [])])
			.toEqual(["true", "false", "false", "true"]);
	});

	it("file_path: contains / not_contains / matches, case-insensitive, missing path is unknown", () => {
		const p = (operator: string, value: string, path: string | null) => st({ type: "file_path", params: { operator, value } }, base({ path }));
		expect([
			p("contains", "MOVIES", "/data/movies/x"), p("contains", "tv", "/data/movies/x"), p("not_contains", "tv", "/data/movies/x"), p("not_contains", "movies", "/data/movies/x"),
			p("matches", "^/data/(movies|tv)/", "/data/TV/x"), p("matches", "^/data/anime/", "/data/tv/x"), p("contains", "x", null), p("not_contains", "x", null), p("matches", "x", null),
		]).toEqual(["true", "false", "true", "false", "true", "false", "unknown", "unknown", "unknown"]);
	});

	it("runtime: strict thresholds, null is unknown", () => {
		const r = (operator: string, minutes: number, runtime: number | null) => st({ type: "runtime", params: { operator, minutes } }, base({ runtime }));
		expect([r("greater_than", 110, 110), r("greater_than", 109, 110), r("less_than", 110, 110), r("less_than", 111, 110), r("less_than", 90, null)]).toEqual(["false", "true", "false", "true", "unknown"]);
	});
});

describe("file-metadata rules (any file may satisfy)", () => {
	const two = (a: Partial<FileInfo>, b: Partial<FileInfo>) => base({ files: [file(a), file({ id: 2, ...b })], fileCount: 2 });
	it("no files on a loaded item is false, not unknown", () => {
		expect(st({ type: "video_codec", params: { codecs: ["x264"] } }, base({ files: [] }))).toBe("false");
	});
	it("true if any file matches, even when another file's metadata is missing", () => {
		const i = two({ videoCodec: null }, { videoCodec: "x265" });
		expect(st({ type: "video_codec", params: { codecs: ["x265"] } }, i)).toBe("true");
	});
	it("unknown if no file matches and any file's metadata is missing; false only when every file is known", () => {
		expect(st({ type: "video_codec", params: { codecs: ["av1"] } }, two({ videoCodec: null }, { videoCodec: "x265" }))).toBe("unknown");
		expect(st({ type: "video_codec", params: { codecs: ["av1"] } }, two({ videoCodec: "x264" }, { videoCodec: "x265" }))).toBe("false");
	});
	it("resolution: at_most / at_least / equals", () => {
		const r = (operator: string, lines: number, res: number | null) => st({ type: "resolution", params: { operator, lines } }, base({ files: [file({ resolution: res })] }));
		expect([
			r("at_most", 720, 720), r("at_most", 720, 1080), r("at_least", 1080, 1080), r("at_least", 1080, 720), r("equals", 1080, 1080), r("equals", 1080, 2160), r("equals", 1080, null),
		]).toEqual(["true", "false", "true", "false", "true", "false", "unknown"]);
	});
	it("resolution across several files", () => {
		const i = two({ resolution: 2160 }, { resolution: 720 });
		expect(st({ type: "resolution", params: { operator: "at_most", lines: 720 } }, i)).toBe("true");
		expect(st({ type: "resolution", params: { operator: "at_least", lines: 2160 } }, i)).toBe("true");
		expect(st({ type: "resolution", params: { operator: "equals", lines: 1080 } }, i)).toBe("false");
	});
	it("audio codec and release group are case-insensitive lists", () => {
		expect(st({ type: "audio_codec", params: { codecs: ["eac3", "truehd"] } }, base({ files: [file({ audioCodec: "EAC3" })] }))).toBe("true");
		expect(st({ type: "release_group", params: { groups: ["grp"] } })).toBe("true");
		expect(st({ type: "release_group", params: { groups: ["other"] } })).toBe("false");
		expect(st({ type: "release_group", params: { groups: ["grp"] } }, base({ files: [file({ releaseGroup: null })] }))).toBe("unknown");
	});
	it("audio channels: strict thresholds, missing is unknown", () => {
		const c = (operator: string, channels: number, n: number | null) => st({ type: "audio_channels", params: { operator, channels } }, base({ files: [file({ audioChannels: n })] }));
		expect([c("greater_than", 2, 6), c("greater_than", 6, 6), c("less_than", 6, 2), c("less_than", 2, 2), c("greater_than", 2, null)]).toEqual(["true", "false", "true", "false", "unknown"]);
	});
	it("hdr_type: missing means SDR, and the match is a case-insensitive substring", () => {
		const h = (types: string[], hdr: string | null) => st({ type: "hdr_type", params: { types } }, base({ files: [file({ hdr })] }));
		expect([h(["SDR"], null), h(["HDR10"], null), h(["hdr10"], "HDR10"), h(["DolbyVision"], "HDR10 / DolbyVision"), h(["SDR"], "HDR10"), h(["hdr", "sdr"], "HDR10")])
			.toEqual(["true", "false", "true", "true", "false", "true"]);
	});
	it("custom_format_score: negative scores and zero compare normally, missing is unknown", () => {
		const s = (operator: string, score: number, v: number | null) => st({ type: "custom_format_score", params: { operator, score } }, base({ files: [file({ customFormatScore: v })] }));
		expect([s("less_than", 0, -50), s("greater_than", -100, -50), s("greater_than", 0, 0), s("less_than", 0, null)]).toEqual(["true", "true", "false", "unknown"]);
	});
});

describe("watch rules", () => {
	const lw = (operator: string, days: number, c: EvalContext, item = base()) => st({ type: "last_watched", params: { operator, days } }, item, c);
	describe("last_watched", () => {
		it("not_watched_in_days is strict at the boundary", () => {
			const c = (d: number) => withWatch({ lastWatchedAt: ago(d) });
			expect([lw("not_watched_in_days", 90, c(91)), lw("not_watched_in_days", 90, c(90)), lw("not_watched_in_days", 90, c(5))]).toEqual(["true", "false", "false"]);
		});
		it("watched_within_days is strict at the boundary and false when never watched", () => {
			const c = (d: number | null) => withWatch({ lastWatchedAt: d === null ? null : ago(d) });
			expect([lw("watched_within_days", 30, c(29)), lw("watched_within_days", 30, c(30)), lw("watched_within_days", 30, c(null))]).toEqual(["true", "false", "false"]);
		});
		it("the two operators are not complements for a never-watched, recently-added item", () => {
			const fresh = base({ added: ago(5) });
			expect([lw("not_watched_in_days", 30, withWatch({}), fresh), lw("watched_within_days", 30, withWatch({}), fresh)]).toEqual(["false", "false"]);
		});
		it("never watched counts from the added date, unknown if there is none", () => {
			expect(lw("not_watched_in_days", 300, withWatch({}), base({ added: ago(400) }))).toBe("true");
			expect(lw("not_watched_in_days", 500, withWatch({}), base({ added: ago(400) }))).toBe("false");
			expect(lw("not_watched_in_days", 30, withWatch({}), base({ added: null }))).toBe("unknown");
		});
		it("an item with no file is never 'not watched', whatever the history says", () => {
			expect(lw("not_watched_in_days", 1, withWatch({ lastWatchedAt: ago(500) }), base({ hasFile: false }))).toBe("false");
		});
		it("a lookup that returns nothing means never watched (the provider answered)", () => {
			expect(lw("not_watched_in_days", 30, withWatch(null))).toBe("true");
		});
	});
	it("watch_count: less_than / greater_than / equals", () => {
		const w = (operator: string, count: number, n: number) => st({ type: "watch_count", params: { operator, count } }, base(), withWatch({ watchCount: n }));
		expect([w("equals", 0, 0), w("equals", 0, 1), w("less_than", 2, 1), w("less_than", 1, 1), w("greater_than", 1, 2), w("greater_than", 2, 2)])
			.toEqual(["true", "false", "true", "false", "true", "false"]);
	});
	it("watched_by: any of the users, case-insensitive; not_watched_by_any is its complement", () => {
		const w = (operator: string, users: string[], by: string[]) => st({ type: "watched_by", params: { operator, users } }, base(), withWatch({ watchedBy: by }));
		expect([
			w("watched_by_any", ["alice", "bob"], ["BOB"]), w("watched_by_any", ["alice"], ["bob"]), w("watched_by_any", ["alice"], []),
			w("not_watched_by_any", ["alice"], ["bob"]), w("not_watched_by_any", ["alice"], ["Alice"]), w("not_watched_by_any", ["alice"], []),
		]).toEqual(["true", "false", "false", "true", "false", "true"]);
	});

	describe("stale_unwatched_episode", () => {
		const stale = (eps: Ep[], watched: Record<string, number[]> = {}, days = 30, item?: LibraryItem) =>
			st({ type: "stale_unwatched_episode", params: { days } }, item ?? season(eps), withWatch({ episodesByUser: new Map(Object.entries(watched).map(([u, n]) => [u, new Set(n)])) }));
		it("matches an unwatched file that has sat past the threshold (inclusive)", () => {
			expect(stale([ep(1, { added: ago(30) })])).toBe("true");
			expect(stale([ep(1, { added: ago(29) })])).toBe("false");
		});
		it("any user watching the episode clears it", () => {
			expect(stale([ep(1)], { alice: [1] })).toBe("false");
			expect(stale([ep(1)], { alice: [2], bob: [1] })).toBe("false");
		});
		it("one stale episode is enough even when the rest were watched", () => {
			expect(stale([ep(1), ep(2), ep(3)], { alice: [1, 2] })).toBe("true");
		});
		it("ignores episodes with no file or no added date", () => {
			expect(stale([ep(1, { hasFile: false })])).toBe("false");
			expect(stale([ep(1, { added: null })])).toBe("false");
			expect(stale([ep(1, { hasFile: false }), ep(2)])).toBe("true");
		});
		it("only applies to seasons", () => {
			expect(stale([], {}, 30, base())).toBe("false");
		});
	});
});

describe("request rules", () => {
	const r = (expr: unknown, reqs: SeerrRequest[]) => st(expr, base(), withSeerr(reqs));
	it("seerr_is_requested: both operators over none / one / many", () => {
		const q = (operator: string, n: number) => r({ type: "seerr_is_requested", params: { operator } }, Array.from({ length: n }, (_, i) => request({ id: i })));
		expect([q("is_requested", 0), q("is_requested", 1), q("is_requested", 3), q("not_requested", 0), q("not_requested", 1)]).toEqual(["false", "true", "true", "true", "false"]);
	});
	it("seerr_requested_by: any_of / none_of across several requests and aliases", () => {
		const reqs = [request({ requesters: ["Alice", "alice@x.io"] }), request({ id: 2, requesters: ["Bob"] })];
		const q = (operator: string, users: string[]) => r({ type: "seerr_requested_by", params: { operator, users } }, reqs);
		expect([q("any_of", ["bob"]), q("any_of", ["ALICE@X.IO"]), q("any_of", ["carol"]), q("none_of", ["carol"]), q("none_of", ["bob", "carol"])]).toEqual(["true", "true", "false", "true", "false"]);
		expect(r({ type: "seerr_requested_by", params: { operator: "none_of", users: ["bob"] } }, [])).toBe("true");
		expect(r({ type: "seerr_requested_by", params: { operator: "any_of", users: ["bob"] } }, [])).toBe("false");
	});
	it("seerr_request_age: strict boundary on the newest request, newer_than too", () => {
		const reqs = [request({ createdAt: ago(300) }), request({ id: 2, createdAt: ago(100) })];
		const a = (operator: string, days: number) => r({ type: "seerr_request_age", params: { operator, days } }, reqs);
		expect([a("older_than", 99), a("older_than", 100), a("newer_than", 100), a("newer_than", 101)]).toEqual(["true", "false", "false", "true"]);
		expect(r({ type: "seerr_request_age", params: { operator: "newer_than", days: 9999 } }, [])).toBe("false"); // never requested never matches
	});
	it("seerr_request_count: equals / less_than / greater_than", () => {
		const c = (operator: string, count: number, n: number) => r({ type: "seerr_request_count", params: { operator, count } }, Array.from({ length: n }, (_, i) => request({ id: i })));
		expect([c("equals", 0, 0), c("equals", 2, 3), c("less_than", 1, 0), c("less_than", 1, 1), c("greater_than", 1, 2), c("greater_than", 2, 2)]).toEqual(["true", "false", "true", "false", "true", "false"]);
	});

	describe("seerr_requester_watched", () => {
		const rw = (params: Record<string, unknown>, reqs: SeerrRequest[], watchedBy: string[]) =>
			st({ type: "seerr_requester_watched", params }, base(), withSeerr(reqs, () => watchInfo({ watchedBy })));
		it("matches on any of the request's aliases", () => {
			expect(rw({}, [request({ requesters: ["Alice", "alice@x.io"] })], ["alice@x.io"])).toBe("true");
		});
		it("restricting to named requesters ignores requests by anyone else", () => {
			const reqs = [request({ requesters: ["Alice"] }), request({ id: 2, requesters: ["Bob"] })];
			expect(rw({ users: ["bob"] }, reqs, ["Alice"])).toBe("false"); // Alice watched, but only Bob's request counts
			expect(rw({ users: ["bob"] }, reqs, ["Bob"])).toBe("true");
			expect(rw({ users: ["carol"] }, reqs, ["Alice"])).toBe("false");
		});
		it("with several requesters and no restriction, any one having watched is enough", () => {
			const reqs = [request({ requesters: ["Alice"] }), request({ id: 2, requesters: ["Bob"] })];
			expect(rw({}, reqs, ["Bob"])).toBe("true");
			expect(rw({ operator: "requester_not_watched" }, reqs, ["Bob"])).toBe("false");
			expect(rw({ operator: "requester_not_watched" }, reqs, ["Carol"])).toBe("true");
		});
	});

	describe("season_requester_watched", () => {
		const eps = [ep(1), ep(2), ep(3)];
		const sw = (reqs: SeerrRequest[], watched: Record<string, number[]>, over: { episodes?: Ep[]; params?: Record<string, unknown> } = {}) =>
			st({ type: "season_requester_watched", params: over.params ?? {} }, season(over.episodes ?? eps),
				withSeerr(reqs, () => watchInfo({ watchedBy: Object.keys(watched), episodesByUser: new Map(Object.entries(watched).map(([u, n]) => [u, new Set(n)])) })));
		it("true only when the requester watched every episode", () => {
			expect(sw([request()], { Alice: [1, 2, 3] })).toBe("true");
			expect(sw([request()], { Alice: [1, 2] })).toBe("false");
			expect(sw([request()], { Alice: [] })).toBe("false");
		});
		it("someone else watching every episode does not count", () => {
			expect(sw([request()], { Bob: [1, 2, 3] })).toBe("false");
		});
		it("one requester must have watched them all, not a union across requesters", () => {
			const reqs = [request({ requesters: ["Alice"] }), request({ id: 2, requesters: ["Bob"] })];
			expect(sw(reqs, { Alice: [1, 2], Bob: [3] })).toBe("false");
			expect(sw(reqs, { Alice: [1], Bob: [1, 2, 3] })).toBe("true");
		});
		it("a season still airing, or with an undated episode, never matches", () => {
			expect(sw([request()], { Alice: [1, 2, 3] }, { episodes: [ep(1), ep(2), ep(3, { airDate: new Date(NOW.getTime() + DAY) })] })).toBe("false");
			expect(sw([request()], { Alice: [1, 2, 3] }, { episodes: [ep(1), ep(2), ep(3, { airDate: null })] })).toBe("false");
		});
		it("an episode airing exactly now counts as aired", () => {
			expect(sw([request()], { Alice: [1] }, { episodes: [ep(1, { airDate: NOW })] })).toBe("true");
		});
		it("not requested (or not by the named users) is false; no episode list or no requester name is unknown", () => {
			expect(sw([], { Alice: [1, 2, 3] })).toBe("false");
			expect(sw([request()], { Alice: [1, 2, 3] }, { params: { users: ["bob"] } })).toBe("false");
			expect(sw([request()], { Alice: [1, 2, 3] }, { episodes: [] })).toBe("unknown");
			expect(sw([request({ requesters: [] })], { Alice: [1, 2, 3] })).toBe("unknown");
		});
		it("only applies to season items", () => {
			expect(st({ type: "season_requester_watched", params: {} }, base(), withSeerr([request()], () => watchInfo()))).toBe("false");
		});
	});

	describe("watched_by_others", () => {
		const o = (reqs: SeerrRequest[], by: string[]) => st({ type: "watched_by_others", params: {} }, base(), withSeerr(reqs, () => watchInfo({ watchedBy: by })));
		it("is true only when someone outside the requesters watched", () => {
			expect([o([request()], ["Alice"]), o([request()], ["Alice", "Bob"]), o([request()], ["Bob"]), o([request()], [])]).toEqual(["false", "true", "true", "false"]);
		});
		it("all requesters are excluded, and aliases count", () => {
			const reqs = [request({ requesters: ["Alice", "alice@x.io"] }), request({ id: 2, requesters: ["Bob"] })];
			expect(o(reqs, ["alice@x.io", "BOB"])).toBe("false");
			expect(o(reqs, ["alice@x.io", "Carol"])).toBe("true");
		});
		it("unrequested is false, nameless requester is unknown", () => {
			expect(o([], ["Bob"])).toBe("false");
			expect(o([request({ requesters: [] })], ["Bob"])).toBe("unknown");
		});
	});
});

// ── Realistic rule combinations ─────────────────────────────────────────────

describe("realistic combinations", () => {
	const oldBig = { op: "and", of: [{ type: "age", params: { operator: "older_than", days: 365 } }, { type: "size", params: { operator: "greater_than", sizeGb: 5 } }] };
	it("old AND big, but not tagged keep", () => {
		const e = { op: "and", of: [oldBig, { op: "not", of: { type: "tag_match", params: { operator: "includes_any", tags: ["keep"] } } }] };
		expect(st(e, base({ tags: [] }))).toBe("true");
		expect(st(e, base({ tags: ["Keep"] }))).toBe("false");
		expect(st(e, base({ tags: [], sizeOnDisk: 1 * GB }))).toBe("false");
	});
	it("low rated OR low resolution, scoped to drama", () => {
		const e = {
			op: "and",
			of: [
				{ op: "or", of: [{ type: "rating", params: { operator: "less_than", score: 5 } }, { type: "resolution", params: { operator: "at_most", lines: 720 } }] },
				{ type: "genre", params: { operator: "includes_any", genres: ["drama"] } },
			],
		};
		expect(st(e, base({ rating: 4, files: [file({ resolution: 1080 })] }))).toBe("true");
		expect(st(e, base({ rating: 8, files: [file({ resolution: 720 })] }))).toBe("true");
		expect(st(e, base({ rating: 8, files: [file({ resolution: 1080 })] }))).toBe("false");
		expect(st(e, base({ rating: 4, genres: ["Comedy"] }))).toBe("false");
	});
	it("missing file details can't make a mixed rule true, but can't hide a definite false either", () => {
		const e = { op: "and", of: [{ type: "video_codec", params: { codecs: ["x264"] } }, { type: "size", params: { operator: "greater_than", sizeGb: 5 } }] };
		expect(st(e, base({ files: null }))).toBe("unknown");
		expect(st(e, base({ files: null, sizeOnDisk: 1 * GB }))).toBe("false");
	});
	it("the Plex-down case: an OR is still decided by a true library fact, an AND is not", () => {
		const watchUnwatched = { type: "last_watched", params: { operator: "not_watched_in_days", days: 90 } };
		const bigFact = { type: "size", params: { operator: "greater_than", sizeGb: 5 } };
		expect(st({ op: "or", of: [bigFact, watchUnwatched] }, base(), ctx(null))).toBe("true");
		expect(st({ op: "and", of: [bigFact, watchUnwatched] }, base(), ctx(null))).toBe("unknown");
		expect(st({ op: "and", of: [bigFact, watchUnwatched] }, base(), withWatch({ lastWatchedAt: ago(200) }))).toBe("true");
	});
	it("a kids-or-recently-watched protection reads true from either branch and unknown only when neither is decided", () => {
		const e = { op: "or", of: [{ type: "certification", params: { operator: "suitable_for_kids" } }, { type: "last_watched", params: { operator: "watched_within_days", days: 30 } }] };
		expect(st(e, base({ certification: "G" }), ctx(null))).toBe("true");
		expect(st(e, base({ certification: "R" }), ctx(null))).toBe("unknown");
		expect(st(e, base({ certification: "R" }), withWatch({ lastWatchedAt: ago(3) }))).toBe("true");
		expect(st(e, base({ certification: "R" }), withWatch({ lastWatchedAt: ago(300) }))).toBe("false");
	});
	it("requested-and-nobody-else-watching, the season clean-up shape", () => {
		const e = { op: "and", of: [{ type: "season_requester_watched", params: {} }, { op: "not", of: { type: "watched_by_others", params: {} } }, { type: "last_watched", params: { operator: "not_watched_in_days", days: 365 } }] };
		const eps = [ep(1), ep(2)];
		const c = (watchedBy: string[], last: Date) => withSeerr([request()], () => watchInfo({ watchedBy, lastWatchedAt: last, episodesByUser: new Map([["Alice", new Set([1, 2])]]) }));
		expect(st(e, season(eps), c(["Alice"], ago(400)))).toBe("true");
		expect(st(e, season(eps), c(["Alice", "Bob"], ago(400)))).toBe("false"); // someone else watched
		expect(st(e, season(eps), c(["Alice"], ago(10)))).toBe("false"); // watched recently
	});
});

// ── Actions and slots ───────────────────────────────────────────────────────

describe("action slots", () => {
	it("slotOf: movies, and series split by status (case-insensitive, unknown counts as continuing)", () => {
		expect(slotOf({ service: "radarr", status: "released" })).toBe("radarr");
		expect(slotOf({ service: "radarr", status: "ended" })).toBe("radarr");
		expect(slotOf({ service: "sonarr", status: "ended" })).toBe("sonarr_ended");
		expect(slotOf({ service: "sonarr", status: "Ended" })).toBe("sonarr_ended");
		expect(slotOf({ service: "sonarr", status: "continuing" })).toBe("sonarr_continuing");
		expect(slotOf({ service: "sonarr", status: null })).toBe("sonarr_continuing");
		expect(slotOf({ service: "sonarr", status: "upcoming" })).toBe("sonarr_continuing");
	});
	describe("toActions", () => {
		it("applies one action everywhere when there is no filter", () => {
			expect(toActions("unmonitor", null)).toEqual({ radarr: "unmonitor", sonarr_continuing: "unmonitor", sonarr_ended: "unmonitor" });
			expect(toActions("delete", [])).toEqual({ radarr: "delete", sonarr_continuing: "delete", sonarr_ended: "delete" });
		});
		it("a service filter nulls the other service's slots", () => {
			expect(toActions("delete", ["radarr"])).toEqual({ radarr: "delete", sonarr_continuing: null, sonarr_ended: null });
			expect(toActions("delete", ["sonarr"])).toEqual({ radarr: null, sonarr_continuing: "delete", sonarr_ended: "delete" });
			expect(toActions("delete", ["radarr", "sonarr"])).toEqual({ radarr: "delete", sonarr_continuing: "delete", sonarr_ended: "delete" });
		});
		it("per-slot overrides replace the action, and a null override falls back to it", () => {
			expect(toActions("delete", null, { radarr: "unmonitor", sonarr_ended: "delete_files" })).toEqual({ radarr: "unmonitor", sonarr_continuing: "delete", sonarr_ended: "delete_files" });
			expect(toActions("delete", null, { radarr: null })).toEqual({ radarr: "delete", sonarr_continuing: "delete", sonarr_ended: "delete" });
		});
		it("overrides never resurrect a slot the service filter excluded", () => {
			expect(toActions("delete", ["sonarr"], { radarr: "unmonitor" }).radarr).toBeNull();
		});
		it("delete_season is for series only, as the action or as an override", () => {
			expect(toActions("delete_season", null)).toEqual({ radarr: null, sonarr_continuing: "delete_season", sonarr_ended: "delete_season" });
			expect(toActions("delete", null, { radarr: "delete_season" }).radarr).toBeNull();
		});
	});
	it("firstAction prefers radarr, then continuing, then ended; null when all are left alone", () => {
		expect(firstAction({ radarr: "unmonitor", sonarr_continuing: "delete", sonarr_ended: "delete_files" })).toBe("unmonitor");
		expect(firstAction({ radarr: null, sonarr_continuing: "delete", sonarr_ended: "delete_files" })).toBe("delete");
		expect(firstAction({ radarr: null, sonarr_continuing: null, sonarr_ended: "delete_files" })).toBe("delete_files");
		expect(firstAction({ radarr: null, sonarr_continuing: null, sonarr_ended: null })).toBeNull();
	});
	it("servicesOf: null for both, otherwise the services with any slot set", () => {
		expect(servicesOf({ radarr: "delete", sonarr_continuing: null, sonarr_ended: "delete" })).toBeNull();
		expect(servicesOf({ radarr: "delete", sonarr_continuing: null, sonarr_ended: null })).toEqual(["radarr"]);
		expect(servicesOf({ radarr: null, sonarr_continuing: "delete", sonarr_ended: null })).toEqual(["sonarr"]);
		expect(servicesOf({ radarr: null, sonarr_continuing: null, sonarr_ended: "delete" })).toEqual(["sonarr"]);
		expect(servicesOf({ radarr: null, sonarr_continuing: null, sonarr_ended: null })).toEqual([]);
	});
});

// ── Scope filters ───────────────────────────────────────────────────────────

describe("scope filters", () => {
	const rule = (over: Partial<RuleRecord> = {}): RuleRecord => ({
		id: "r", name: "r", enabled: true, priority: 0, mode: "cleanup", action: "delete", actions: { radarr: "delete", sonarr_continuing: "delete", sonarr_ended: "delete" },
		expression: {}, serviceFilter: null, instanceFilter: null, excludeTags: null, excludeTitles: null, serviceLocked: false, ...over,
	});
	const why = (r: RuleRecord, i = base()) => { const x = passesFilters(i, r); return x.ok ? "ok" : x.why; };
	it("no filters, and empty filter lists, let everything through", () => {
		expect(why(rule())).toBe("ok");
		expect(why(rule({ serviceFilter: [], instanceFilter: [], excludeTags: [], excludeTitles: [] }))).toBe("ok");
	});
	it("service and instance filters are allow-lists", () => {
		expect(why(rule({ serviceFilter: ["radarr"] }))).toBe("ok");
		expect(why(rule({ serviceFilter: ["sonarr"] }))).toBe("service filter");
		expect(why(rule({ serviceFilter: ["sonarr", "radarr"] }))).toBe("ok");
		expect(why(rule({ instanceFilter: ["i", "j"] }))).toBe("ok");
		expect(why(rule({ instanceFilter: ["j"] }))).toBe("instance filter");
	});
	it("excluded tags match case-insensitively and any one is enough", () => {
		expect(why(rule({ excludeTags: ["nope", "KEEP"] }))).toBe('excluded tag "keep"');
		expect(why(rule({ excludeTags: ["nope"] }))).toBe("ok");
		expect(why(rule({ excludeTags: ["keep"] }), base({ tags: [] }))).toBe("ok");
	});
	it("excluded title patterns are case-insensitive regexes; any one excludes", () => {
		expect(why(rule({ excludeTitles: ["^zzz", "movie \\d"] }))).toMatch(/excluded title pattern/);
		expect(why(rule({ excludeTitles: ["^zzz"] }))).toBe("ok");
		expect(why(rule({ excludeTitles: ["MOVIE"] }))).toMatch(/excluded title pattern/);
	});
	it("an unsafe or invalid exclusion fails closed, even after a safe pattern that did not match", () => {
		expect(why(rule({ excludeTitles: ["^zzz", "(a+)+"] }))).toMatch(/unsafe exclude pattern/);
		expect(why(rule({ excludeTitles: ["("] }))).toMatch(/unsafe exclude pattern/);
		expect(why(rule({ excludeTitles: ["x".repeat(201)] }))).toMatch(/unsafe exclude pattern/);
	});
	it("checks service, then instance, then tags, then titles", () => {
		const all = rule({ serviceFilter: ["sonarr"], instanceFilter: ["j"], excludeTags: ["keep"], excludeTitles: ["Movie"] });
		expect(why(all)).toBe("service filter");
		expect(why({ ...all, serviceFilter: null })).toBe("instance filter");
		expect(why({ ...all, serviceFilter: null, instanceFilter: null })).toBe('excluded tag "keep"');
		expect(why({ ...all, serviceFilter: null, instanceFilter: null, excludeTags: null })).toMatch(/excluded title pattern/);
	});
	it("every filter must pass together", () => {
		const r = rule({ serviceFilter: ["radarr"], instanceFilter: ["i"], excludeTags: ["other"], excludeTitles: ["^Show"] });
		expect(why(r)).toBe("ok");
		expect(why(r, base({ title: "Show 9" }))).toMatch(/excluded title/);
		expect(why(r, base({ tags: ["other"] }))).toBe('excluded tag "other"');
	});
});

describe("regex safety", () => {
	it("classifies patterns", () => {
		expect(getRegexError("^Movie \\d+$")).toBeNull();
		expect(getRegexError("(a+)+")).toMatch(/nested/);
		expect(getRegexError("(.*)*")).toMatch(/nested/);
		expect(getRegexError("(")).toMatch(/Invalid/);
		expect(getRegexError("x".repeat(201))).toMatch(/exceeds/);
		expect(getRegexError("x".repeat(200))).toBeNull();
	});
	it("compiles case-insensitively and caches, including the unsafe verdict", () => {
		expect(safeRegex("abc")?.test("xABCx")).toBe(true);
		expect(safeRegex("abc")).toBe(safeRegex("abc"));
		expect(safeRegex("(a+)+")).toBeNull();
		expect(safeRegex("(a+)+")).toBeNull();
	});
	it("a backtracking-prone path pattern is refused up front, and an accepted one is quick on a long path", () => {
		expect(() => parseExpression({ type: "file_path", params: { operator: "matches", value: "^(/[a-z]+)+$" } })).toThrow(/nested quantifiers/);
		const t = Date.now();
		st({ type: "file_path", params: { operator: "matches", value: "^/[a-z]+/[a-z]+$" } }, base({ path: "/" + "a".repeat(5000) + "!" }));
		expect(Date.now() - t).toBeLessThan(2000);
	});
});

// ── Through the engine: how rules combine across a library ──────────────────

describe("rules combined through the engine", () => {
	const live = (s: ReturnType<typeof setup>, over: Record<string, unknown> = {}) => s.store.config.update({ dryRun: false, ...over });
	async function removed(s: ReturnType<typeof setup>) {
		await s.engine.run({ trigger: "manual" });
		for (const a of s.store.approvals.list("pending")) await s.engine.approve(a.id, { actor: "test" });
		return s.radarrApi.calls;
	}
	const tag = (t: string) => ({ type: "tag_match", params: { operator: "includes_any", tags: [t] } });

	it("any one of several retention rules protects", async () => {
		const s = setup({ radarr: [movie(1, { tags: [1] }), movie(2, { tags: [2] }), movie(3)] });
		live(s);
		s.rule("old", old(100));
		s.rule("keep", tag("keep"), { mode: "retention" });
		s.rule("kids", tag("kids"), { mode: "retention" });
		expect(await removed(s)).toEqual(["delete:3:true"]);
	});
	it("a disabled retention rule protects nothing", async () => {
		const s = setup({ radarr: [movie(1, { tags: [1] })] });
		live(s);
		s.rule("old", old(100));
		s.rule("keep", tag("keep"), { mode: "retention", enabled: false });
		expect(await removed(s)).toEqual(["delete:1:true"]);
	});
	it("a retention rule scoped to Sonarr does not protect a movie", async () => {
		const s = setup({ radarr: [movie(1, { tags: [1] })], sonarr: [] });
		live(s);
		s.rule("old", old(100));
		s.rule("keep sonarr", tag("keep"), { mode: "retention", serviceFilter: ["sonarr"] });
		expect(await removed(s)).toEqual(["delete:1:true"]);
	});
	it("a rule's exclude-tag drops the item from that rule only", async () => {
		const s = setup({ radarr: [movie(1, { tags: [1] }), movie(2)] });
		live(s);
		s.rule("old", old(100), { excludeTags: ["keep"] });
		expect(await removed(s)).toEqual(["delete:2:true"]);
	});
	it("an exclusion on the higher-priority rule lets a lower-priority rule act on the item", async () => {
		const s = setup({ radarr: [movie(1, { tags: [1] })] });
		live(s);
		s.rule("first", old(100), { action: "delete", priority: 1, excludeTags: ["keep"] });
		s.rule("second", old(100), { action: "unmonitor", priority: 2 });
		expect(await removed(s)).toEqual(["unmonitor:1"]);
	});
	it("a cleanup condition can embed its own protection with NOT", async () => {
		const s = setup({ radarr: [movie(1, { tags: [1] }), movie(2)] });
		live(s);
		s.rule("old unless keep", { op: "and", of: [old(100), { op: "not", of: tag("keep") }] });
		expect(await removed(s)).toEqual(["delete:2:true"]);
	});
	it("with Plex down, an OR decided by a library fact still acts; an AND with a watch rule does not", async () => {
		const a = setup({ radarr: [movie(1)], watch: "fail" });
		live(a);
		a.rule("big or unwatched", { op: "or", of: [{ type: "size", params: { operator: "greater_than", sizeGb: 5 } }, { type: "watch_count", params: { operator: "equals", count: 0 } }] });
		expect(await removed(a)).toEqual(["delete:1:true"]);

		const b = setup({ radarr: [movie(1)], watch: "fail" });
		live(b);
		b.rule("big and unwatched", { op: "and", of: [{ type: "size", params: { operator: "greater_than", sizeGb: 5 } }, { type: "watch_count", params: { operator: "equals", count: 0 } }] });
		expect(await removed(b)).toEqual([]);
	});
	it("with Plex up, the same AND acts only on unwatched items", async () => {
		const s = setup({
			radarr: [movie(1), movie(2)],
			watch: { "movie:1001": { lastWatchedAt: new Date(NOW.getTime() - 5 * DAY), watchCount: 3, watchedBy: ["Alice"] } },
		});
		live(s);
		s.rule("big and unwatched", { op: "and", of: [{ type: "size", params: { operator: "greater_than", sizeGb: 5 } }, { type: "watch_count", params: { operator: "equals", count: 0 } }] });
		expect(await removed(s)).toEqual(["delete:2:true"]);
	});
	it("explain reports every rule's state for a mixed library item", async () => {
		const s = setup({ radarr: [movie(1, { tags: [1] })], watch: "fail" });
		s.rule("old", old(100), { priority: 1 });
		s.rule("unwatched", { type: "watch_count", params: { operator: "equals", count: 0 } }, { priority: 2 });
		s.rule("keep", tag("keep"), { priority: 3, mode: "retention" });
		const e = await s.engine.explain(s.radarr.id, 1);
		expect(Object.fromEntries(e.rules.map((r) => [r.name, r.state]))).toEqual({ old: "true", unwatched: "unknown", keep: "true" });
	});
});
