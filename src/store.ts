import { randomUUID } from "node:crypto";
import type { Db } from "./db.js";
import { firstRun, nextRun } from "./schedule.js";
import type { Encryptor } from "./crypto.js";
import type { CleanupAction, ConfigRecord, Instance, InstanceType, ItemKind, RuleMode, RuleRecord, Service, Trigger } from "./types.js";

const json = (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v));
const parse = <T>(v: unknown): T | null => (typeof v === "string" ? (JSON.parse(v) as T) : null);
const iso = (d: Date) => d.toISOString();

export type ApprovalStatus = "pending" | "failed" | "reclaimed";

export interface ApprovalRow {
	id: string;
	instanceId: string;
	arrItemId: number;
	itemType: ItemKind;
	/** Season approvals only: which season of the series (arrItemId). */
	seasonNumber: number | null;
	title: string;
	year: number | null;
	sizeOnDisk: number;
	ruleId: string;
	ruleName: string;
	reason: string;
	action: CleanupAction;
	status: ApprovalStatus;
	attemptCount: number;
	safetySnapshot: SafetySnapshot;
	lastError: string | null;
	reviewedAt: string | null;
	executedAt: string | null;
	/** Earliest time Cleanarr is allowed to apply this automatically; a run executes it once this has passed. */
	executeAfter: string;
	createdAt: string;
}

export interface ProtectedItem {
	id: string;
	instanceId: string;
	arrItemId: number;
	itemType: ItemKind;
	seasonNumber: number | null;
	title: string;
	note: string | null;
	/** True for an override: retention rules are ignored for this item instead of it being protected. */
	ignoreRetention: boolean;
	createdAt: string;
}

/** Identity of what was approved. Execution aborts if the live item no longer matches. */
export interface SafetySnapshot {
	arrItemId: number;
	seasonNumber?: number;
	title: string;
	path: string | null;
	sizeOnDisk: number;
	/** null when file ids weren't loaded (Sonarr without file-metadata rules); fileCount still guards. */
	fileIds: number[] | null;
	fileCount: number;
	tmdbId: number | null;
	tvdbId: number | null;
}

export interface AuditEventInput {
	correlationId: string;
	eventType: string;
	outcome: "info" | "success" | "blocked" | "failed";
	trigger: Trigger;
	actor: string;
	runLogId?: string | null;
	approvalId?: string | null;
	instanceId: string;
	arrItemId: number;
	itemType: ItemKind;
	title: string;
	ruleId?: string | null;
	ruleName?: string | null;
	action: string;
	reason: string;
	details?: unknown;
}

export type Store = ReturnType<typeof createStore>;

