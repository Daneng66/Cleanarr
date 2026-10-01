import { describe, expect, it } from "vitest";
import { ConflictError, DryRunError, RunInProgressError } from "../src/cleanup/engine.js";
import { createScheduler } from "../src/cleanup/scheduler.js";
import { DAY, GB, NOW, movie, series, setup, old } from "./helpers.js";

const live = (s: ReturnType<typeof setup>, over: Record<string, unknown> = {}) => s.store.config.update({ dryRun: false, requireApproval: false, ...over });

describe("dry run", () => {
	it("is the default and never mutates or creates approvals", async () => {
		const s = setup({ radarr: [movie(1), movie(2)] });
		s.rule("old", old(100));
		const log = await s.engine.run({ trigger: "manual" });
		expect(log?.isDryRun).toBe(true);
		expect(log?.itemsFlagged).toBe(2);
		expect(s.radarrApi.calls).toEqual([]);
		expect(s.store.approvals.list()).toHaveLength(0);
		expect(log?.details.every((d: any) => d.outcome === "flagged")).toBe(true);
	});
	it("forceDryRun overrides a live config", async () => {
		const s = setup({ radarr: [movie(1)] });
		live(s);
		s.rule("old", old(100));
		const log = await s.engine.run({ trigger: "manual", forceDryRun: true });
		expect(log?.isDryRun).toBe(true);
		expect(s.radarrApi.calls).toEqual([]);
	});
	it("preview never moves the schedule", async () => {
		const s = setup({ radarr: [movie(1)] });
		s.rule("old", old(100));
		await s.engine.run({ trigger: "manual", forceDryRun: true });
		expect(s.store.config.get().lastRunAt).toBeNull();
	});
});

describe("direct execution", () => {
	it("deletes matching items and records bytes reclaimed + audit trail", async () => {
		const s = setup({ radarr: [movie(1), movie(2, { added: new Date(NOW.getTime() - 5 * DAY).toISOString() })] });
		live(s);
		s.rule("old", old(100));
		const log = await s.engine.run({ trigger: "manual" });
		expect(s.radarrApi.calls).toEqual(["delete:1:true"]);
		expect(log?.itemsRemoved).toBe(1);
		expect(log?.bytesReclaimed).toBe(10 * GB);
		const types = s.store.audit.list().map((e) => e.event_type).reverse();
		expect(types).toEqual(["selected", "execution_started", "executed"]);
	});
	it("honours maxRemovalsPerRun and defers the rest", async () => {
		const s = setup({ radarr: [movie(1), movie(2), movie(3)] });
		live(s, { maxRemovalsPerRun: 2 });
		s.rule("old", old(100));
		const log = await s.engine.run({ trigger: "manual" });
		expect(log?.itemsRemoved).toBe(2);
		expect(log?.details.filter((d: any) => d.message?.startsWith("Deferred"))).toHaveLength(1);
	});
	it("supports unmonitor and delete_files actions", async () => {
		const s = setup({ radarr: [movie(1), movie(2)] });
		live(s);
		s.rule("a", { type: "genre", params: { operator: "includes_any", genres: ["Drama"] } }, { action: "unmonitor", excludeTitles: ["Movie 2"] });
		s.rule("b", old(100), { action: "delete_files", priority: 5 });
		await s.engine.run({ trigger: "manual" });
		expect(s.radarrApi.calls.sort()).toEqual(["delete_files:2", "unmonitor:1"]);
	});
	it("first matching rule by priority wins", async () => {
		const s = setup({ radarr: [movie(1)] });
		live(s);
		s.rule("late", old(100), { action: "delete", priority: 2 });
		s.rule("early", old(100), { action: "unmonitor", priority: 1 });
		await s.engine.run({ trigger: "manual" });
		expect(s.radarrApi.calls).toEqual(["unmonitor:1"]);
	});
});

