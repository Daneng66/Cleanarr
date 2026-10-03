import { z } from "zod";
import type { SeerrRequest } from "../seerr/seerr.js";
import type { FileInfo, LibraryItem, WatchInfo } from "../types.js";
import { getRegexError, safeRegex } from "./regex.js";

export type Tri = "true" | "false" | "unknown";
export interface Eval {
	state: Tri;
	/** Human-readable statement of the condition; phrased as a fact when state is "true". */
	reason: string;
}
export interface EvalContext {
	now: Date;
	/** null = watch provider unavailable; watch rules then evaluate to "unknown". */
	watch: ((item: LibraryItem) => WatchInfo | null | undefined) | null;
	/** null = Seerr unavailable; request rules then evaluate to "unknown". */
	seerr: ((item: LibraryItem) => SeerrRequest[]) | null;
}

export type FieldKind = "number" | "text" | "select" | "list" | "boolean";
export interface FieldMeta {
	name: string;
	label: string;
	kind: FieldKind;
	options?: string[];
	optional?: boolean;
	placeholder?: string;
	/** "requesters": the editor offers Seerr users to pick from instead of free text. */
	source?: "requesters";
	/** Operator values that make this field irrelevant; the editor hides it and sends nothing for it. */
	hideFor?: string[];
}
export type RuleGroup = "Library" | "File" | "Watch history" | "Requests";

export interface RuleTypeDef {
	type: string;
	label: string;
	group: RuleGroup;
	description: string;
	fields: FieldMeta[];
	schema: z.ZodType<Record<string, unknown>>;
	needs?: "files" | "watch" | "seerr" | "watch+seerr" | "watch+files";
	evaluate(item: LibraryItem, params: any, ctx: EvalContext): Eval;
}

const DAY = 86_400_000;
const T = (reason: string): Eval => ({ state: "true", reason });
const F = (reason: string): Eval => ({ state: "false", reason });
const U = (reason: string): Eval => ({ state: "unknown", reason });
const check = (ok: boolean, reason: string): Eval => (ok ? T(reason) : F(reason));
const lc = (s: string) => s.toLowerCase();
const inList = (value: string | null, list: string[]) => value !== null && list.some((x) => lc(x) === lc(value));
/**
 * Ratings that mean "fine for children" in the country Radarr/Sonarr reports them for. Matched without knowing the
 * country, so a value that is a kids' rating anywhere counts: for a protect rule that errs toward keeping more.
 * 12-and-over ratings count as children's (owner's choice), in every spelling seen: 12, 12A, 12+, -12, FSK 12.
 * Deliberately absent: "A" (all ages in Spain, adults-only in India), "13", PG-13, TV-PG.
 */
const KIDS_RATINGS_BY_COUNTRY: Record<string, string[]> = {
	US: ["G", "PG", "TV-Y", "TV-Y7", "TV-Y7-FV", "TV-G"],
	GB: ["U", "PG", "Uc"],
	IE: ["G", "PG"],
	CA: ["G", "PG", "C", "C8"],
	AU: ["G", "PG", "P", "C"],
	NZ: ["G", "PG"],
	DE: ["0", "6", "FSK 0", "FSK 6"],
	AT: ["0", "6"],
	FR: ["U", "TP", "Tous publics"],
	NL: ["AL", "6"],
	BE: ["AL", "KT", "6"],
	ES: ["APTA", "TP", "7"],
	IT: ["T"],
	SE: ["Btl", "7"],
	NO: ["6"],
	DK: ["7"],
	FI: ["S", "K-7"],
	BR: ["L", "10"],
	JP: ["G"],
	KR: ["ALL", "All"],
	IN: ["U"],
	"12": ["12", "12A", "12+", "-12", "FSK 12", "12PG"],
};
const KIDS_RATINGS = new Set(Object.values(KIDS_RATINGS_BY_COUNTRY).flat().map((r) => r.toLowerCase()));
const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;
const daysAgo = (d: Date, now: Date) => Math.floor((now.getTime() - d.getTime()) / DAY);

const strList = z.array(z.string().min(1)).min(1);
const cmp = z.enum(["greater_than", "less_than"]);