export function createStore(db: Db, enc: Encryptor, now: () => Date = () => new Date()) {
	// ── Instances ──────────────────────────────────────────────────────────
	const instRow = (r: any): Instance => ({
		id: r.id,
		name: r.name,
		type: r.type as InstanceType,
		url: r.url,
		apiKey: enc.decrypt(r.api_key_enc),
		enabled: !!r.enabled,
	});

	const instances = {
		list: (): Instance[] => db.prepare("SELECT * FROM instances ORDER BY name").all().map(instRow),
		get(id: string): Instance | undefined {
			const r = db.prepare("SELECT * FROM instances WHERE id = ?").get(id);
			return r ? instRow(r) : undefined;
		},
		create(i: { name: string; type: InstanceType; url: string; apiKey: string; enabled?: boolean }): Instance {
			const id = randomUUID();
			db.prepare("INSERT INTO instances (id,name,type,url,api_key_enc,enabled,created_at) VALUES (?,?,?,?,?,?,?)").run(
				id, i.name, i.type, i.url.replace(/\/+$/, ""), enc.encrypt(i.apiKey), i.enabled === false ? 0 : 1, iso(now()),
			);
			return instances.get(id) as Instance;
		},
		update(id: string, patch: Partial<{ name: string; url: string; apiKey: string; enabled: boolean }>): Instance | undefined {
			const cur = instances.get(id);
			if (!cur) return undefined;
			db.prepare("UPDATE instances SET name=?, url=?, api_key_enc=?, enabled=? WHERE id=?").run(
				patch.name ?? cur.name,
				(patch.url ?? cur.url).replace(/\/+$/, ""),
				enc.encrypt(patch.apiKey ?? cur.apiKey),
				(patch.enabled ?? cur.enabled) ? 1 : 0,
				id,
			);
			return instances.get(id);
		},
		delete: (id: string) => db.prepare("DELETE FROM instances WHERE id = ?").run(id).changes > 0,
	};

	// ── Config ─────────────────────────────────────────────────────────────
	const config = {
		get(): ConfigRecord {
			const r = db.prepare("SELECT * FROM config WHERE id = 1").get() as any;
			return {
				enabled: !!r.enabled,
				intervalEvery: r.interval_every,
				intervalUnit: r.interval_unit,
				runTime: r.run_time,
				dryRun: !!r.dry_run,
				maxRemovalsPerRun: r.max_removals_per_run,
				queueDelayDays: r.queue_delay_days,
				auditRetentionDays: r.audit_retention_days,
				kidsMaxAge: r.kids_max_age,
				lastRunAt: r.last_run_at,
				nextRunAt: r.next_run_at,
			};
		},
		update(p: Partial<Omit<ConfigRecord, "lastRunAt" | "nextRunAt">>): ConfigRecord {
			const cur = config.get();
			const c = { ...cur, ...p };
			const enabledNow = c.enabled;
			// Going live (scheduling turned on, or dry run turned off) shouldn't make the first pickup wait a full interval.
			const immediate = enabledNow && ((!cur.enabled && c.enabled) || (cur.dryRun && !c.dryRun));
			const rescheduled = c.intervalEvery !== cur.intervalEvery || c.intervalUnit !== cur.intervalUnit || c.runTime !== cur.runTime;
			const next = cur.lastRunAt ? nextRun(new Date(cur.lastRunAt), c) : firstRun(now(), c.runTime);
			db.prepare(
				`UPDATE config SET enabled=?, interval_every=?, interval_unit=?, run_time=?, dry_run=?, max_removals_per_run=?,
				 queue_delay_days=?, audit_retention_days=?, kids_max_age=?,
				 next_run_at = CASE WHEN ? = 0 THEN NULL WHEN ? = 1 THEN ? WHEN ? = 1 OR next_run_at IS NULL THEN ? ELSE next_run_at END WHERE id = 1`,
			).run(
				c.enabled ? 1 : 0, c.intervalEvery, c.intervalUnit, c.runTime, c.dryRun ? 1 : 0, c.maxRemovalsPerRun,
				c.queueDelayDays, c.auditRetentionDays, c.kidsMaxAge, enabledNow ? 1 : 0, immediate ? 1 : 0, iso(now()), rescheduled ? 1 : 0, iso(next),
			);
			return config.get();
		},
		markRun(at: Date) {
			db.prepare("UPDATE config SET last_run_at=?, next_run_at=? WHERE id=1").run(iso(at), iso(nextRun(at, config.get())));
		},
		/** Cross-process run lease. Stale leases (crashed run) are reclaimed after `staleMs`. */
		claimRun(staleMs: number): string | null {
			const token = randomUUID();
			const cutoff = iso(new Date(now().getTime() - staleMs));
			const r = db
				.prepare("UPDATE config SET run_claim_token=?, run_claimed_at=? WHERE id=1 AND (run_claim_token IS NULL OR run_claimed_at < ?)")
				.run(token, iso(now()), cutoff);
			return r.changes === 1 ? token : null;
		},
		releaseRun: (token: string) => void db.prepare("UPDATE config SET run_claim_token=NULL, run_claimed_at=NULL WHERE id=1 AND run_claim_token=?").run(token),
		/** Extends the lease so long runs aren't reclaimed while still alive. */
		heartbeat: (token: string) => void db.prepare("UPDATE config SET run_claimed_at=? WHERE id=1 AND run_claim_token=?").run(iso(now()), token),
	};

	// ── Rules ──────────────────────────────────────────────────────────────
	const ruleRow = (r: any): RuleRecord => ({
		id: r.id,
		name: r.name,
		enabled: !!r.enabled,
		priority: r.priority,
		mode: r.mode as RuleMode,
		action: r.action as CleanupAction,
		expression: JSON.parse(r.expression),
		serviceFilter: parse<Service[]>(r.service_filter),
		instanceFilter: parse<string[]>(r.instance_filter),
		excludeTags: parse<string[]>(r.exclude_tags),
		excludeTitles: parse<string[]>(r.exclude_titles),
	});

	type RuleInput = Omit<RuleRecord, "id">;
	const rules = {
		list: (): RuleRecord[] => db.prepare("SELECT * FROM rules ORDER BY priority, created_at").all().map(ruleRow),
		get(id: string): RuleRecord | undefined {
			const r = db.prepare("SELECT * FROM rules WHERE id = ?").get(id);
			return r ? ruleRow(r) : undefined;
		},
		create(r: RuleInput): RuleRecord {
			const id = randomUUID();
			const ts = iso(now());
			db.prepare(
				`INSERT INTO rules (id,name,enabled,priority,mode,action,expression,service_filter,instance_filter,exclude_tags,exclude_titles,
				 created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
			).run(
				id, r.name, r.enabled ? 1 : 0, r.priority, r.mode, r.action, JSON.stringify(r.expression), json(r.serviceFilter), json(r.instanceFilter),
				json(r.excludeTags), json(r.excludeTitles), ts, ts,
			);
			return rules.get(id) as RuleRecord;
		},
		update(id: string, patch: Partial<RuleInput>): RuleRecord | undefined {
			const cur = rules.get(id);
			if (!cur) return undefined;
			const r = { ...cur, ...patch };
			db.prepare(
				`UPDATE rules SET name=?,enabled=?,priority=?,mode=?,action=?,expression=?,service_filter=?,instance_filter=?,exclude_tags=?,
				 exclude_titles=?,updated_at=? WHERE id=?`,
			).run(
				r.name, r.enabled ? 1 : 0, r.priority, r.mode, r.action, JSON.stringify(r.expression), json(r.serviceFilter), json(r.instanceFilter),
				json(r.excludeTags), json(r.excludeTitles), iso(now()), id,
			);
			return rules.get(id);
		},
		delete: (id: string) => db.prepare("DELETE FROM rules WHERE id = ?").run(id).changes > 0,
		reorder(ids: string[]) {
			const stmt = db.prepare("UPDATE rules SET priority = ? WHERE id = ?");
			db.transaction(() => ids.forEach((id, i) => stmt.run(i, id)))();
		},
	};

	// ── Approvals ──────────────────────────────────────────────────────────
	const approvalRow = (r: any): ApprovalRow => ({
		id: r.id,
		instanceId: r.instance_id,
		arrItemId: r.arr_item_id,
		itemType: r.item_type,
		seasonNumber: r.season_number ?? null,
		title: r.title,
		year: r.year,
		sizeOnDisk: r.size_on_disk,
		ruleId: r.rule_id,
		ruleName: r.rule_name,
		reason: r.reason,
		action: r.action,
		status: r.status,
		attemptCount: r.attempt_count,
		safetySnapshot: JSON.parse(r.safety_snapshot),
		lastError: r.last_error,
		reviewedAt: r.reviewed_at,
		executedAt: r.executed_at,
		executeAfter: r.execute_after,
		createdAt: r.created_at,
	});

	/** Same key the engine builds for a LibraryItem: seasons are distinct targets from their series. */
	const targetKey = (r: any) => `${r.instance_id}:${r.item_type}:${r.arr_item_id}${r.season_number != null ? `:${r.season_number}` : ""}`;
	const OPEN = ["pending", "failed"];
	const approvals = {
		get(id: string): ApprovalRow | undefined {
			const r = db.prepare("SELECT * FROM approvals WHERE id = ?").get(id);
			return r ? approvalRow(r) : undefined;
		},
		list(status?: string, limit = 200): ApprovalRow[] {
			const rows = status
				? db.prepare("SELECT * FROM approvals WHERE status = ? ORDER BY created_at DESC LIMIT ?").all(status, limit)
				: db.prepare("SELECT * FROM approvals ORDER BY created_at DESC LIMIT ?").all(limit);
			return rows.map(approvalRow);
		},
		counts(): Record<string, number> {
			const out: Record<string, number> = {};
			for (const r of db.prepare("SELECT status, COUNT(*) n FROM approvals GROUP BY status").all() as any[]) out[r.status] = r.n;
			return out;
		},
		/** Open approval rows keyed by target, so callers can show their actual status (e.g. queue countdown) instead of just knowing one exists. */
		openByTarget(): Map<string, ApprovalRow> {
			const rows = db.prepare(`SELECT * FROM approvals WHERE status IN (${OPEN.map(() => "?").join(",")})`).all(...OPEN) as any[];
			return new Map(rows.map((r) => [targetKey(r), approvalRow(r)] as const));
		},
		/** Targets that already have unfinished work; the engine must not propose them again. */
		openTargets(): Set<string> {
			return new Set(approvals.openByTarget().keys());
		},
		create(a: {
			instanceId: string; arrItemId: number; seasonNumber?: number | null; itemType: ItemKind; title: string; year: number | null; sizeOnDisk: number;
			ruleId: string; ruleName: string; reason: string; action: CleanupAction; safetySnapshot: SafetySnapshot; executeAfter: Date;
		}): ApprovalRow {
			const id = randomUUID();
			db.prepare(
				`INSERT INTO approvals (id,instance_id,arr_item_id,season_number,item_type,title,year,size_on_disk,rule_id,rule_name,reason,action,safety_snapshot,execute_after,created_at)
				 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
			).run(id, a.instanceId, a.arrItemId, a.seasonNumber ?? null, a.itemType, a.title, a.year, a.sizeOnDisk, a.ruleId, a.ruleName, a.reason, a.action, JSON.stringify(a.safetySnapshot), iso(a.executeAfter), iso(now()));
			return approvals.get(id) as ApprovalRow;
		},
		/** Queued items whose wait has elapsed, plus failed ones (retried every run). With ignoreDelay, the whole queue regardless of wait (used by "Reclaim now"). */
		due(limit: number, ignoreDelay = false): ApprovalRow[] {
			return db
				.prepare(`SELECT * FROM approvals WHERE status = 'failed' OR (status = 'pending' AND (? OR execute_after <= ?)) ORDER BY execute_after LIMIT ?`)
				.all(ignoreDelay ? 1 : 0, iso(now()), limit)
				.map(approvalRow);
		},
		delete(id: string) {
			db.prepare("DELETE FROM approvals WHERE id = ?").run(id);
		},
		/** Compare-and-set claim: the execution token marks work in flight. Returns true only for the caller that won. */
		claim(id: string, token: string): boolean {
			return db.prepare("UPDATE approvals SET execution_token = ?, reviewed_at = ?, attempt_count = attempt_count + 1 WHERE id = ? AND status IN ('pending','failed') AND execution_token IS NULL").run(token, iso(now()), id).changes === 1;
		},
		finish(id: string, to: "reclaimed" | "failed", error?: string | null) {
			db.prepare("UPDATE approvals SET status = ?, execution_token = NULL, last_error = COALESCE(?, last_error), executed_at = CASE WHEN ? = 'reclaimed' THEN ? ELSE executed_at END WHERE id = ?").run(to, error ?? null, to, iso(now()), id);
		},
		/** Executions that were mid-flight when the process died. They are marked failed so they get retried, never assumed done. */
		recoverStuck(olderThanMs: number): number {
			const cutoff = iso(new Date(now().getTime() - olderThanMs));
			return db
				.prepare("UPDATE approvals SET status='failed', execution_token=NULL, last_error='Interrupted before completion; verify and retry' WHERE execution_token IS NOT NULL AND COALESCE(reviewed_at, created_at) < ?")
				.run(cutoff).changes;
		},
	};

	// ── Manual protection ──────────────────────────────────────────────────
	const protectedRow = (r: any): ProtectedItem => ({
		id: r.id, instanceId: r.instance_id, arrItemId: r.arr_item_id, itemType: r.item_type, seasonNumber: r.season_number ?? null, title: r.title, note: r.note, ignoreRetention: !!r.ignore_retention, createdAt: r.created_at,
	});
	const protectedTargetKey = (r: { instance_id: string; item_type: string; arr_item_id: number; season_number: number | null }) =>
		`${r.instance_id}:${r.item_type}:${r.arr_item_id}${r.season_number != null ? `:${r.season_number}` : ""}`;
	const protectedItems = {
		list: (): ProtectedItem[] => db.prepare("SELECT * FROM protected_items ORDER BY created_at DESC").all().map(protectedRow),
		create(p: { instanceId: string; arrItemId: number; itemType: ItemKind; seasonNumber?: number | null; title: string; note?: string | null; ignoreRetention?: boolean }): ProtectedItem {
			const ignore = p.ignoreRetention ? 1 : 0;
			const existing = db
				.prepare("SELECT * FROM protected_items WHERE instance_id = ? AND arr_item_id = ? AND item_type = ? AND season_number IS ? AND ignore_retention = ?")
				.get(p.instanceId, p.arrItemId, p.itemType, p.seasonNumber ?? null, ignore) as any;
			if (existing) return protectedRow(existing);
			const id = randomUUID();
			db.prepare("INSERT INTO protected_items (id,instance_id,arr_item_id,item_type,season_number,title,note,ignore_retention,created_at) VALUES (?,?,?,?,?,?,?,?,?)").run(
				id, p.instanceId, p.arrItemId, p.itemType, p.seasonNumber ?? null, p.title, p.note ?? null, ignore, iso(now()),
			);
			return protectedItems.list().find((x) => x.id === id) as ProtectedItem;
		},
		delete: (id: string) => db.prepare("DELETE FROM protected_items WHERE id = ?").run(id).changes > 0,
		/** Same key shape the engine builds for a LibraryItem, for a fast membership check during planning. */
		targetKeys: (ignoreRetention = false): Set<string> =>
			new Set((db.prepare("SELECT instance_id, arr_item_id, item_type, season_number FROM protected_items WHERE ignore_retention = ?").all(ignoreRetention ? 1 : 0) as any[]).map(protectedTargetKey)),
	};

	// ── Run logs ───────────────────────────────────────────────────────────
	const logs = {
		start(trigger: Trigger, isDryRun: boolean): string {
			const id = randomUUID();
			db.prepare("INSERT INTO run_logs (id,trigger,is_dry_run,status,started_at) VALUES (?,?,?,?,?)").run(id, trigger, isDryRun ? 1 : 0, "running", iso(now()));
			return id;
		},
		finish(id: string, r: {
			status: "completed" | "partial" | "error"; evaluated: number; flagged: number; removed: number; unmonitored: number;
			filesDeleted: number; skipped: number; bytesReclaimed: number; details: unknown[]; warnings: string[]; error?: string | null; durationMs: number;
		}) {
			db.prepare(
				`UPDATE run_logs SET status=?, items_evaluated=?, items_flagged=?, items_removed=?, items_unmonitored=?, items_files_deleted=?,
				 items_skipped=?, bytes_reclaimed=?, details=?, warnings=?, error=?, duration_ms=?, completed_at=? WHERE id=?`,
			).run(r.status, r.evaluated, r.flagged, r.removed, r.unmonitored, r.filesDeleted, r.skipped, r.bytesReclaimed, JSON.stringify(r.details), JSON.stringify(r.warnings), r.error ?? null, r.durationMs, iso(now()), id);
		},
		list: (limit = 50, offset = 0) => db.prepare("SELECT id,trigger,is_dry_run,status,items_evaluated,items_flagged,items_removed,items_unmonitored,items_files_deleted,items_skipped,bytes_reclaimed,warnings,error,duration_ms,started_at,completed_at FROM run_logs ORDER BY started_at DESC LIMIT ? OFFSET ?").all(limit, offset).map(logRow),
		get(id: string) {
			const r = db.prepare("SELECT * FROM run_logs WHERE id = ?").get(id) as any;
			return r ? { ...logRow(r), details: parse<Array<Record<string, any>>>(r.details) ?? [] } : undefined;
		},
		/** A run left 'running' by a crash is closed out as an error on startup. */
		failOrphans(): number {
			return db.prepare("UPDATE run_logs SET status='error', error='Interrupted by restart', completed_at=? WHERE status='running'").run(iso(now())).changes;
		},
		/** Lifetime totals come from the audit trail so approval-driven removals count too. */
		stats() {
			const r = db
				.prepare(
					`SELECT COUNT(*) removed, COALESCE(SUM(json_extract(details,'$.sizeOnDisk')),0) bytes FROM audit_events
					 WHERE event_type='reclaimed' AND outcome='success' AND action IN ('delete','delete_files')`,
				)
				.get() as { removed: number; bytes: number };
			return { runs: (db.prepare("SELECT COUNT(*) n FROM run_logs WHERE is_dry_run = 0").get() as { n: number }).n, ...r };
		},
	};
	const logRow = (r: any) => ({
		id: r.id, trigger: r.trigger, isDryRun: !!r.is_dry_run, status: r.status, itemsEvaluated: r.items_evaluated, itemsFlagged: r.items_flagged,
		itemsRemoved: r.items_removed, itemsUnmonitored: r.items_unmonitored, itemsFilesDeleted: r.items_files_deleted, itemsSkipped: r.items_skipped,
		bytesReclaimed: r.bytes_reclaimed, warnings: parse<string[]>(r.warnings) ?? [], error: r.error, durationMs: r.duration_ms, startedAt: r.started_at, completedAt: r.completed_at,
	});

	// ── Audit ──────────────────────────────────────────────────────────────
	const audit = {
		append(e: AuditEventInput) {
			db.prepare(
				`INSERT INTO audit_events (correlation_id,event_type,outcome,trigger,actor,run_log_id,approval_id,instance_id,arr_item_id,item_type,title,rule_id,rule_name,action,reason,details,created_at)
				 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
			).run(e.correlationId, e.eventType, e.outcome, e.trigger, e.actor, e.runLogId ?? null, e.approvalId ?? null, e.instanceId, e.arrItemId, e.itemType, e.title, e.ruleId ?? null, e.ruleName ?? null, e.action, e.reason, json(e.details), iso(now()));
		},
		list(opts: { limit?: number; offset?: number; correlationId?: string; approvalId?: string } = {}) {
			const where: string[] = [];
			const args: unknown[] = [];
			if (opts.correlationId) (where.push("correlation_id = ?"), args.push(opts.correlationId));
			if (opts.approvalId) (where.push("approval_id = ?"), args.push(opts.approvalId));
			const rows = db
				.prepare(`SELECT * FROM audit_events ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY id DESC LIMIT ? OFFSET ?`)
				.all(...args, opts.limit ?? 100, opts.offset ?? 0) as any[];
			return rows.map((r) => ({ ...r, details: parse<unknown>(r.details) }));
		},
		/** Drops entries older than `days`. Called once per run so the trail doesn't grow forever. */
		prune: (days: number) => db.prepare("DELETE FROM audit_events WHERE created_at < ?").run(iso(new Date(now().getTime() - days * 86_400_000))).changes,
	};

	return { instances, config, rules, approvals, protected: protectedItems, logs, audit };
}