describe("safety", () => {
	it("retention rules protect items from cleanup", async () => {
		const s = setup({ radarr: [movie(1, { tags: [1] }), movie(2)] });
		live(s);
		s.rule("old", old(100));
		s.rule("keep tagged", { type: "tag_match", params: { operator: "includes_any", tags: ["keep"] } }, { mode: "retention" });
		const log = await s.engine.run({ trigger: "manual" });
		expect(s.radarrApi.calls).toEqual(["delete:2:true"]);
		expect(log?.details.find((d: any) => d.arrItemId === 1)?.message).toMatch(/Protected by retention/);
	});
	it("a retention rule that cannot be evaluated protects the item (fail closed)", async () => {
		const s = setup({ radarr: [movie(1)], watch: "fail" });
		live(s);
		s.rule("old", old(100));
		s.rule("recently watched", { type: "tautulli_last_watched", params: { operator: "watched_within_days", days: 30 } }, { mode: "retention" });
		const log = await s.engine.run({ trigger: "manual" });
		expect(s.radarrApi.calls).toEqual([]);
		expect(log?.warnings.join()).toMatch(/Tautulli/);
		// Planner-level protection (independent of the mutation-boundary recheck):
		const p = await s.engine.preview();
		expect(p.candidates).toHaveLength(0);
		expect(p.skipped[0]?.message).toMatch(/could not be evaluated/);
	});
	it("watch rules never match when Tautulli is down", async () => {
		const s = setup({ radarr: [movie(1)], watch: "fail" });
		live(s);
		s.rule("unwatched", { type: "tautulli_last_watched", params: { operator: "not_watched_in_days", days: 30 } });
		await s.engine.run({ trigger: "manual" });
		expect(s.radarrApi.calls).toEqual([]);
	});
	it("uses Tautulli data when available", async () => {
		const s = setup({ radarr: [movie(1), movie(2)], watch: { "movie:1001": { lastWatchedAt: new Date(NOW.getTime() - 5 * DAY), watchCount: 3, watchedBy: ["a"] } } });
		live(s);
		s.rule("unwatched", { type: "tautulli_last_watched", params: { operator: "not_watched_in_days", days: 30 } });
		await s.engine.run({ trigger: "manual" });
		expect(s.radarrApi.calls).toEqual(["delete:2:true"]);
	});
	it("skips an instance whose library could not be loaded", async () => {
		const s = setup({ radarr: [movie(1)] });
		live(s);
		s.rule("old", old(100));
		s.radarrApi.list = async () => { throw new Error("connection refused"); };
		const log = await s.engine.run({ trigger: "manual" });
		expect(log?.itemsEvaluated).toBe(0);
		expect(log?.warnings[0]).toMatch(/connection refused/);
	});
	it("blocks when the item changed between selection and execution", async () => {
		const s = setup({ radarr: [movie(1)] });
		live(s);
		s.rule("old", old(100));
		const get = s.radarrApi.get.bind(s.radarrApi);
		s.radarrApi.get = async (id) => ({ ...(await get(id)), sizeOnDisk: 99 * GB });
		const log = await s.engine.run({ trigger: "manual" });
		expect(s.radarrApi.calls).toEqual([]);
		expect(log?.details[0]).toMatchObject({ outcome: "blocked" });
		expect(log?.details[0]?.message).toMatch(/size on disk changed/);
	});
	it("re-runs retention rules on fresh data at the mutation boundary", async () => {
		const s = setup({ radarr: [movie(1)] });
		live(s, { requireApproval: true });
		s.rule("old", old(100));
		await s.engine.run({ trigger: "manual" });
		const [a] = s.store.approvals.list("pending");
		// A protective rule added after the proposal must stop the deletion.
		s.rule("late retention", { type: "monitored", params: {} }, { mode: "retention" });
		const r = await s.engine.approve(a!.id, { actor: "me" });
		expect(r.status).toBe("blocked");
		expect(r.lastError).toMatch(/Retention rule "late retention" now protects/);
		expect(s.radarrApi.calls).toEqual([]);
	});
	it("re-evaluates the matched rule on fresh data at the mutation boundary", async () => {
		const s = setup({ radarr: [movie(1)] });
		live(s, { requireApproval: true });
		s.rule("old", old(100));
		await s.engine.run({ trigger: "manual" });
		const [a] = s.store.approvals.list("pending");
		s.clock.now = new Date(NOW.getTime() - 300 * DAY); // item is now "younger" than 100 days
		const r = await s.engine.approve(a!.id, { actor: "me" });
		expect(r.status).toBe("blocked");
		expect(r.lastError).toMatch(/no longer matches/);
	});
	it("Sonarr: snapshot works without file-metadata rules and detects new episodes", async () => {
		const s = setup({ radarr: [], sonarr: [series(1)] });
		live(s);
		s.rule("old", old(100));
		await s.engine.run({ trigger: "manual" });
		expect(s.sonarrApi!.calls).toEqual(["delete:1:true"]);

		const s2 = setup({ radarr: [], sonarr: [series(1)] });
		live(s2);
		s2.rule("old", old(100));
		const get = s2.sonarrApi!.get.bind(s2.sonarrApi);
		s2.sonarrApi!.get = async (id) => { const r = await get(id); r.statistics.episodeFileCount++; return r; };
		const log = await s2.engine.run({ trigger: "manual" });
		expect(s2.sonarrApi!.calls).toEqual([]);
		expect(log?.details[0]?.message).toMatch(/files changed/);
	});
	it("invalid stored rules are skipped with a warning, not executed", async () => {
		const s = setup({ radarr: [movie(1)] });
		live(s);
		s.rule("broken", { type: "age", params: { operator: "older_than", days: -5 } });
		const log = await s.engine.run({ trigger: "manual" });
		expect(s.radarrApi.calls).toEqual([]);
		expect(log?.warnings[0]).toMatch(/invalid expression/);
	});
});

