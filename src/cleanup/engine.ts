import { randomUUID } from "node:crypto";
import type { ArrApi } from "../arr/client.js";
import { normalizeItem, seasonItems } from "../arr/normalize.js";
import { evaluateExpression, parseExpression, requirements, type EvalNode, type Expression } from "../rules/expression.js";
import { passesFilters } from "../rules/filters.js";
import type { EvalContext } from "../rules/registry.js";
import type { ApprovalRow, SafetySnapshot, Store } from "../store.js";
import type { SeerrProvider, SeerrRequest } from "../seerr/seerr.js";
import type { WatchProvider } from "../watch/plex.js";
import { mergeEpisodes } from "../watch/plex.js";
import type { CleanupAction, Candidate, ConfigRecord, Instance, LibraryItem, RuleRecord, Trigger, WatchInfo } from "../types.js";

export interface Logger {
	info(obj: unknown, msg?: string): void;
	warn(obj: unknown, msg?: string): void;
	error(obj: unknown, msg?: string): void;
}

export interface EngineDeps {
	store: Store;
	arr: (instance: Instance) => ArrApi;
	watch: (instance: Instance) => WatchProvider;
	seerr: (instance: Instance) => SeerrProvider;
	now?: () => Date;
	log: Logger;
}

export class ConflictError extends Error {
	constructor(message: string, readonly code?: "dry_run" | "in_progress") {
		super(message);
	}
}

const LEASE_STALE_MS = 30 * 60_000;
const MAX_DETAILS = 2000;
const MAX_ATTEMPTS = 3;
const FILE_FETCH_CONCURRENCY = 4;

export type Outcome = "flagged" | "pending" | "removed" | "unmonitored" | "files_deleted" | "skipped" | "blocked" | "failed";
export interface RunDetail {
	instanceId: string;
	arrItemId: number;
	itemType: string;
	/** Season items only. */
	seasonNumber?: number;
	title: string;
	ruleId: string;
	ruleName: string;
	action: CleanupAction;
	reason: string;
	sizeOnDisk: number;
	poster?: string | null;
	certification?: string | null;
	outcome: Outcome;
	message?: string;
}

interface Snapshot {
	items: LibraryItem[];
	apis: Map<string, ArrApi>;
	instances: Map<string, Instance>;
	warnings: string[];
	failedInstances: Set<string>;
	ctx: EvalContext;
}

/** What a run has to load. `seasons`: some rule acts per season, so series are also split into season items. */
type Needs = { files: boolean; watch: boolean; seerr: boolean; seasons: boolean };

interface Plan {
	candidates: Candidate[];
	skipped: RunDetail[];
	evaluated: number;
}

/** Radarr/Sonarr status meaning nothing has aired/released yet, so a missing file isn't actually missing. */
const UNRELEASED_STATUS = new Set(["tba", "announced", "inCinemas", "upcoming"]);
const isReleased = (i: LibraryItem) => i.released !== false && !UNRELEASED_STATUS.has(i.status ?? "");

/** Library totals for the dashboard. Series `files` counts episode files. */
export function librarySummary(items: LibraryItem[]) {
	const s = { movies: 0, series: 0, files: 0, missing: 0, movieBytes: 0, seriesBytes: 0, totalBytes: 0 };
	for (const i of items) {
		if (i.kind === "season") continue;
		if (i.kind === "movie") (s.movies++, (s.movieBytes += i.sizeOnDisk));
		else (s.series++, (s.seriesBytes += i.sizeOnDisk), (s.files += i.fileCount));
		if (!i.hasFile && isReleased(i)) s.missing++;
		s.totalBytes += i.sizeOnDisk;
	}
	return s;
}

export interface MissingRow {
	instanceId: string;
	arrItemId: number;
	itemType: "movie" | "series";
	title: string;
	year: number | null;
	poster: string | null;
	monitored: boolean;
	added: string | null;
	certification: string | null;
}

/** Items with nothing on disk, for the "Missing files" drill-down. */
export function missingItems(items: LibraryItem[]): MissingRow[] {
	return items
		.filter((i): i is LibraryItem & { kind: "movie" | "series" } => i.kind !== "season" && !i.hasFile && isReleased(i))
		.map((i) => ({ instanceId: i.instanceId, arrItemId: i.arrId, itemType: i.kind, title: i.title, year: i.year, poster: i.poster, monitored: i.monitored, added: i.added ? i.added.toISOString() : null, certification: i.certification }));
}