function compare(value: number, op: "greater_than" | "less_than", target: number) {
	return op === "greater_than" ? value > target : value < target;
}

/** True/false/unknown across all files: matches when any file satisfies `pred`. */
function anyFile(
	item: LibraryItem,
	label: string,
	pred: (f: FileInfo) => boolean | null,
): Eval {
	if (item.files === null) return U(`${label} (file details unavailable)`);
	if (item.files.length === 0) return F(`${label} (no files)`);
	let unknown = false;
	for (const f of item.files) {
		const r = pred(f);
		if (r === true) return T(label);
		if (r === null) unknown = true;
	}
	return unknown ? U(`${label} (metadata missing)`) : F(label);
}

const defs: RuleTypeDef[] = [
	// ── Library ────────────────────────────────────────────────────────────
	{
		type: "age",
		label: "Age in library",
		group: "Library",
		description: "How long ago the item was added to Sonarr/Radarr.",
		fields: [
			{ name: "operator", label: "Operator", kind: "select", options: ["older_than", "newer_than"] },
			{ name: "days", label: "Days", kind: "number" },
		],
		schema: z.object({ operator: z.enum(["older_than", "newer_than"]), days: z.number().int().min(1) }),
		evaluate(item, p, ctx) {
			const label = `Added ${p.operator === "older_than" ? "more" : "less"} than ${p.days} days ago`;
			if (!item.added) return U(`${label} (no added date)`);
			const age = daysAgo(item.added, ctx.now);
			return check(p.operator === "older_than" ? age > p.days : age < p.days, `${label} (${age} days)`);
		},
	},
	{
		type: "size",
		label: "Size on disk",
		group: "Library",
		description: "Total size of the item's files.",
		fields: [
			{ name: "operator", label: "Operator", kind: "select", options: ["greater_than", "less_than"] },
			{ name: "sizeGb", label: "Size (GB)", kind: "number" },
		],
		schema: z.object({ operator: cmp, sizeGb: z.number().positive() }),
		evaluate(item, p) {
			const label = `Size ${p.operator === "greater_than" ? ">" : "<"} ${p.sizeGb} GB`;
			return check(compare(item.sizeOnDisk, p.operator, p.sizeGb * 1024 ** 3), `${label} (${gb(item.sizeOnDisk)})`);
		},
	},
	{
		type: "rating",
		label: "Rating (TMDb/Arr)",
		group: "Library",
		description: "Rating reported by Radarr (TMDb) or Sonarr.",
		fields: [
			{ name: "operator", label: "Operator", kind: "select", options: ["less_than", "greater_than", "unrated"] },
			{ name: "score", label: "Score (0–10)", kind: "number", optional: true, hideFor: ["unrated"] },
		],
		schema: z
			.object({ operator: z.enum(["less_than", "greater_than", "unrated"]), score: z.number().min(0).max(10).optional() })
			.refine((v) => v.operator === "unrated" || v.score !== undefined, { message: "score is required" }),
		evaluate: (item, p) => ratingEval(item.rating, "Rating", p),
	},
	{
		type: "imdb_rating",
		label: "IMDb rating",
		group: "Library",
		description: "IMDb rating (Radarr only).",
		fields: [
			{ name: "operator", label: "Operator", kind: "select", options: ["less_than", "greater_than", "unrated"] },
			{ name: "score", label: "Score (0–10)", kind: "number", optional: true, hideFor: ["unrated"] },
		],
		schema: z
			.object({ operator: z.enum(["less_than", "greater_than", "unrated"]), score: z.number().min(0).max(10).optional() })
			.refine((v) => v.operator === "unrated" || v.score !== undefined, { message: "score is required" }),
		evaluate: (item, p) => ratingEval(item.imdbRating, "IMDb rating", p),
	},
	{
		type: "status",
		label: "Release status",
		group: "Library",
		description: "e.g. ended, continuing, released, announced.",
		fields: [{ name: "statuses", label: "Statuses", kind: "list", placeholder: "ended, released" }],
		schema: z.object({ statuses: strList }),
		evaluate: (item, p) => check(inList(item.status, p.statuses), `Status is ${p.statuses.join("/")} (${item.status ?? "none"})`),
	},
	{
		type: "monitored",
		label: "Is monitored",
		group: "Library",
		description: "Item is monitored.",
		fields: [],
		schema: z.object({}),
		evaluate: (item) => check(item.monitored, "Item is monitored"),
	},
	{
		type: "unmonitored",
		label: "Is unmonitored",
		group: "Library",
		description: "Item is not monitored.",
		fields: [],
		schema: z.object({}),
		evaluate: (item) => check(!item.monitored, "Item is unmonitored"),
	},
	{
		type: "genre",
		label: "Genre",
		group: "Library",
		description: "Match on genres.",
		fields: [
			{ name: "operator", label: "Operator", kind: "select", options: ["includes_any", "excludes_all"] },
			{ name: "genres", label: "Genres", kind: "list" },
		],
		schema: z.object({ operator: z.enum(["includes_any", "excludes_all"]), genres: strList }),
		evaluate(item, p) {
			const hit = item.genres.some((g) => inList(g, p.genres));
			return p.operator === "includes_any"
				? check(hit, `Genre includes ${p.genres.join("/")}`)
				: check(!hit, `Genre excludes ${p.genres.join("/")}`);
		},
	},
	{
		type: "certification",
		label: "Content rating",
		group: "Library",
		description: "Age rating from Plex when available, otherwise from Radarr/Sonarr. \"Suitable for kids\" recognises children's ratings from many countries. Items without a rating are unknown.",
		fields: [
			{ name: "operator", label: "Operator", kind: "select", options: ["suitable_for_kids", "includes_any", "excludes_all"] },
			{ name: "ratings", label: "Ratings", kind: "list", placeholder: "e.g. PG-13, TV-14", optional: true, hideFor: ["suitable_for_kids"] },
		],
		schema: z
			.object({ operator: z.enum(["suitable_for_kids", "includes_any", "excludes_all"]), ratings: strList.optional() })
			.refine((v) => v.operator === "suitable_for_kids" || v.ratings !== undefined, { message: "ratings are required" }),
		evaluate(item, p) {
			if (item.certification === null) return U("No content rating");
			if (p.operator === "suitable_for_kids") return check(KIDS_RATINGS.has(lc(item.certification)), `Rated ${item.certification}`);
			const hit = inList(item.certification, p.ratings as string[]);
			return p.operator === "includes_any"
				? check(hit, `Rated ${item.certification} (one of ${(p.ratings as string[]).join("/")})`)
				: check(!hit, `Rated ${item.certification} (not ${(p.ratings as string[]).join("/")})`);
		},
	},
	{
		type: "year_range",
		label: "Release year",
		group: "Library",
		description: "Year within a range.",
		fields: [
			{ name: "minYear", label: "From year", kind: "number", optional: true },
			{ name: "maxYear", label: "To year", kind: "number", optional: true },
		],
		schema: z
			.object({ minYear: z.number().int().optional(), maxYear: z.number().int().optional() })
			.refine((v) => v.minYear !== undefined || v.maxYear !== undefined, { message: "minYear or maxYear required" }),
		evaluate(item, p) {
			const label = `Year in ${p.minYear ?? "…"}–${p.maxYear ?? "…"}`;
			if (item.year === null) return U(`${label} (no year)`);
			return check((p.minYear === undefined || item.year >= p.minYear) && (p.maxYear === undefined || item.year <= p.maxYear), `${label} (${item.year})`);
		},
	},
	{
		type: "no_file",
		label: "Has no files",
		group: "Library",
		description: "Nothing downloaded on disk.",
		fields: [],
		schema: z.object({}),
		evaluate: (item) => check(!item.hasFile, "Item has no files"),
	},
	{
		type: "quality_profile",
		label: "Quality profile",
		group: "Library",
		description: "Item uses one of these quality profiles.",
		fields: [{ name: "profiles", label: "Profile names", kind: "list" }],
		schema: z.object({ profiles: strList }),
		evaluate(item, p) {
			if (item.qualityProfileName === null) return U("Quality profile unknown");
			return check(inList(item.qualityProfileName, p.profiles), `Quality profile is ${p.profiles.join("/")} (${item.qualityProfileName})`);
		},
	},
	{
		type: "language",
		label: "Original language",
		group: "Library",
		description: "Original language of the title.",
		fields: [
			{ name: "operator", label: "Operator", kind: "select", options: ["is", "is_not"] },
			{ name: "languages", label: "Languages", kind: "list" },
		],
		schema: z.object({ operator: z.enum(["is", "is_not"]), languages: strList }),
		evaluate(item, p) {
			if (item.originalLanguage === null) return U("Original language unknown");
			const hit = inList(item.originalLanguage, p.languages);
			return check(p.operator === "is" ? hit : !hit, `Original language ${p.operator === "is" ? "is" : "is not"} ${p.languages.join("/")} (${item.originalLanguage})`);
		},
	},
	{
		type: "tag_match",
		label: "Arr tag",
		group: "Library",
		description: "Match on Sonarr/Radarr tag labels.",
		fields: [
			{ name: "operator", label: "Operator", kind: "select", options: ["includes_any", "excludes_all"] },
			{ name: "tags", label: "Tags", kind: "list" },
		],
		schema: z.object({ operator: z.enum(["includes_any", "excludes_all"]), tags: strList }),
		evaluate(item, p) {
			const hit = item.tags.some((t) => inList(t, p.tags));
			return p.operator === "includes_any"
				? check(hit, `Has tag ${p.tags.join("/")}`)
				: check(!hit, `Has none of tags ${p.tags.join("/")}`);
		},
	},
	{
		type: "file_path",
		label: "Path",
		group: "Library",
		description: "Match the item's folder path.",
		fields: [
			{ name: "operator", label: "Operator", kind: "select", options: ["contains", "not_contains", "matches"] },
			{ name: "value", label: "Value", kind: "text" },
		],
		schema: z
			.object({ operator: z.enum(["contains", "not_contains", "matches"]), value: z.string().min(1) })
			.superRefine((v, ctx) => {
				const err = v.operator === "matches" ? getRegexError(v.value) : null;
				if (err) ctx.addIssue({ code: "custom", message: err, path: ["value"] });
			}),
		evaluate(item, p) {
			if (!item.path) return U("Path unknown");
			const label = `Path ${p.operator.replace("_", " ")} "${p.value}"`;
			if (p.operator === "matches") {
				const re = safeRegex(p.value);
				return re ? check(re.test(item.path), label) : U(`${label} (unsafe pattern)`);
			}
			const has = lc(item.path).includes(lc(p.value));
			return check(p.operator === "contains" ? has : !has, label);
		},
	},
	{
		type: "runtime",
		label: "Runtime",
		group: "Library",
		description: "Runtime in minutes.",
		fields: [
			{ name: "operator", label: "Operator", kind: "select", options: ["greater_than", "less_than"] },
			{ name: "minutes", label: "Minutes", kind: "number" },
		],
		schema: z.object({ operator: cmp, minutes: z.number().positive() }),
		evaluate(item, p) {
			const label = `Runtime ${p.operator === "greater_than" ? ">" : "<"} ${p.minutes} min`;
			return item.runtime === null ? U(`${label} (unknown)`) : check(compare(item.runtime, p.operator, p.minutes), `${label} (${item.runtime})`);
		},
	},

	// ── File metadata ──────────────────────────────────────────────────────
	{
		type: "resolution",
		label: "Resolution",
		group: "File",
		description: "Vertical resolution of any file (e.g. 2160, 1080, 720).",
		needs: "files",
		fields: [
			{ name: "operator", label: "Operator", kind: "select", options: ["at_most", "at_least", "equals"] },
			{ name: "lines", label: "Lines (e.g. 1080)", kind: "number" },
		],
		schema: z.object({ operator: z.enum(["at_most", "at_least", "equals"]), lines: z.number().int().positive() }),
		evaluate: (item, p) =>
			anyFile(item, `Resolution ${p.operator.replace("_", " ")} ${p.lines}p`, (f) =>
				f.resolution === null ? null : p.operator === "at_most" ? f.resolution <= p.lines : p.operator === "at_least" ? f.resolution >= p.lines : f.resolution === p.lines,
			),
	},
	{
		type: "video_codec",
		label: "Video codec",
		group: "File",
		description: "e.g. x264, x265, AV1.",
		needs: "files",
		fields: [{ name: "codecs", label: "Codecs", kind: "list" }],
		schema: z.object({ codecs: strList }),
		evaluate: (item, p) => anyFile(item, `Video codec is ${p.codecs.join("/")}`, (f) => (f.videoCodec === null ? null : inList(f.videoCodec, p.codecs))),
	},
	{
		type: "audio_codec",
		label: "Audio codec",
		group: "File",
		description: "e.g. AAC, EAC3, TrueHD.",
		needs: "files",
		fields: [{ name: "codecs", label: "Codecs", kind: "list" }],
		schema: z.object({ codecs: strList }),
		evaluate: (item, p) => anyFile(item, `Audio codec is ${p.codecs.join("/")}`, (f) => (f.audioCodec === null ? null : inList(f.audioCodec, p.codecs))),
	},
	{
		type: "audio_channels",
		label: "Audio channels",
		group: "File",
		description: "Channel count (2, 5.1 → 6, 7.1 → 8).",
		needs: "files",
		fields: [
			{ name: "operator", label: "Operator", kind: "select", options: ["greater_than", "less_than"] },
			{ name: "channels", label: "Channels", kind: "number" },
		],
		schema: z.object({ operator: cmp, channels: z.number().positive() }),
		evaluate: (item, p) =>
			anyFile(item, `Audio channels ${p.operator === "greater_than" ? ">" : "<"} ${p.channels}`, (f) =>
				f.audioChannels === null ? null : compare(f.audioChannels, p.operator, p.channels),
			),
	},
	{
		type: "hdr_type",
		label: "HDR type",
		group: "File",
		description: "e.g. HDR10, DolbyVision, or SDR for none.",
		needs: "files",
		fields: [{ name: "types", label: "HDR types", kind: "list", placeholder: "HDR10, DolbyVision, SDR" }],
		schema: z.object({ types: strList }),
		evaluate: (item, p) =>
			anyFile(item, `HDR type is ${p.types.join("/")}`, (f) => {
				const actual = f.hdr ?? "SDR";
				return p.types.some((t: string) => lc(actual).includes(lc(t)));
			}),
	},
	{
		type: "custom_format_score",
		label: "Custom format score",
		group: "File",
		description: "Custom format score of any file.",
		needs: "files",
		fields: [
			{ name: "operator", label: "Operator", kind: "select", options: ["greater_than", "less_than"] },
			{ name: "score", label: "Score", kind: "number" },
		],
		schema: z.object({ operator: cmp, score: z.number() }),
		evaluate: (item, p) =>
			anyFile(item, `Custom format score ${p.operator === "greater_than" ? ">" : "<"} ${p.score}`, (f) =>
				f.customFormatScore === null ? null : compare(f.customFormatScore, p.operator, p.score),
			),
	},
	{
		type: "release_group",
		label: "Release group",
		group: "File",
		description: "Release group of any file.",
		needs: "files",
		fields: [{ name: "groups", label: "Groups", kind: "list" }],
		schema: z.object({ groups: strList }),
		evaluate: (item, p) => anyFile(item, `Release group is ${p.groups.join("/")}`, (f) => (f.releaseGroup === null ? null : inList(f.releaseGroup, p.groups))),
	},

	// ── Watch history (Plex) ───────────────────────────────────────────
	{
		type: "last_watched",
		label: "Last watched",
		group: "Watch history",
		description:
			"Never-watched items only match 'not watched in N days' once they have been in the library longer than N days.",
		needs: "watch",
		fields: [
			{ name: "operator", label: "Operator", kind: "select", options: ["not_watched_in_days", "watched_within_days"] },
			{ name: "days", label: "Days", kind: "number" },
		],
		schema: z.object({ operator: z.enum(["not_watched_in_days", "watched_within_days"]), days: z.number().int().min(1) }),
		evaluate(item, p, ctx) {
			const w = watchOf(item, ctx);
			if (!w) return U("Watch history unavailable");
			if (p.operator === "watched_within_days") {
				return check(w.lastWatchedAt !== null && daysAgo(w.lastWatchedAt, ctx.now) < p.days, `Watched within ${p.days} days`);
			}
			const label = `Not watched in ${p.days} days`;
			if (w.lastWatchedAt) {
				const d = daysAgo(w.lastWatchedAt, ctx.now);
				return check(d > p.days, `${label} (last watched ${d} days ago)`);
			}
			// Never watched: only meaningful if the item has existed long enough to have been watched.
			if (!item.added) return U(`${label} (never watched, added date unknown)`);
			const age = daysAgo(item.added, ctx.now);
			return check(age > p.days, `${label} (never watched, in library ${age} days)`);
		},
	},
	{
		type: "watch_count",
		label: "Watch count",
		group: "Watch history",
		description: "Total plays recorded across all users.",
		needs: "watch",
		fields: [
			{ name: "operator", label: "Operator", kind: "select", options: ["less_than", "greater_than", "equals"] },
			{ name: "count", label: "Plays", kind: "number" },
		],
		schema: z.object({ operator: z.enum(["less_than", "greater_than", "equals"]), count: z.number().int().min(0) }),
		evaluate(item, p, ctx) {
			const w = watchOf(item, ctx);
			if (!w) return U("Watch history unavailable");
			const label = `Watch count ${p.operator.replace("_", " ")} ${p.count}`;
			const ok = p.operator === "less_than" ? w.watchCount < p.count : p.operator === "greater_than" ? w.watchCount > p.count : w.watchCount === p.count;
			return check(ok, `${label} (${w.watchCount})`);
		},
	},
	{
		type: "watched_by",
		label: "Watched by",
		group: "Watch history",
		description: "Whether specific users have watched it.",
		needs: "watch",
		fields: [
			{ name: "operator", label: "Operator", kind: "select", options: ["watched_by_any", "not_watched_by_any"] },
			{ name: "users", label: "Users", kind: "list" },
		],
		schema: z.object({ operator: z.enum(["watched_by_any", "not_watched_by_any"]), users: strList }),
		evaluate(item, p, ctx) {
			const w = watchOf(item, ctx);
			if (!w) return U("Watch history unavailable");
			const hit = w.watchedBy.some((u) => inList(u, p.users));
			return check(p.operator === "watched_by_any" ? hit : !hit, `${p.operator === "watched_by_any" ? "Watched by" : "Not watched by"} ${p.users.join("/")}`);
		},
	},
	{
		type: "stale_unwatched_episode",
		label: "Has an episode unwatched for a while",
		group: "Watch history",
		description: "Seasons only (use the \"Delete season\" action): at least one episode with a file that nobody has watched in that many days since it was added. Catches episodes left behind even if the rest of the season was watched recently.",
		needs: "watch+files",
		fields: [{ name: "days", label: "Days unwatched", kind: "number" }],
		schema: z.object({ days: z.number().int().min(1) }),
		evaluate(item, p, ctx) {
			if (!item.season) return F("Only applies to seasons");
			const label = `Season ${item.season.number}`;
			const w = watchOf(item, ctx);
			if (!w) return U("Watch history unavailable");
			const watched = new Set<number>();
			for (const eps of w.episodesByUser?.values() ?? []) for (const n of eps) watched.add(n);
			const stale = item.season.episodes
				.filter((e) => e.hasFile && e.added && daysAgo(e.added, ctx.now) >= p.days && !watched.has(e.number))
				.sort((a, b) => a.added!.getTime() - b.added!.getTime());
			if (!stale.length) return F(`${label} has no episode unwatched for ${p.days}+ days`);
			const e = stale[0]!;
			return T(`${label} episode ${e.number} added ${daysAgo(e.added!, ctx.now)} days ago and is still unwatched`);
		},
	},

	// ── Requests (Seerr) ───────────────────────────────────────────────────
	{
		type: "seerr_is_requested",
		label: "Requested in Seerr",
		group: "Requests",
		description: "Whether anyone requested this title through Seerr (declined requests don't count).",
		needs: "seerr",
		fields: [{ name: "operator", label: "Operator", kind: "select", options: ["is_requested", "not_requested"] }],
		schema: z.object({ operator: z.enum(["is_requested", "not_requested"]) }),
		evaluate(item, p, ctx) {
			const reqs = seerrOf(item, ctx);
			if (!reqs) return U("Seerr data unavailable");
			return check(p.operator === "is_requested" ? reqs.length > 0 : reqs.length === 0, p.operator === "is_requested" ? "Requested in Seerr" : "Not requested in Seerr");
		},
	},
	{
		type: "seerr_requested_by",
		label: "Requested by",
		group: "Requests",
		description: "Matches Seerr display name, username, Plex name or email.",
		needs: "seerr",
		fields: [
			{ name: "operator", label: "Operator", kind: "select", options: ["any_of", "none_of"] },
			{ name: "users", label: "Users", kind: "list", source: "requesters" },
		],
		schema: z.object({ operator: z.enum(["any_of", "none_of"]), users: strList }),
		evaluate(item, p, ctx) {
			const reqs = seerrOf(item, ctx);
			if (!reqs) return U("Seerr data unavailable");
			const hit = reqs.some((r) => r.requesters.some((n) => inList(n, p.users)));
			return check(p.operator === "any_of" ? hit : !hit, `${p.operator === "any_of" ? "Requested by" : "Not requested by"} ${p.users.join("/")}`);
		},
	},
	{
		type: "seerr_request_age",
		label: "Request age",
		group: "Requests",
		description: "Age of the most recent request. Items with no request never match.",
		needs: "seerr",
		fields: [
			{ name: "operator", label: "Operator", kind: "select", options: ["older_than", "newer_than"] },
			{ name: "days", label: "Days", kind: "number" },
		],
		schema: z.object({ operator: z.enum(["older_than", "newer_than"]), days: z.number().int().min(1) }),
		evaluate(item, p, ctx) {
			const reqs = seerrOf(item, ctx);
			if (!reqs) return U("Seerr data unavailable");
			const label = `Last requested ${p.operator === "older_than" ? "more" : "less"} than ${p.days} days ago`;
			if (!reqs.length) return F(`${label} (never requested)`);
			const newest = Math.max(...reqs.map((r) => r.createdAt.getTime()));
			const age = daysAgo(new Date(newest), ctx.now);
			return check(p.operator === "older_than" ? age > p.days : age < p.days, `${label} (${age} days)`);
		},
	},
	{
		type: "seerr_request_count",
		label: "Request count",
		group: "Requests",
		description: "Number of (non-declined) requests.",
		needs: "seerr",
		fields: [
			{ name: "operator", label: "Operator", kind: "select", options: ["less_than", "greater_than", "equals"] },
			{ name: "count", label: "Requests", kind: "number" },
		],
		schema: z.object({ operator: z.enum(["less_than", "greater_than", "equals"]), count: z.number().int().min(0) }),
		evaluate(item, p, ctx) {
			const reqs = seerrOf(item, ctx);
			if (!reqs) return U("Seerr data unavailable");
			const n = reqs.length;
			const ok = p.operator === "less_than" ? n < p.count : p.operator === "greater_than" ? n > p.count : n === p.count;
			return check(ok, `Request count ${p.operator.replace("_", " ")} ${p.count} (${n})`);
		},
	},
	{
		type: "seerr_requester_watched",
		label: "Requester has watched",
		group: "Requests",
		description:
			"Combines Seerr and watch history: has the person who requested it watched it? Items with no request never match either option. Optionally limit to particular requesters (any one of them).",
		needs: "watch+seerr",
		// No operator field in the editor: use the Not toggle for "has not watched". Saved rules may still carry one.
		fields: [{ name: "users", label: "Only these requesters", kind: "list", optional: true, source: "requesters", placeholder: "Leave empty for any requester" }],
		schema: z.object({ operator: z.enum(["requester_watched", "requester_not_watched"]).default("requester_watched"), users: strList.optional() }),
		evaluate(item, p, ctx) {
			const reqs = seerrOf(item, ctx);
			if (!reqs) return U("Seerr data unavailable");
			const w = watchOf(item, ctx);
			if (!w) return U("Watch history unavailable");
			const mine = p.users?.length ? reqs.filter((r) => r.requesters.some((n) => inList(n, p.users))) : reqs;
			if (!mine.length) return F(p.users?.length ? `Not requested by ${p.users.join("/")}` : "No requester");
			const names = mine.flatMap((r) => r.requesters);
			if (!names.length) return U("Requester has no name to match against watch history");
			const watched = w.watchedBy.some((u) => inList(u, names));
			return check(p.operator === "requester_watched" ? watched : !watched, p.operator === "requester_watched" ? "Requester has watched it" : "Requester has not watched it");
		},
	},
	{
		type: "season_requester_watched",
		label: "Requester watched the whole season",
		group: "Requests",
		description:
			"Seasons only (use the \"Delete season\" action): the person who requested the season in Seerr has watched every episode of it. Seasons still airing never match. Optionally limit to particular requesters.",
		needs: "watch+seerr",
		fields: [{ name: "users", label: "Only these requesters", kind: "list", optional: true, source: "requesters", placeholder: "Leave empty for any requester" }],
		schema: z.object({ users: z.array(z.string().min(1)).optional() }),
		evaluate(item, p, ctx) {
			if (!item.season) return F("Only applies to seasons");
			const label = `Season ${item.season.number}`;
			const reqs = seerrOf(item, ctx);
			if (!reqs) return U("Seerr data unavailable");
			const w = watchOf(item, ctx);
			if (!w) return U("Watch history unavailable");
			const mine = p.users?.length ? reqs.filter((r) => r.requesters.some((n) => inList(n, p.users))) : reqs;
			if (!mine.length) return F(p.users?.length ? `${label} was not requested by ${p.users.join("/")}` : `${label} was not requested`);
			const names = mine.flatMap((r) => r.requesters);
			if (!names.length) return U("Requester has no name to match against watch history");
			const eps = item.season.episodes;
			if (!eps.length) return U(`${label} episode list unavailable`);
			if (eps.some((e) => !e.airDate || e.airDate > ctx.now)) return F(`${label} is still airing`);
			let best = { user: "", seen: 0 };
			for (const [user, seen] of w.episodesByUser ?? []) {
				if (!inList(user, names)) continue;
				const n = eps.filter((e) => seen.has(e.number)).length;
				if (n > best.seen) best = { user, seen: n };
			}
			if (best.seen === eps.length) return T(`${label} fully watched by requester ${best.user} (${eps.length} episodes)`);
			return F(`Requester has watched ${best.seen} of ${eps.length} episodes of ${label.toLowerCase()}`);
		},
	},
];