describe("approval workflow", () => {
	const approvalSetup = () => {
		const s = setup({ radarr: [movie(1), movie(2)] });
		live(s, { requireApproval: true });
		s.rule("old", old(100));
		return s;
	};
	it("creates pending approvals instead of mutating, and does not re-propose them", async () => {
		const s = approvalSetup();
		await s.engine.run({ trigger: "manual" });
		expect(s.radarrApi.calls).toEqual([]);
		expect(s.store.approvals.list("pending")).toHaveLength(2);
		const log = await s.engine.run({ trigger: "manual" });
		expect(s.store.approvals.list()).toHaveLength(2);
		expect(log?.details.every((d: any) => d.message === "Already has an open approval")).toBe(true);
	});
	it("approve executes once; a second approve loses the race", async () => {
		const s = approvalSetup();
		await s.engine.run({ trigger: "manual" });
		const [a] = s.store.approvals.list("pending");
		const [r1, r2] = await Promise.allSettled([s.engine.approve(a!.id, { actor: "me" }), s.engine.approve(a!.id, { actor: "me" })]);
		expect([r1.status, r2.status].sort()).toEqual(["fulfilled", "rejected"]);
		expect(s.radarrApi.calls.filter((c) => c.startsWith("delete:"))).toHaveLength(1);
		expect(s.store.approvals.get(a!.id)?.status).toBe("executed");
	});
	it("blocks an approval whose item has changed since it was proposed", async () => {
		const s = approvalSetup();
		await s.engine.run({ trigger: "manual" });
		const [a] = s.store.approvals.list("pending");
		s.radarrApi.items.get(a!.arrItemId)!.path = "/movies/moved";
		const r = await s.engine.approve(a!.id, { actor: "me" });
		expect(r.status).toBe("blocked");
		expect(r.lastError).toMatch(/path changed/);
		expect(s.radarrApi.calls).toEqual([]);
	});
	it("blocks when the rule was disabled after proposal", async () => {
		const s = approvalSetup();
		await s.engine.run({ trigger: "manual" });
		const [a] = s.store.approvals.list("pending");
		s.store.rules.update(a!.ruleId, { enabled: false });
		expect((await s.engine.approve(a!.id, { actor: "me" })).lastError).toMatch(/deleted or disabled/);
	});
	it("treats an already-removed item as reconciled without mutation", async () => {
		const s = approvalSetup();
		await s.engine.run({ trigger: "manual" });
		const [a] = s.store.approvals.list("pending");
		s.radarrApi.items.delete(a!.arrItemId);
		const r = await s.engine.approve(a!.id, { actor: "me" });
		expect(r.status).toBe("executed");
		expect(r.lastError).toMatch(/no mutation/);
		expect(s.radarrApi.calls).toEqual([]);
	});
	it("failed execution goes to retry_pending and a later run retries it", async () => {
		const s = approvalSetup();
		await s.engine.run({ trigger: "manual" });
		const [a] = s.store.approvals.list("pending");
		s.radarrApi.failDelete = true;
		expect((await s.engine.approve(a!.id, { actor: "me" })).status).toBe("retry_pending");
		s.radarrApi.failDelete = false;
		const log = await s.engine.run({ trigger: "manual" });
		expect(s.store.approvals.get(a!.id)?.status).toBe("executed");
		expect(log?.itemsRemoved).toBe(1);
	});
	it("reject then rejection memory suppresses re-proposal for N days", async () => {
		const s = approvalSetup();
		s.store.config.update({ rejectionMemoryDays: 30 });
		await s.engine.run({ trigger: "manual" });
		const [a] = s.store.approvals.list("pending");
		s.engine.reject(a!.id, "me");
		await s.engine.run({ trigger: "manual" });
		expect(s.store.approvals.list().filter((x) => x.arrItemId === a!.arrItemId)).toHaveLength(1);
		s.clock.now = new Date(NOW.getTime() + 31 * DAY);
		await s.engine.run({ trigger: "manual" });
		expect(s.store.approvals.list().filter((x) => x.arrItemId === a!.arrItemId)).toHaveLength(2);
	});
	it("rejection memory is off by default", async () => {
		const s = approvalSetup();
		await s.engine.run({ trigger: "manual" });
		const [a] = s.store.approvals.list("pending");
		s.engine.reject(a!.id, "me");
		await s.engine.run({ trigger: "manual" });
		expect(s.store.approvals.list().filter((x) => x.arrItemId === a!.arrItemId)).toHaveLength(2);
	});
	it("pending approvals expire and cannot be approved afterwards", async () => {
		const s = approvalSetup();
		await s.engine.run({ trigger: "manual" });
		const [a] = s.store.approvals.list("pending");
		s.clock.now = new Date(NOW.getTime() + 8 * DAY);
		await expect(s.engine.approve(a!.id, { actor: "me" })).rejects.toBeInstanceOf(ConflictError);
		expect(s.store.approvals.get(a!.id)?.status).toBe("expired");
	});
	it("refuses to execute approvals while in dry-run mode", async () => {
		const s = approvalSetup();
		await s.engine.run({ trigger: "manual" });
		const [a] = s.store.approvals.list("pending");
		s.store.config.update({ dryRun: true });
		await expect(s.engine.approve(a!.id, { actor: "me" })).rejects.toBeInstanceOf(DryRunError);
	});
	it("only pending approvals can be rejected", async () => {
		const s = approvalSetup();
		await s.engine.run({ trigger: "manual" });
		const [a] = s.store.approvals.list("pending");
		await s.engine.approve(a!.id, { actor: "me" });
		expect(() => s.engine.reject(a!.id, "me")).toThrow(ConflictError);
	});
	it("recovers executions stranded by a crash as retryable, never as done", async () => {
		const s = approvalSetup();
		await s.engine.run({ trigger: "manual" });
		const [a] = s.store.approvals.list("pending");
		s.store.approvals.transition(a!.id, ["pending"], "executing", { token: "t", reviewed: true });
		s.clock.now = new Date(NOW.getTime() + DAY);
		s.store.approvals.recoverStuck(60_000);
		expect(s.store.approvals.get(a!.id)?.status).toBe("retry_pending");
	});
});