export function createEngine(deps: EngineDeps) {
	const { store, log } = deps;
	const now = deps.now ?? (() => new Date());

	// ── Data loading ───────────────────────────────────────────────────────
	async function mapLimit<T, R>(list: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
		const out: R[] = new Array(list.length);
		let next = 0;
		await Promise.all(
			Array.from({ length: Math.min(limit, list.length) }, async () => {
				while (next < list.length) {
					const i = next++;
					out[i] = await fn(list[i] as T);
				}
			}),
		);
		return out;
	}

	async function loadMaps(api: ArrApi) {
		const [tags, profiles] = await Promise.all([api.tags(), api.qualityProfiles()]);
		return {
			tags: new Map(tags.map((t) => [t.id, t.label] as const)),
			profiles: new Map(profiles.map((p) => [p.id, p.name] as const)),
		};
	}

	/** Merges several watch providers. Counts use max (providers overlap on the same plays), not sum. */
	function combineWatch(lookups: Array<(i: LibraryItem) => WatchInfo | undefined>): (i: LibraryItem) => WatchInfo | undefined {
		if (lookups.length === 1) return lookups[0] as (i: LibraryItem) => WatchInfo | undefined;
		return (item) => {
			const hits = lookups.map((l) => l(item)).filter((x): x is WatchInfo => !!x);
			if (!hits.length) return undefined;
			const dates = hits.map((h) => h.lastWatchedAt).filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime());
			const episodesByUser = mergeEpisodes(hits.map((h) => h.episodesByUser));
			return { lastWatchedAt: dates[0] ?? null, watchCount: Math.max(...hits.map((h) => h.watchCount)), watchedBy: [...new Set(hits.flatMap((h) => h.watchedBy))], ...(episodesByUser ? { episodesByUser } : {}) };
		};
	}

	/** First Plex source that has a content rating for the item wins. */
	function combineCert(lookups: Array<((i: LibraryItem) => string | undefined) | undefined>): (i: LibraryItem) => string | undefined {
		const fns = lookups.filter((f): f is (i: LibraryItem) => string | undefined => !!f);
		return (item) => {
			for (const f of fns) {
				const v = f(item);
				if (v) return v;
			}
			return undefined;
		};
	}

	/**
	 * Loads watch history (Plex) and Seerr requests when rules need them. Any provider
	 * failure makes that evidence unavailable as a whole, so dependent rules evaluate to "unknown".
	 * Plex content ratings are loaded whenever Plex is connected (regardless of `needs.watch`) so
	 * items without their own certification can fall back to Plex's.
	 */
	async function loadEvidence(needs: { watch: boolean; seerr: boolean }): Promise<{ watch: EvalContext["watch"]; seerr: EvalContext["seerr"]; cert: ((i: LibraryItem) => string | undefined) | null; warnings: string[] }> {
		const out: { watch: EvalContext["watch"]; seerr: EvalContext["seerr"]; cert: ((i: LibraryItem) => string | undefined) | null; warnings: string[] } = { watch: null, seerr: null, cert: null, warnings: [] };
		const enabled = store.instances.list().filter((i) => i.enabled);
		const plexSources = enabled.filter((i) => i.type === "plex");
		if (needs.watch && !plexSources.length) out.warnings.push("Watch-history rules are configured but no Plex instance is enabled; those rules cannot match");
		if (plexSources.length) {
			try {
				const loaded = await Promise.all(plexSources.map((i) => deps.watch(i).load()));
				if (needs.watch) {
					out.watch = combineWatch(loaded.map((l) => l.lookup));
					out.warnings.push(...loaded.flatMap((l) => l.warnings));
				}
				out.cert = combineCert(loaded.map((l) => l.certLookup));
			} catch (e) {
				if (needs.watch) out.warnings.push(`Watch history: ${(e as Error).message}; watch-history rules cannot match this run`);
			}
		}
		if (needs.seerr) {
			const sources = enabled.filter((i) => i.type === "seerr");
			if (!sources.length) out.warnings.push("Request rules are configured but no Seerr instance is enabled; those rules cannot match");
			else {
				try {
					const loaded = await Promise.all(sources.map((i) => deps.seerr(i).load()));
					out.seerr = (item) => [...new Map(loaded.flatMap((l) => l.lookup(item)).map((r: SeerrRequest) => [r.id, r])).values()];
				} catch (e) {
					out.warnings.push(`Seerr: ${(e as Error).message}; request rules cannot match this run`);
				}
			}
		}
		return out;
	}

	/** Plex's content rating wins whenever Plex has the title; Sonarr/Radarr's own certification is used only when Plex doesn't have it. */
	function applyCertFallback(items: LibraryItem[], cert: ((i: LibraryItem) => string | undefined) | null) {
		if (!cert) return;
		for (const item of items) {
			const plexCert = cert(item);
			if (plexCert) item.certification = plexCert;
		}
	}

	async function loadSnapshot(needs: Needs): Promise<Snapshot> {
		const instances = store.instances.list().filter((i) => i.enabled);
		const snap: Snapshot = {
			items: [],
			apis: new Map(),
			instances: new Map(instances.map((i) => [i.id, i])),
			warnings: [],
			failedInstances: new Set(),
			ctx: { now: now(), watch: null, seerr: null },
		};

		await Promise.all(
			instances
				.filter((i) => i.type === "sonarr" || i.type === "radarr")
				.map(async (inst) => {
					const api = deps.arr(inst);
					snap.apis.set(inst.id, api);
					try {
						const [raw, maps] = await Promise.all([api.list(), loadMaps(api)]);
						let filesBySeries = new Map<number, any[]>();
						let episodesBySeries = new Map<number, any[]>();
						if (api.service === "sonarr" && (needs.files || needs.seasons)) {
							const withFiles = raw.filter((r) => (r.statistics?.episodeFileCount ?? 0) > 0);
							if (needs.files) filesBySeries = new Map(await mapLimit(withFiles, FILE_FETCH_CONCURRENCY, async (r) => [r.id, await api.episodeFiles(r.id)] as const));
							if (needs.seasons) episodesBySeries = new Map(await mapLimit(withFiles, FILE_FETCH_CONCURRENCY, async (r) => [r.id, await api.episodes(r.id)] as const));
						}
						for (const r of raw) {
							const episodeFiles = api.service === "sonarr" && needs.files ? (filesBySeries.get(r.id) ?? []) : undefined;
							const item = normalizeItem(r, { instanceId: inst.id, service: api.service, ...maps, episodeFiles });
							snap.items.push(item);
							if (needs.seasons && api.service === "sonarr") snap.items.push(...seasonItems(item, r, episodesBySeries.get(r.id) ?? [], episodeFiles));
						}
					} catch (e) {
						snap.failedInstances.add(inst.id);
						snap.warnings.push(`${inst.name}: could not load library (${(e as Error).message}); skipped this run`);
						log.warn({ instance: inst.name, err: (e as Error).message }, "instance load failed");
					}
				}),
		);

		const ev = await loadEvidence(needs);
		snap.ctx.watch = ev.watch;
		snap.ctx.seerr = ev.seerr;
		snap.warnings.push(...ev.warnings);
		applyCertFallback(snap.items, ev.cert);
		return snap;
	}

	function activeRules(): { rules: Array<{ rule: RuleRecord; expr: Expression }>; needs: Needs; warnings: string[] } {
		const needs: Needs = { files: false, watch: false, seerr: false, seasons: false };
		const warnings: string[] = [];
		const rules: Array<{ rule: RuleRecord; expr: Expression }> = [];
		for (const rule of store.rules.list().filter((r) => r.enabled)) {
			try {
				const expr = parseExpression(rule.expression);
				const req = requirements(expr);
				needs.files ||= req.files;
				needs.watch ||= req.watch;
				needs.seerr ||= req.seerr;
				needs.seasons ||= rule.mode === "cleanup" && rule.action === "delete_season";
				rules.push({ rule, expr });
			} catch (e) {
				warnings.push(`Rule "${rule.name}" skipped: invalid expression (${(e as Error).message})`);
			}
		}
		return { rules, needs, warnings };
	}

	// ── Planning ───────────────────────────────────────────────────────────
	const targetKey = (i: LibraryItem) => `${i.instanceId}:${i.kind}:${i.arrId}${i.season ? `:${i.season.number}` : ""}`;
	const seasonOf = (i: LibraryItem) => (i.season ? { seasonNumber: i.season.number } : {});

	const detail = (c: Candidate, outcome: Outcome, message?: string): RunDetail => ({
		instanceId: c.item.instanceId,
		arrItemId: c.item.arrId,
		itemType: c.item.kind,
		...seasonOf(c.item),
		title: c.item.title,
		ruleId: c.rule.id,
		ruleName: c.rule.name,
		action: c.rule.action,
		reason: c.reason,
		sizeOnDisk: c.item.sizeOnDisk,
		poster: c.item.poster,
		certification: c.item.certification,
		outcome,
		message,
	});

	/** Applies retention and cleanup rules to every loaded item. Retention always wins, and unknown retention evidence also protects. */
	function plan(snap: Snapshot, rules: Array<{ rule: RuleRecord; expr: Expression }>): Plan {
		const retention = rules.filter((r) => r.rule.mode === "retention");
		const cleanup = rules.filter((r) => r.rule.mode === "cleanup");
		const protectedKeys = store.protected.targetKeys();
		const overrideKeys = store.protected.targetKeys(true);
		const candidates: Candidate[] = [];
		const skipped: RunDetail[] = [];
		for (const item of snap.items) {
			if (snap.failedInstances.has(item.instanceId)) continue;
			const fake = (rule: RuleRecord, reason: string): Candidate => ({ item, rule, reason });
			let protectedBy: string | null = protectedKeys.has(targetKey(item)) ? "Manually protected" : null;
			if (!protectedBy && !overrideKeys.has(targetKey(item))) {
				for (const { rule, expr } of retention) {
					if (!passesFilters(item, rule).ok) continue;
					const r = evaluateExpression(expr, item, snap.ctx);
					if (r.state !== "false") {
						protectedBy = r.state === "true" ? `Protected by retention rule "${rule.name}": ${r.reason}` : `Retention rule "${rule.name}" could not be evaluated (${r.reason})`;
						break;
					}
				}
			}
			for (const { rule, expr } of cleanup) {
				// Season items are only for "delete season" rules, and those rules only see season items.
				if ((item.kind === "season") !== (rule.action === "delete_season")) continue;
				if (!passesFilters(item, rule).ok) continue;
				const r = evaluateExpression(expr, item, snap.ctx);
				if (r.state !== "true") continue;
				if (protectedBy) skipped.push(detail(fake(rule, r.reason), "skipped", protectedBy));
				else candidates.push({ item, rule, reason: r.reason });
				break;
			}
		}
		return { candidates, skipped, evaluated: snap.items.filter((i) => i.kind !== "season").length };
	}

	/** `queued`: candidates that already have an open approval. Never re-proposed, but still worth showing (with their queue status) rather than hiding. */
	function suppress(candidates: Candidate[]): { keep: Candidate[]; skipped: RunDetail[]; queued: Candidate[] } {
		const open = store.approvals.openTargets();
		const keep: Candidate[] = [];
		const queued: Candidate[] = [];
		for (const c of candidates) {
			if (open.has(targetKey(c.item))) queued.push(c);
			else keep.push(c);
		}
		return { keep, skipped: [], queued };
	}

	function order(candidates: Candidate[]): Candidate[] {
		return [...candidates].sort((a, b) => a.rule.priority - b.rule.priority || b.item.sizeOnDisk - a.item.sizeOnDisk);
	}

	function snapshotOf(item: LibraryItem): SafetySnapshot {
		return {
			arrItemId: item.arrId,
			...seasonOf(item),
			title: item.title,
			path: item.path,
			sizeOnDisk: item.sizeOnDisk,
			fileIds: item.files ? item.files.map((f) => f.id).sort((a, b) => a - b) : null,
			fileCount: item.fileCount,
			tmdbId: item.tmdbId,
			tvdbId: item.tvdbId,
		};
	}

	// ── Mutation boundary ──────────────────────────────────────────────────
	type Revalidated = { ok: true; item: LibraryItem; api: ArrApi } | { ok: false; kind: "gone" | "blocked" | "protected"; message: string };

	/**
	 * Last check before any upstream write: re-read the live item, confirm it is still the
	 * same thing that was selected, and re-run its rule plus every retention rule on fresh data.
	 */
	async function revalidate(args: { instanceId: string; arrItemId: number; seasonNumber?: number | null; ruleId: string; snapshot: SafetySnapshot | null; requireRule: boolean }): Promise<Revalidated> {
		const inst = store.instances.get(args.instanceId);
		if (!inst || !inst.enabled) return { ok: false, kind: "blocked", message: "Instance is missing or disabled" };
		const api = deps.arr(inst);
		const rule = store.rules.get(args.ruleId);
		if (args.requireRule && (!rule || !rule.enabled || rule.mode !== "cleanup")) return { ok: false, kind: "blocked", message: "Rule was deleted or disabled" };

		let raw;
		try {
			raw = await api.get(args.arrItemId);
		} catch (e) {
			if ((e as { status?: number }).status === 404) return { ok: false, kind: "gone", message: "Item no longer exists in the library" };
			throw e;
		}
		const { rules, needs } = activeRules();
		const maps = await loadMaps(api);
		const episodeFiles = api.service === "sonarr" && (needs.files || args.snapshot?.fileIds) ? await api.episodeFiles(args.arrItemId) : undefined;
		let item = normalizeItem(raw, { instanceId: inst.id, service: api.service, ...maps, episodeFiles });
		if (args.seasonNumber != null) {
			const season = seasonItems(item, raw, await api.episodes(args.arrItemId), episodeFiles).find((s) => s.season?.number === args.seasonNumber);
			if (!season) return { ok: false, kind: "gone", message: `Season ${args.seasonNumber} no longer has files` };
			item = season;
		}
		const ev = await loadEvidence(needs);
		applyCertFallback([item], ev.cert);

		if (args.snapshot) {
			const s = args.snapshot;
			const live = snapshotOf(item);
			const mismatch =
				live.path !== s.path ? "folder path changed" :
				live.tmdbId !== s.tmdbId || live.tvdbId !== s.tvdbId ? "identity (TMDb/TVDB id) changed" :
				live.sizeOnDisk !== s.sizeOnDisk ? "size on disk changed" :
				live.fileCount !== s.fileCount || (s.fileIds && JSON.stringify(live.fileIds) !== JSON.stringify(s.fileIds)) ? "files changed" : null;
			if (mismatch) return { ok: false, kind: "blocked", message: `Item changed since it was selected (${mismatch})` };
		}
		if (store.protected.targetKeys().has(targetKey(item))) return { ok: false, kind: "protected", message: "Manually protected" };

		const ctx: EvalContext = { now: now(), watch: ev.watch, seerr: ev.seerr };
		const overridden = store.protected.targetKeys(true).has(targetKey(item));
		for (const { rule: r, expr } of rules) {
			if (overridden && r.mode === "retention") continue;
			if (r.mode === "cleanup" && r.id !== args.ruleId) continue;
			if (!passesFilters(item, r).ok) continue;
			const res = evaluateExpression(expr, item, ctx);
			if (r.mode === "retention" && res.state !== "false") {
				return { ok: false, kind: "blocked", message: `Retention rule "${r.name}" now ${res.state === "true" ? "protects this item" : "cannot be evaluated"}: ${res.reason}` };
			}
			if (r.mode === "cleanup" && r.id === args.ruleId && res.state !== "true") {
				return { ok: false, kind: "blocked", message: `Rule "${r.name}" no longer matches on fresh data (${res.state}): ${res.reason}` };
			}
		}
		return { ok: true, item, api };
	}

	async function mutate(api: ArrApi, item: Pick<LibraryItem, "arrId" | "season">, action: CleanupAction): Promise<Outcome> {
		if (action === "delete") {
			await api.deleteItem(item.arrId, { deleteFiles: true });
			return "removed";
		}
		if (action === "unmonitor") {
			await api.unmonitor(item.arrId);
			return "unmonitored";
		}
		if (action === "delete_season") {
			if (!item.season) throw new Error("Delete season needs a season");
			await api.deleteSeason(item.arrId, item.season.number);
			return "files_deleted";
		}
		await api.deleteFiles(await api.get(item.arrId));
		return "files_deleted";
	}

	const audit = (c: { instance: string; arrId: number; kind: string; title: string }, e: { correlationId: string; eventType: string; outcome: "info" | "success" | "blocked" | "failed"; trigger: Trigger; actor: string; runLogId?: string; approvalId?: string; rule?: { id: string; name: string } | null; action: string; reason: string; details?: unknown }) =>
		store.audit.append({
			correlationId: e.correlationId, eventType: e.eventType, outcome: e.outcome, trigger: e.trigger, actor: e.actor,
			runLogId: e.runLogId, approvalId: e.approvalId, instanceId: c.instance, arrItemId: c.arrId, itemType: c.kind as "movie" | "series",
			title: c.title, ruleId: e.rule?.id, ruleName: e.rule?.name, action: e.action, reason: e.reason, details: e.details,
		});

	// ── Approvals ──────────────────────────────────────────────────────────
	function approvalAudit(a: ApprovalRow, e: Omit<Parameters<typeof audit>[1], "action" | "reason" | "approvalId" | "rule"> & { reason: string }) {
		audit({ instance: a.instanceId, arrId: a.arrItemId, kind: a.itemType, title: a.seasonNumber != null ? `${a.title} (Season ${a.seasonNumber})` : a.title }, { ...e, approvalId: a.id, rule: { id: a.ruleId, name: a.ruleName }, action: a.action });
	}

	/** Approves (if still pending) and executes. Exactly one caller can win the status transition. */
	/** Best-effort: the title is already gone from Sonarr/Radarr, so a Seerr failure is logged, not retried. */
	async function clearSeerr(item: LibraryItem) {
		for (const inst of store.instances.list().filter((i) => i.enabled && i.type === "seerr")) {
			try { await deps.seerr(inst).clear(item); }
			catch (e) { log.warn({ instance: inst.name, title: item.title, err: (e as Error).message }, "seerr clear failed"); }
		}
	}

	async function approve(id: string, opts: { actor: string; trigger?: Trigger; runLogId?: string }): Promise<ApprovalRow> {
		const a0 = store.approvals.get(id);
		if (!a0) throw new ConflictError("Approval not found");
		if (store.config.get().dryRun) throw new ConflictError("Cleanup is in dry-run mode; disable dry-run in settings before executing approvals", "dry_run");
		const trigger = opts.trigger ?? (a0.status === "failed" ? "retry" : "approval");
		const token = randomUUID();
		if (!store.approvals.claim(id, token)) {
			throw new ConflictError(`Approval is ${store.approvals.get(id)?.status}; it can no longer be approved`);
		}
		const a = store.approvals.get(id) as ApprovalRow;
		const base = { correlationId: a.id, trigger, actor: opts.actor, runLogId: opts.runLogId };
		const done = (to: "reclaimed" | "failed", error?: string) => store.approvals.finish(id, to, error);
		try {
			const v = await revalidate({ instanceId: a.instanceId, arrItemId: a.arrItemId, seasonNumber: a.seasonNumber, ruleId: a.ruleId, snapshot: a.safetySnapshot, requireRule: true });
			if (!v.ok) {
				if (v.kind === "gone") {
					done("reclaimed", "Already removed before execution; no mutation performed");
					approvalAudit(a, { ...base, eventType: "reconciled", outcome: "info", reason: v.message });
				} else if (v.kind === "protected") {
					store.approvals.delete(id);
					approvalAudit(a, { ...base, eventType: "dequeued", outcome: "info", reason: v.message });
				} else {
					done("failed", v.message);
					approvalAudit(a, { ...base, eventType: "failed", outcome: "failed", reason: v.message });
				}
				return store.approvals.get(id) ?? { ...a, status: "failed", lastError: v.message };
			}
			await mutate(v.api, v.item, a.action);
			if (a.action === "delete") await clearSeerr(v.item);
			done("reclaimed");
			approvalAudit(a, { ...base, eventType: "reclaimed", outcome: "success", reason: a.reason, details: { sizeOnDisk: a.sizeOnDisk } });
		} catch (e) {
			const message = (e as Error).message;
			done("failed", message);
			approvalAudit(a, { ...base, eventType: "failed", outcome: "failed", reason: message });
			log.error({ approval: id, err: message }, "approval execution failed");
		}
		return store.approvals.get(id) as ApprovalRow;
	}

	// ── Runs ───────────────────────────────────────────────────────────────
	interface RunOptions {
		trigger: Trigger;
		actor?: string;
		/** Force a dry run regardless of the saved setting (used by Preview). Never the reverse. */
		forceDryRun?: boolean;
		/** Execute matches right away: runs the whole queue regardless of executeAfter, and skips the queue delay for new matches. */
		immediate?: boolean;
		/** Act on this one title only: no queue draining, no schedule bump. */
		only?: { instanceId: string; arrItemId: number; seasonNumber?: number | null };
	}

	async function run(opts: RunOptions) {
		const config = store.config.get();
		const dryRun = opts.forceDryRun === true || config.dryRun;
		const actor = opts.actor ?? (opts.trigger === "scheduled" ? "scheduler" : "operator");
		const token = store.config.claimRun(LEASE_STALE_MS);
		if (!token) throw new ConflictError("A cleanup run is already in progress", "in_progress");
		const heartbeat = setInterval(() => store.config.heartbeat(token), 60_000);
		heartbeat.unref();
		const started = Date.now();
		const runLogId = store.logs.start(opts.trigger, dryRun);
		const details: RunDetail[] = [];
		const counts = { removed: 0, unmonitored: 0, filesDeleted: 0, failed: 0, bytes: 0 };
		let warnings: string[] = [];
		let evaluated = 0;
		let flagged = 0;
		let skippedCount = 0;
		let budget = config.maxRemovalsPerRun;
		/** Executes already-queued items (due by time, or previously failed) through the normal approve() path. */
		async function executeQueued(rows: ApprovalRow[], trigger: Trigger) {
			for (const a of rows) {
				if (budget <= 0) break;
				budget--;
				const r = await approve(a.id, { actor, trigger, runLogId });
				const outcome: Outcome = !store.approvals.get(r.id) ? "skipped" : r.status === "reclaimed" ? (r.action === "unmonitor" ? "unmonitored" : r.action === "delete_files" || r.action === "delete_season" ? "files_deleted" : "removed") : "failed";
				details.push({ instanceId: r.instanceId, arrItemId: r.arrItemId, itemType: r.itemType, ...(r.seasonNumber != null ? { seasonNumber: r.seasonNumber } : {}), title: r.title, ruleId: r.ruleId, ruleName: r.ruleName, action: r.action, reason: r.reason, sizeOnDisk: r.sizeOnDisk, outcome, message: r.lastError ?? undefined });
				tally(outcome, r.sizeOnDisk);
			}
		}
		try {
			store.audit.prune(config.auditRetentionDays);
			store.approvals.recoverStuck(LEASE_STALE_MS);

			const { rules, needs, warnings: ruleWarnings } = activeRules();
			warnings = [...ruleWarnings];
			const snap = await loadSnapshot(needs);
			warnings.push(...snap.warnings);

			const p = plan(snap, rules);
			evaluated = p.evaluated;
			const { keep, queued } = suppress(p.candidates);
			details.push(...p.skipped, ...queued.map((c) => detail(c, "skipped", "Already has an open approval")));
			const { only } = opts;
			const ordered = order(keep).filter((c) => !only || (c.item.instanceId === only.instanceId && c.item.arrId === only.arrItemId && (c.item.season?.number ?? null) === (only.seasonNumber ?? null)));
			flagged = ordered.length;

			const immediate = opts.immediate === true;
			if (!dryRun && !only) {
				// Oldest-due queue items first (or, when immediate, the whole queue regardless of wait); failed items are retried every run.
				await executeQueued(store.approvals.due(budget, immediate), "queue");
			}

			for (const c of ordered) {
				if (dryRun) {
					details.push(detail(c, "flagged"));
					continue;
				}
				if (budget <= 0) {
					details.push(detail(c, "skipped", `Deferred: run budget of ${config.maxRemovalsPerRun} reached`));
					continue;
				}
				if (!immediate) budget--; // immediate execution below decrements budget itself, via executeQueued
				const approval = store.approvals.create({
					instanceId: c.item.instanceId, arrItemId: c.item.arrId, seasonNumber: c.item.season?.number ?? null, itemType: c.item.kind, title: c.item.title, year: c.item.year,
					sizeOnDisk: c.item.sizeOnDisk, ruleId: c.rule.id, ruleName: c.rule.name, reason: c.reason, action: c.rule.action,
					safetySnapshot: snapshotOf(c.item), executeAfter: new Date(now().getTime() + (immediate ? 0 : config.queueDelayDays * 86_400_000)),
				});
				approvalAudit(approval, { correlationId: approval.id, eventType: "proposed", outcome: "info", trigger: opts.trigger, actor, runLogId, reason: c.reason });
				if (immediate) await executeQueued([approval], opts.trigger);
				else details.push(detail(c, "pending"));
			}

			// Previews never move the schedule; real and scheduled runs (even dry ones) do.
			if (!opts.forceDryRun && !only) store.config.markRun(now());
			skippedCount = details.filter((d) => d.outcome === "skipped" || d.outcome === "blocked").length;
			const status = counts.failed > 0 ? "partial" : "completed";
			store.logs.finish(runLogId, { status, evaluated, flagged, removed: counts.removed, unmonitored: counts.unmonitored, filesDeleted: counts.filesDeleted, skipped: skippedCount, bytesReclaimed: counts.bytes, details: details.slice(0, MAX_DETAILS), warnings, durationMs: Date.now() - started });
			return store.logs.get(runLogId);
		} catch (e) {
			store.logs.finish(runLogId, { status: "error", evaluated, flagged, removed: counts.removed, unmonitored: counts.unmonitored, filesDeleted: counts.filesDeleted, skipped: skippedCount, bytesReclaimed: counts.bytes, details: details.slice(0, MAX_DETAILS), warnings, error: (e as Error).message, durationMs: Date.now() - started });
			throw e;
		} finally {
			clearInterval(heartbeat);
			store.config.releaseRun(token);
		}

		function tally(outcome: Outcome, size: number) {
			if (outcome === "removed") (counts.removed++, (counts.bytes += size));
			else if (outcome === "files_deleted") (counts.filesDeleted++, (counts.bytes += size));
			else if (outcome === "unmonitored") counts.unmonitored++;
			else if (outcome === "failed") counts.failed++;
		}
	}

	// ── Explain ────────────────────────────────────────────────────────────
	async function explain(instanceId: string, arrItemId: number, seasonNumber?: number | null) {
		const inst = store.instances.get(instanceId);
		if (!inst || (inst.type !== "sonarr" && inst.type !== "radarr")) throw new ConflictError("Unknown Sonarr/Radarr instance");
		const api = deps.arr(inst);
		const raw = await api.get(arrItemId);
		const { rules, needs } = activeRules();
		const maps = await loadMaps(api);
		const episodeFiles = api.service === "sonarr" && needs.files ? await api.episodeFiles(arrItemId) : undefined;
		let item = normalizeItem(raw, { instanceId, service: api.service, ...maps, episodeFiles });
		if (seasonNumber != null) {
			const season = seasonItems(item, raw, await api.episodes(arrItemId), episodeFiles).find((s) => s.season?.number === seasonNumber);
			if (!season) throw new ConflictError(`Season ${seasonNumber} has no files`);
			item = season;
		}
		const ev = await loadEvidence(needs);
		applyCertFallback([item], ev.cert);
		const ctx: EvalContext = { now: now(), watch: ev.watch, seerr: ev.seerr };
		const warnings = ev.warnings;
		return {
			item: { title: item.title, year: item.year, kind: item.kind, seasonNumber: item.season?.number ?? null, sizeOnDisk: item.sizeOnDisk, monitored: item.monitored, status: item.status, certification: item.certification, tags: item.tags, path: item.path },
			warnings,
			rules: rules.map(({ rule, expr }) => {
				const seasonScope = rule.mode === "cleanup" && (item.kind === "season") !== (rule.action === "delete_season");
				const f: ReturnType<typeof passesFilters> = seasonScope ? { ok: false, why: item.kind === "season" ? "not a season rule" : "season rules only act on seasons" } : passesFilters(item, rule);
				const ev: EvalNode | null = f.ok ? evaluateExpression(expr, item, ctx) : null;
				return { ruleId: rule.id, name: rule.name, mode: rule.mode, action: rule.action, inScope: f.ok, excludedBy: f.ok ? null : f.why, state: ev?.state ?? null, tree: ev };
			}),
		};
	}

	/** Total capacity across all enabled *arr instances; identical total+free pairs are one disk shared by several instances. Null if no instance answers. */
	async function totalCapacity(): Promise<number | null> {
		const disks = new Map<string, number>();
		await Promise.all(store.instances.list().filter((i) => i.enabled && (i.type === "sonarr" || i.type === "radarr")).map(async (inst) => {
			try { for (const d of await deps.arr(inst).diskspace()) disks.set(`${d.totalSpace}:${d.freeSpace}`, d.totalSpace); } catch (e) { log.warn({ instance: inst.name, err: (e as Error).message }, "diskspace failed"); }
		}));
		return disks.size ? [...disks.values()].reduce((a, b) => a + b, 0) : null;
	}

	/** Queues every not-yet-queued match, same as a real run would, capped at maxRemovalsPerRun. Skipped during dry run, since nothing is ever queued then. A match is never shown without a countdown. */
	function enqueueNewMatches(keep: Candidate[], config: ConfigRecord) {
		if (config.dryRun) return;
		let budget = config.maxRemovalsPerRun;
		for (const c of order(keep)) {
			if (budget-- <= 0) break;
			const approval = store.approvals.create({
				instanceId: c.item.instanceId, arrItemId: c.item.arrId, seasonNumber: c.item.season?.number ?? null, itemType: c.item.kind, title: c.item.title, year: c.item.year,
				sizeOnDisk: c.item.sizeOnDisk, ruleId: c.rule.id, ruleName: c.rule.name, reason: c.reason, action: c.rule.action,
				safetySnapshot: snapshotOf(c.item), executeAfter: new Date(now().getTime() + config.queueDelayDays * 86_400_000),
			});
			approvalAudit(approval, { correlationId: approval.id, eventType: "proposed", outcome: "info", trigger: "pickup", actor: "system", reason: c.reason });
		}
	}

	/** Preview = full evaluation, but a match is queued the moment it's found (unless dry run), so nothing is ever shown "flagged" without a countdown. No execution here; reclaiming still waits for a real run. */
	async function preview() {
		const { rules, needs, warnings: rw } = activeRules();
		const [snap, capacityBytes] = await Promise.all([loadSnapshot(needs), totalCapacity()]);
		const p = plan(snap, rules);
		const { keep, queued } = suppress(p.candidates);
		enqueueNewMatches(keep, store.config.get());
		const openRows = store.approvals.openByTarget();
		const withQueue = (c: Candidate) => {
			const a = openRows.get(targetKey(c.item));
			return { ...detail(c, "flagged"), queue: a ? { id: a.id, status: a.status, executeAfter: a.executeAfter, lastError: a.lastError } : null };
		};
		const shown = [...order(keep), ...queued];
		return {
			evaluated: p.evaluated,
			warnings: [...rw, ...snap.warnings],
			candidates: shown.map(withQueue),
			skipped: p.skipped,
			totalBytes: shown.reduce((n, c) => n + c.item.sizeOnDisk, 0),
			library: { ...librarySummary(snap.items), capacityBytes },
			missing: missingItems(snap.items),
		};
	}

	// ── Library browser ───────────────────────────────────────────────────
	/** Every movie and series, optionally narrowed by a rule-style filter (expression + scope). Only a definite "true" matches. */
	async function library(filter: { expression?: unknown; serviceFilter?: Array<"sonarr" | "radarr"> | null; instanceFilter?: string[] | null; excludeTags?: string[] | null; excludeTitles?: string[] | null }) {
		const expr = filter.expression ? parseExpression(filter.expression) : null;
		const snap = await loadSnapshot({ ...(expr ? requirements(expr) : { files: false, watch: false, seerr: false }), seasons: false });
		const scope = { serviceFilter: filter.serviceFilter ?? null, instanceFilter: filter.instanceFilter ?? null, excludeTags: filter.excludeTags ?? null, excludeTitles: filter.excludeTitles ?? null } as RuleRecord;
		const prot = new Map(store.protected.list().filter((p) => !p.ignoreRetention).map((p) => [`${p.instanceId}:${p.itemType}:${p.arrItemId}`, p.id]));
		const items = snap.items.filter((i) => !snap.failedInstances.has(i.instanceId) && passesFilters(i, scope).ok && (!expr || evaluateExpression(expr, i, snap.ctx).state === "true"));
		return {
			warnings: snap.warnings,
			total: snap.items.length,
			items: items.map((i) => ({
				instanceId: i.instanceId, service: i.service, arrItemId: i.arrId, itemType: i.kind as "movie" | "series", title: i.title, year: i.year, poster: i.poster,
				sizeOnDisk: i.sizeOnDisk, monitored: i.monitored, hasFile: i.hasFile, status: i.status, added: i.added ? i.added.toISOString() : null, certification: i.certification,
				genres: i.genres, tags: i.tags, qualityProfile: i.qualityProfileName, rating: i.rating, runtime: i.runtime, path: i.path, fileCount: i.fileCount,
				protectedId: prot.get(`${i.instanceId}:${i.kind}:${i.arrId}`) ?? null,
			})),
		};
	}

	/** Operator-initiated removal of specific titles. Manually protected titles are refused; each result is audited. */
	async function removeItems(targets: Array<{ instanceId: string; arrItemId: number }>, action: CleanupAction, actor = "operator") {
		const correlationId = randomUUID();
		const protectedKeys = store.protected.targetKeys();
		return mapLimit(targets, FILE_FETCH_CONCURRENCY, async (t) => {
			const result = (status: "done" | "blocked" | "failed" | "gone", message?: string) => ({ ...t, status, message });
			const inst = store.instances.get(t.instanceId);
			if (!inst || !inst.enabled || (inst.type !== "sonarr" && inst.type !== "radarr")) return result("blocked", "Instance is missing or disabled");
			const api = deps.arr(inst);
			let item: LibraryItem | null = null;
			try {
				try {
					item = normalizeItem(await api.get(t.arrItemId), { instanceId: inst.id, service: api.service, ...(await loadMaps(api)) });
				} catch (e) {
					if ((e as { status?: number }).status === 404) return result("gone", "Already removed");
					throw e;
				}
				const ev = { correlationId, trigger: "manual" as const, actor, action: action };
				if (protectedKeys.has(targetKey(item))) {
					audit({ instance: inst.id, arrId: item.arrId, kind: item.kind, title: item.title }, { ...ev, eventType: "manual_blocked", outcome: "blocked", reason: "Manually protected" });
					return result("blocked", "Manually protected");
				}
				await mutate(api, item, action);
				if (action === "delete") await clearSeerr(item);
				audit({ instance: inst.id, arrId: item.arrId, kind: item.kind, title: item.title }, { ...ev, eventType: "manual_removed", outcome: "success", reason: "Removed from the Library page", details: { sizeOnDisk: item.sizeOnDisk } });
				return result("done");
			} catch (e) {
				const message = (e as Error).message;
				if (item) audit({ instance: inst.id, arrId: item.arrId, kind: item.kind, title: item.title }, { correlationId, trigger: "manual", actor, action, eventType: "manual_failed", outcome: "failed", reason: message });
				log.error({ instance: inst.name, item: t.arrItemId, err: message }, "manual removal failed");
				return result("failed", message);
			}
		});
	}

	// ── External links ────────────────────────────────────────────────────
	/** Deep link into the Sonarr/Radarr web UI, which routes by title slug rather than the internal id. */
	async function externalLink(instanceId: string, arrItemId: number): Promise<{ url: string }> {
		const inst = store.instances.get(instanceId);
		if (!inst || (inst.type !== "sonarr" && inst.type !== "radarr")) throw new ConflictError("Unknown Sonarr/Radarr instance");
		const api = deps.arr(inst);
		const raw = await api.get(arrItemId);
		const slug = typeof raw.titleSlug === "string" && raw.titleSlug ? raw.titleSlug : String(arrItemId);
		const root = inst.type === "sonarr" ? "series" : "movie";
		return { url: `${inst.url}/${root}/${slug}` };
	}

	// ── Episodes ───────────────────────────────────────────────────────────
	/** Episodes with files on disk for one series (optionally one season), grouped by season: what a delete would remove. */
	async function episodesOnDisk(instanceId: string, seriesId: number, season?: number | null) {
		const inst = store.instances.get(instanceId);
		if (!inst || inst.type !== "sonarr") throw new ConflictError("Unknown Sonarr instance");
		const api = deps.arr(inst);
		const [eps, files] = await Promise.all([api.episodes(seriesId), api.episodeFiles(seriesId)]);
		const size = new Map(files.map((f) => [f.id, typeof f.size === "number" ? f.size : 0]));
		const seasons = new Map<number, Array<{ number: number; title: string | null; airDate: string | null; size: number }>>();
		for (const e of eps) {
			if (!e.hasFile || typeof e.seasonNumber !== "number" || (season != null && e.seasonNumber !== season)) continue;
			const list = seasons.get(e.seasonNumber) ?? [];
			list.push({ number: e.episodeNumber, title: typeof e.title === "string" ? e.title : null, airDate: typeof e.airDateUtc === "string" ? e.airDateUtc : null, size: size.get(e.episodeFileId) ?? 0 });
			seasons.set(e.seasonNumber, list);
		}
		return [...seasons].sort(([a], [b]) => a - b).map(([number, episodes]) => ({
			number,
			size: episodes.reduce((n, e) => n + e.size, 0),
			episodes: episodes.sort((a, b) => a.number - b.number),
		}));
	}

	return { run, preview, library, removeItems, explain, approve, snapshotOf, episodesOnDisk, externalLink, MAX_ATTEMPTS };
}

export type Engine = ReturnType<typeof createEngine>;
