import { randomUUID } from "node:crypto";
import type { ArrApi } from "../arr/client.js";
import { normalizeItem } from "../arr/normalize.js";
import { evaluateExpression, parseExpression, requirements, type EvalNode, type Expression } from "../rules/expression.js";
import { passesFilters } from "../rules/filters.js";
import type { EvalContext } from "../rules/registry.js";
import type { ApprovalRow, SafetySnapshot, Store } from "../store.js";
import type { SeerrProvider, SeerrRequest } from "../seerr/seerr.js";
import type { WatchProvider } from "../watch/index.js";
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

export class RunInProgressError extends Error {
	constructor() {
		super("A cleanup run is already in progress");
	}
}
export class DryRunError extends Error {
	constructor() {
		super("Cleanup is in dry-run mode; disable dry-run in settings before executing approvals");
	}
}
export class ConflictError extends Error {}

const LEASE_STALE_MS = 30 * 60_000;
const MAX_DETAILS = 2000;
const MAX_ATTEMPTS = 3;
const FILE_FETCH_CONCURRENCY = 4;

export type Outcome = "flagged" | "pending_approval" | "removed" | "unmonitored" | "files_deleted" | "skipped" | "blocked" | "failed";
export interface RunDetail {
	instanceId: string;
	arrItemId: number;
	itemType: string;
	title: string;
	ruleId: string;
	ruleName: string;
	action: CleanupAction;
	reason: string;
	sizeOnDisk: number;
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

interface Plan {
	candidates: Candidate[];
	skipped: RunDetail[];
	evaluated: number;
}

/** Library totals for the dashboard. Series `files` counts episode files. */
export function librarySummary(items: LibraryItem[]) {
	const s = { movies: 0, series: 0, files: 0, missing: 0, movieBytes: 0, seriesBytes: 0, totalBytes: 0 };
	for (const i of items) {
		if (i.kind === "movie") (s.movies++, (s.movieBytes += i.sizeOnDisk));
		else (s.series++, (s.seriesBytes += i.sizeOnDisk), (s.files += i.fileCount));
		if (!i.hasFile) s.missing++;
		s.totalBytes += i.sizeOnDisk;
	}
	return s;
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
			return { lastWatchedAt: dates[0] ?? null, watchCount: Math.max(...hits.map((h) => h.watchCount)), watchedBy: [...new Set(hits.flatMap((h) => h.watchedBy))] };
		};
	}

	/**
	 * Loads watch history (Plex) and Seerr requests when rules need them. Any provider
	 * failure makes that evidence unavailable as a whole, so dependent rules evaluate to "unknown".
	 */
	async function loadEvidence(needs: { watch: boolean; seerr: boolean }): Promise<{ watch: EvalContext["watch"]; seerr: EvalContext["seerr"]; warnings: string[] }> {
		const out: { watch: EvalContext["watch"]; seerr: EvalContext["seerr"]; warnings: string[] } = { watch: null, seerr: null, warnings: [] };
		const enabled = store.instances.list().filter((i) => i.enabled);
		if (needs.watch) {
			const sources = enabled.filter((i) => i.type === "plex");
			if (!sources.length) out.warnings.push("Watch-history rules are configured but no Plex instance is enabled; those rules cannot match");
			else {
				try {
					const loaded = await Promise.all(sources.map((i) => deps.watch(i).load()));
					out.watch = combineWatch(loaded.map((l) => l.lookup));
					out.warnings.push(...loaded.flatMap((l) => l.warnings));
				} catch (e) {
					out.warnings.push(`Watch history: ${(e as Error).message}; watch-history rules cannot match this run`);
				}
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

	async function loadSnapshot(needs: { files: boolean; watch: boolean; seerr: boolean }): Promise<Snapshot> {
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
						if (needs.files && api.service === "sonarr") {
							const withFiles = raw.filter((r) => (r.statistics?.episodeFileCount ?? 0) > 0);
							const results = await mapLimit(withFiles, FILE_FETCH_CONCURRENCY, async (r) => [r.id, await api.episodeFiles(r.id)] as const);
							filesBySeries = new Map(results);
						}
						for (const r of raw) {
							snap.items.push(
								normalizeItem(r, {
									instanceId: inst.id,
									service: api.service,
									...maps,
									episodeFiles: api.service === "sonarr" && needs.files ? (filesBySeries.get(r.id) ?? []) : undefined,
								}),
							);
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
		return snap;
	}

	function activeRules(): { rules: Array<{ rule: RuleRecord; expr: Expression }>; needs: { files: boolean; watch: boolean; seerr: boolean }; warnings: string[] } {
		const needs = { files: false, watch: false, seerr: false };
		const warnings: string[] = [];
		const rules: Array<{ rule: RuleRecord; expr: Expression }> = [];
		for (const rule of store.rules.list().filter((r) => r.enabled)) {
			try {
				const expr = parseExpression(rule.expression);
				const req = requirements(expr);
				needs.files ||= req.files;
				needs.watch ||= req.watch;
				needs.seerr ||= req.seerr;
				rules.push({ rule, expr });
			} catch (e) {
				warnings.push(`Rule "${rule.name}" skipped: invalid expression (${(e as Error).message})`);
			}
		}
		return { rules, needs, warnings };
	}

	// ── Planning ───────────────────────────────────────────────────────────
	const targetKey = (i: { instanceId: string; kind?: string; itemType?: string; arrId?: number; arrItemId?: number }) =>
		`${i.instanceId}:${i.kind ?? i.itemType}:${i.arrId ?? i.arrItemId}`;

	const detail = (c: Candidate, outcome: Outcome, message?: string): RunDetail => ({
		instanceId: c.item.instanceId,
		arrItemId: c.item.arrId,
		itemType: c.item.kind,
		title: c.item.title,
		ruleId: c.rule.id,
		ruleName: c.rule.name,
		action: c.rule.action,
		reason: c.reason,
		sizeOnDisk: c.item.sizeOnDisk,
		outcome,
		message,
	});

	/** Applies retention and cleanup rules to every loaded item. Retention always wins, and unknown retention evidence also protects. */
	function plan(snap: Snapshot, rules: Array<{ rule: RuleRecord; expr: Expression }>): Plan {
		const retention = rules.filter((r) => r.rule.mode === "retention");
		const cleanup = rules.filter((r) => r.rule.mode === "cleanup");
		const candidates: Candidate[] = [];
		const skipped: RunDetail[] = [];
		for (const item of snap.items) {
			if (snap.failedInstances.has(item.instanceId)) continue;
			const fake = (rule: RuleRecord, reason: string): Candidate => ({ item, rule, reason });
			let protectedBy: string | null = null;
			for (const { rule, expr } of retention) {
				if (!passesFilters(item, rule).ok) continue;
				const r = evaluateExpression(expr, item, snap.ctx);
				if (r.state !== "false") {
					protectedBy = r.state === "true" ? `Protected by retention rule "${rule.name}": ${r.reason}` : `Retention rule "${rule.name}" could not be evaluated (${r.reason})`;
					break;
				}
			}
			for (const { rule, expr } of cleanup) {
				if (!passesFilters(item, rule).ok) continue;
				const r = evaluateExpression(expr, item, snap.ctx);
				if (r.state !== "true") continue;
				if (protectedBy) skipped.push(detail(fake(rule, r.reason), "skipped", protectedBy));
				else candidates.push({ item, rule, reason: r.reason });
				break;
			}
		}
		return { candidates, skipped, evaluated: snap.items.length };
	}

	function suppress(candidates: Candidate[], config: ConfigRecord): { keep: Candidate[]; skipped: RunDetail[] } {
		const open = store.approvals.openTargets();
		const rejected = new Map<string, string[]>();
		for (const r of store.approvals.rejectedSince()) rejected.set(r.key, [...(rejected.get(r.key) ?? []), r.reviewedAt]);
		const keep: Candidate[] = [];
		const skipped: RunDetail[] = [];
		for (const c of candidates) {
			const key = targetKey(c.item);
			if (open.has(key)) {
				skipped.push(detail(c, "skipped", "Already has an open approval"));
				continue;
			}
			const memory = c.rule.useGlobalRejectionMemory ? config.rejectionMemoryDays : c.rule.rejectionMemoryDays;
			const times = rejected.get(key);
			if (times && memory !== 0) {
				const latest = Math.max(...times.map((t) => Date.parse(t)));
				if (memory === null || now().getTime() - latest < memory * 86_400_000) {
					skipped.push(detail(c, "skipped", memory === null ? "Previously rejected (remembered forever)" : `Previously rejected within ${memory} days`));
					continue;
				}
			}
			keep.push(c);
		}
		return { keep, skipped };
	}

	function order(candidates: Candidate[]): Candidate[] {
		return [...candidates].sort((a, b) => a.rule.priority - b.rule.priority || b.item.sizeOnDisk - a.item.sizeOnDisk);
	}

	function snapshotOf(item: LibraryItem): SafetySnapshot {
		return {
			arrItemId: item.arrId,
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
	type Revalidated = { ok: true; item: LibraryItem; api: ArrApi } | { ok: false; kind: "gone" | "blocked"; message: string };

	/**
	 * Last check before any upstream write: re-read the live item, confirm it is still the
	 * same thing that was selected, and re-run its rule plus every retention rule on fresh data.
	 */
	async function revalidate(args: { instanceId: string; arrItemId: number; ruleId: string; snapshot: SafetySnapshot | null; requireRule: boolean }): Promise<Revalidated> {
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
		const item = normalizeItem(raw, { instanceId: inst.id, service: api.service, ...maps, episodeFiles });

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

		const ev = await loadEvidence(needs);
		const ctx: EvalContext = { now: now(), watch: ev.watch, seerr: ev.seerr };
		for (const { rule: r, expr } of rules) {
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

	async function mutate(api: ArrApi, item: LibraryItem, action: CleanupAction): Promise<Outcome> {
		if (action === "delete") {
			await api.deleteItem(item.arrId, { deleteFiles: true });
			return "removed";
		}
		if (action === "unmonitor") {
			await api.unmonitor(item.arrId);
			return "unmonitored";
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

	/** Direct (no-approval) execution of one candidate. */
	async function executeDirect(c: Candidate, ctx: { trigger: Trigger; actor: string; runLogId: string; snapshot: SafetySnapshot }): Promise<RunDetail> {
		const correlationId = randomUUID();
		const who = { instance: c.item.instanceId, arrId: c.item.arrId, kind: c.item.kind, title: c.item.title };
		const base = { correlationId, trigger: ctx.trigger, actor: ctx.actor, runLogId: ctx.runLogId, rule: c.rule, action: c.rule.action };
		audit(who, { ...base, eventType: "selected", outcome: "info", reason: c.reason });
		try {
			const v = await revalidate({ instanceId: c.item.instanceId, arrItemId: c.item.arrId, ruleId: c.rule.id, snapshot: ctx.snapshot, requireRule: true });
			if (!v.ok) {
				audit(who, { ...base, eventType: v.kind === "gone" ? "already_removed" : "blocked", outcome: v.kind === "gone" ? "info" : "blocked", reason: v.message });
				return detail(c, v.kind === "gone" ? "skipped" : "blocked", v.message);
			}
			audit(who, { ...base, eventType: "execution_started", outcome: "info", reason: c.reason });
			const outcome = await mutate(v.api, v.item, c.rule.action);
			audit(who, { ...base, eventType: "executed", outcome: "success", reason: c.reason, details: { sizeOnDisk: c.item.sizeOnDisk } });
			return detail(c, outcome);
		} catch (e) {
			const message = (e as Error).message;
			audit(who, { ...base, eventType: "failed", outcome: "failed", reason: message });
			return detail(c, "failed", message);
		}
	}

	// ── Approvals ──────────────────────────────────────────────────────────
	function approvalAudit(a: ApprovalRow, e: Omit<Parameters<typeof audit>[1], "action" | "reason" | "approvalId" | "rule"> & { reason: string }) {
		audit({ instance: a.instanceId, arrId: a.arrItemId, kind: a.itemType, title: a.title }, { ...e, approvalId: a.id, rule: { id: a.ruleId, name: a.ruleName }, action: a.action });
	}

	function reject(id: string, actor: string): ApprovalRow {
		const a = store.approvals.get(id);
		if (!a) throw new ConflictError("Approval not found");
		if (!store.approvals.transition(id, ["pending", "retry_pending"], "rejected", { reviewed: true })) throw new ConflictError(`Approval is ${a.status}; only pending approvals can be rejected`);
		approvalAudit(a, { correlationId: a.id, eventType: "rejected", outcome: "info", trigger: "approval", actor, reason: "Rejected by operator" });
		return store.approvals.get(id) as ApprovalRow;
	}

	/** Approves (if still pending) and executes. Exactly one caller can win the status transition. */
	async function approve(id: string, opts: { actor: string; trigger?: Trigger; runLogId?: string }): Promise<ApprovalRow> {
		const a0 = store.approvals.get(id);
		if (!a0) throw new ConflictError("Approval not found");
		if (store.config.get().dryRun) throw new DryRunError();
		const trigger = opts.trigger ?? (a0.status === "retry_pending" ? "retry" : "approval");
		const retry = a0.status === "retry_pending";
		const token = randomUUID();
		if (a0.status === "pending" && Date.parse(a0.expiresAt) < now().getTime()) {
			store.approvals.transition(id, ["pending"], "expired");
			throw new ConflictError("Approval has expired");
		}
		if (!store.approvals.transition(id, ["pending", "retry_pending"], retry ? "retry_executing" : "executing", { token, reviewed: !retry, bumpAttempt: true })) {
			throw new ConflictError(`Approval is ${store.approvals.get(id)?.status}; it can no longer be approved`);
		}
		const a = store.approvals.get(id) as ApprovalRow;
		const base = { correlationId: a.id, trigger, actor: opts.actor, runLogId: opts.runLogId };
		approvalAudit(a, { ...base, eventType: retry ? "retry_started" : "approved", outcome: "info", reason: a.reason });
		const done = (to: "executed" | "blocked" | "retry_pending", error?: string) => {
			store.approvals.transition(id, ["executing", "retry_executing"], to, { executed: to === "executed", error });
		};
		try {
			const v = await revalidate({ instanceId: a.instanceId, arrItemId: a.arrItemId, ruleId: a.ruleId, snapshot: a.safetySnapshot, requireRule: true });
			if (!v.ok) {
				if (v.kind === "gone") {
					done("executed", "Already removed before execution; no mutation performed");
					approvalAudit(a, { ...base, eventType: "reconciled", outcome: "info", reason: v.message });
				} else {
					done("blocked", v.message);
					approvalAudit(a, { ...base, eventType: "blocked", outcome: "blocked", reason: v.message });
				}
				return store.approvals.get(id) as ApprovalRow;
			}
			await mutate(v.api, v.item, a.action);
			done("executed");
			approvalAudit(a, { ...base, eventType: "executed", outcome: "success", reason: a.reason, details: { sizeOnDisk: a.sizeOnDisk } });
		} catch (e) {
			const message = (e as Error).message;
			done("retry_pending", message);
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
	}

	async function run(opts: RunOptions) {
		const config = store.config.get();
		const dryRun = opts.forceDryRun === true || config.dryRun;
		const actor = opts.actor ?? (opts.trigger === "scheduled" ? "scheduler" : "operator");
		const token = store.config.claimRun(LEASE_STALE_MS);
		if (!token) throw new RunInProgressError();
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
		try {
			store.approvals.expireDue();
			store.approvals.recoverStuck(LEASE_STALE_MS);

			const { rules, needs, warnings: ruleWarnings } = activeRules();
			warnings = [...ruleWarnings];
			const snap = await loadSnapshot(needs);
			warnings.push(...snap.warnings);

			const p = plan(snap, rules);
			evaluated = p.evaluated;
			const { keep, skipped } = suppress(p.candidates, config);
			details.push(...p.skipped, ...skipped);
			const ordered = order(keep);
			flagged = ordered.length;
			let budget = config.maxRemovalsPerRun;

			// Failed approvals first: they were already approved by a human.
			if (!dryRun) {
				for (const a of store.approvals.retryable(budget)) {
					if (budget <= 0) break;
					budget--;
					const r = await approve(a.id, { actor, trigger: "retry", runLogId });
					const outcome: Outcome = r.status === "executed" ? (r.action === "unmonitor" ? "unmonitored" : r.action === "delete_files" ? "files_deleted" : "removed") : r.status === "blocked" ? "blocked" : "failed";
					details.push({ instanceId: r.instanceId, arrItemId: r.arrItemId, itemType: r.itemType, title: r.title, ruleId: r.ruleId, ruleName: r.ruleName, action: r.action, reason: r.reason, sizeOnDisk: r.sizeOnDisk, outcome, message: r.lastError ?? undefined });
					tally(outcome, r.sizeOnDisk);
				}
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
				budget--;
				if (config.requireApproval) {
					const approval = store.approvals.create({
						instanceId: c.item.instanceId, arrItemId: c.item.arrId, itemType: c.item.kind, title: c.item.title, year: c.item.year,
						sizeOnDisk: c.item.sizeOnDisk, ruleId: c.rule.id, ruleName: c.rule.name, reason: c.reason, action: c.rule.action,
						safetySnapshot: snapshotOf(c.item), expiresAt: new Date(now().getTime() + config.approvalExpiryDays * 86_400_000),
					});
					approvalAudit(approval, { correlationId: approval.id, eventType: "proposed", outcome: "info", trigger: opts.trigger, actor, runLogId, reason: c.reason });
					details.push(detail(c, "pending_approval"));
					continue;
				}
				const d = await executeDirect(c, { trigger: opts.trigger, actor, runLogId, snapshot: snapshotOf(c.item) });
				details.push(d);
				tally(d.outcome, d.sizeOnDisk);
			}

			// Previews never move the schedule; real and scheduled runs (even dry ones) do.
			if (!opts.forceDryRun) store.config.markRun(now(), config.intervalHours);
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
	async function explain(instanceId: string, arrItemId: number) {
		const inst = store.instances.get(instanceId);
		if (!inst || (inst.type !== "sonarr" && inst.type !== "radarr")) throw new ConflictError("Unknown Sonarr/Radarr instance");
		const api = deps.arr(inst);
		const raw = await api.get(arrItemId);
		const { rules, needs } = activeRules();
		const maps = await loadMaps(api);
		const episodeFiles = api.service === "sonarr" && needs.files ? await api.episodeFiles(arrItemId) : undefined;
		const item = normalizeItem(raw, { instanceId, service: api.service, ...maps, episodeFiles });
		const ev = await loadEvidence(needs);
		const ctx: EvalContext = { now: now(), watch: ev.watch, seerr: ev.seerr };
		const warnings = ev.warnings;
		return {
			item: { title: item.title, year: item.year, kind: item.kind, sizeOnDisk: item.sizeOnDisk, monitored: item.monitored, tags: item.tags, path: item.path },
			warnings,
			rules: rules.map(({ rule, expr }) => {
				const f = passesFilters(item, rule);
				const ev: EvalNode | null = f.ok ? evaluateExpression(expr, item, ctx) : null;
				return { ruleId: rule.id, name: rule.name, mode: rule.mode, action: rule.action, inScope: f.ok, excludedBy: f.ok ? null : f.why, state: ev?.state ?? null, tree: ev };
			}),
		};
	}

	/** Preview = full evaluation with no writes and no approvals; returns the candidates directly. */
	async function preview() {
		const config = store.config.get();
		const { rules, needs, warnings: rw } = activeRules();
		const snap = await loadSnapshot(needs);
		const p = plan(snap, rules);
		const { keep, skipped } = suppress(p.candidates, config);
		const ordered = order(keep);
		return {
			evaluated: p.evaluated,
			warnings: [...rw, ...snap.warnings],
			candidates: ordered.map((c) => detail(c, "flagged")),
			skipped: [...p.skipped, ...skipped],
			totalBytes: ordered.reduce((n, c) => n + c.item.sizeOnDisk, 0),
			library: librarySummary(snap.items),
		};
	}

	return { run, preview, explain, approve, reject, snapshotOf, MAX_ATTEMPTS };
}

export type Engine = ReturnType<typeof createEngine>;