function seerrOf(item: LibraryItem, ctx: EvalContext): SeerrRequest[] | null {
	if (!ctx.seerr) return null;
	if (item.tmdbId === null && item.tvdbId === null) return null;
	return ctx.seerr(item);
}

function ratingEval(value: number | null, name: string, p: { operator: string; score?: number }): Eval {
	if (p.operator === "unrated") return check(value === null || value === 0, `${name} is missing`);
	if (value === null) return U(`${name} unavailable`);
	const label = `${name} ${p.operator === "less_than" ? "<" : ">"} ${p.score}`;
	return check(p.operator === "less_than" ? value < (p.score as number) : value > (p.score as number), `${label} (${value})`);
}

/** Watch info for the item; items with no ids can't be matched, so they're unknown rather than "never watched". */
function watchOf(item: LibraryItem, ctx: EvalContext): WatchInfo | null {
	if (!ctx.watch) return null;
	if (item.tmdbId === null && item.tvdbId === null) return null;
	return ctx.watch(item) ?? { lastWatchedAt: null, watchCount: 0, watchedBy: [] };
}

export const RULE_TYPES: ReadonlyMap<string, RuleTypeDef> = new Map(defs.map((d) => [d.type, d]));

export function describeRuleTypes() {
	return defs.map(({ type, label, group, description, fields, needs }) => ({ type, label, group, description, fields, needs: needs ?? null }));
}