describe("run lease & scheduler", () => {
	it("refuses overlapping runs", async () => {
		const s = setup({ radarr: [movie(1)] });
		s.rule("old", old(100));
		const slow = s.radarrApi.list.bind(s.radarrApi);
		s.radarrApi.list = async () => { await new Promise((r) => setTimeout(r, 30)); return slow(); };
		const [a, b] = await Promise.allSettled([s.engine.run({ trigger: "manual" }), s.engine.run({ trigger: "manual" })]);
		expect([a.status, b.status].sort()).toEqual(["fulfilled", "rejected"]);
		expect((a.status === "rejected" ? a.reason : (b as PromiseRejectedResult).reason)).toBeInstanceOf(RunInProgressError);
		// lease released afterwards
		await expect(s.engine.run({ trigger: "manual" })).resolves.toBeDefined();
	});
	it("reclaims a stale lease", async () => {
		const s = setup({ radarr: [] });
		expect(s.store.config.claimRun(60_000)).toBeTruthy();
		expect(s.store.config.claimRun(60_000)).toBeNull();
		s.clock.now = new Date(NOW.getTime() + 61_000);
		expect(s.store.config.claimRun(60_000)).toBeTruthy();
	});
	it("scheduler only runs when enabled and due, and advances the schedule", async () => {
		const s = setup({ radarr: [movie(1)] });
		s.rule("old", old(100));
		const sched = createScheduler({ store: s.store, engine: s.engine, log: { info() {}, warn() {}, error() {} }, now: () => s.clock.now });
		expect(await sched.tick()).toBe(false); // disabled
		s.store.config.update({ enabled: true, intervalHours: 24 });
		expect(await sched.tick()).toBe(false); // not due yet
		s.clock.now = new Date(NOW.getTime() + 25 * 3_600_000);
		expect(await sched.tick()).toBe(true);
		expect(await sched.tick()).toBe(false); // schedule advanced, even for a dry run
		expect(s.store.logs.list()[0]?.trigger).toBe("scheduled");
	});
	it("closes out run logs orphaned by a crash", () => {
		const s = setup({ radarr: [] });
		const id = s.store.logs.start("scheduled", true);
		expect(s.store.logs.failOrphans()).toBe(1);
		expect(s.store.logs.get(id)?.status).toBe("error");
	});
});

describe("explain & preview", () => {
	it("explains per-rule state for one item", async () => {
		const s = setup({ radarr: [movie(1)] });
		s.rule("old", old(100));
		s.rule("huge", { type: "size", params: { operator: "greater_than", sizeGb: 100 } }, { excludeTitles: ["nomatch"] });
		const e = await s.engine.explain(s.radarr.id, 1);
		expect(e.rules.map((r) => r.state)).toEqual(["true", "false"]);
	});
	it("preview lists candidates and totals without writing anything", async () => {
		const s = setup({ radarr: [movie(1), movie(2)] });
		live(s);
		s.rule("old", old(100));
		const p = await s.engine.preview();
		expect(p.candidates).toHaveLength(2);
		expect(p.totalBytes).toBe(20 * GB);
		expect(s.radarrApi.calls).toEqual([]);
		expect(s.store.logs.list()).toHaveLength(0);
	});
});
