import { describe, expect, it } from "vitest";
import { DryRunError, RunInProgressError } from "../src/cleanup/engine.js";
import { createScheduler } from "../src/cleanup/scheduler.js";
import { DAY, GB, NOW, movie, series, setup, old } from "./helpers.js";

const live = (s: ReturnType<typeof setup>, over: Record<string, unknown> = {}) => s.store.config.update({ dryRun: false, ...over });
/** Runs every pending queue item now, as if an operator clicked "Run now" on each. */
async function approveAll(s: ReturnType<typeof setup>) {
	for (const a of s.store.approvals.list("pending")) await s.engine.approve(a.id, { actor: "test" });
}

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

describe("queue execution", () => {
	it("queues matching items, then removes them once run now, recording bytes reclaimed + audit trail", async () => {
		const s = setup({ radarr: [movie(1), movie(2, { added: new Date(NOW.getTime() - 5 * DAY).toISOString() })] });
		live(s);
		s.rule("old", old(100));
		await s.engine.run({ trigger: "manual" });
		const [a] = s.store.approvals.list("pending");
		await s.engine.approve(a!.id, { actor: "me" });
		expect(s.radarrApi.calls).toEqual(["delete:1:true"]);
		expect(s.store.logs.stats().bytes).toBe(10 * GB);
		const types = s.store.audit.list().map((e) => e.event_type).reverse();
		expect(types).toEqual(["proposed", "approved", "executed"]);
	});
	it("honours maxRemovalsPerRun and defers the rest when queueing", async () => {
		const s = setup({ radarr: [movie(1), movie(2), movie(3)] });
		live(s, { maxRemovalsPerRun: 2 });
		s.rule("old", old(100));
		const log = await s.engine.run({ trigger: "manual" });
		expect(s.store.approvals.list("pending")).toHaveLength(2);
		expect(log?.details.filter((d: any) => d.message?.startsWith("Deferred"))).toHaveLength(1);
	});
	it("supports unmonitor and delete_files actions", async () => {
		const s = setup({ radarr: [movie(1), movie(2)] });
		live(s);
		s.rule("a", { type: "genre", params: { operator: "includes_any", genres: ["Drama"] } }, { action: "unmonitor", excludeTitles: ["Movie 2"] });
		s.rule("b", old(100), { action: "delete_files", priority: 5 });
		await s.engine.run({ trigger: "manual" });
		await approveAll(s);
		expect(s.radarrApi.calls.sort()).toEqual(["delete_files:2", "unmonitor:1"]);
	});
	it("first matching rule by priority wins", async () => {
		const s = setup({ radarr: [movie(1)] });
		live(s);
		s.rule("late", old(100), { action: "delete", priority: 2 });
		s.rule("early", old(100), { action: "unmonitor", priority: 1 });
		await s.engine.run({ trigger: "manual" });
		await approveAll(s);
		expect(s.radarrApi.calls).toEqual(["unmonitor:1"]);
	});
	it("a queued item auto-executes once its wait elapses, via the next run", async () => {
		const s = setup({ radarr: [movie(1), movie(2)] });
		live(s, { queueDelayDays: 1 });
		s.rule("old", old(100));
		await s.engine.run({ trigger: "manual" });
		expect(s.radarrApi.calls).toEqual([]);
		s.clock.now = new Date(NOW.getTime() + 25 * 3_600_000);
		const log = await s.engine.run({ trigger: "manual" });
		expect(log?.itemsRemoved).toBe(2);
		expect(s.store.approvals.list("executed")).toHaveLength(2);
	});
	it("immediate: true executes new matches right away, ignoring queueDelayDays", async () => {
		const s = setup({ radarr: [movie(1), movie(2)] });
		live(s, { queueDelayDays: 30 });
		s.rule("old", old(100));
		const log = await s.engine.run({ trigger: "manual", immediate: true });
		expect(log?.itemsRemoved).toBe(2);
		expect(s.radarrApi.calls.sort()).toEqual(["delete:1:true", "delete:2:true"]);
		expect(s.store.approvals.list("pending")).toHaveLength(0);
	});
	it("immediate: true also drains an already-queued item that isn't due yet", async () => {
		const s = setup({ radarr: [movie(1)] });
		live(s, { queueDelayDays: 30 });
		s.rule("old", old(100));
		await s.engine.run({ trigger: "manual" }); // queues it with a 30-day wait
		expect(s.store.approvals.list("pending")).toHaveLength(1);
		const log = await s.engine.run({ trigger: "manual", immediate: true });
		expect(log?.itemsRemoved).toBe(1);
		expect(s.radarrApi.calls).toEqual(["delete:1:true"]);
	});
});

describe("safety", () => {
	it("retention rules protect items from cleanup", async () => {
		const s = setup({ radarr: [movie(1, { tags: [1] }), movie(2)] });
		live(s);
		s.rule("old", old(100));
		s.rule("keep tagged", { type: "tag_match", params: { operator: "includes_any", tags: ["keep"] } }, { mode: "retention" });
		const log = await s.engine.run({ trigger: "manual" });
		expect(log?.details.find((d: any) => d.arrItemId === 1)?.message).toMatch(/Protected by retention/);
		await approveAll(s);
		expect(s.radarrApi.calls).toEqual(["delete:2:true"]);
	});
	it("an ignore-retention override lets cleanup rules flag an item a retention rule protects", async () => {
		const s = setup({ radarr: [movie(1, { tags: [1] })] });
		live(s);
		s.rule("old", old(100));
		s.rule("keep tagged", { type: "tag_match", params: { operator: "includes_any", tags: ["keep"] } }, { mode: "retention" });
		s.store.protected.create({ instanceId: s.radarr.id, arrItemId: 1, itemType: "movie", title: "Movie 1", ignoreRetention: true });
		await s.engine.run({ trigger: "manual" });
		await approveAll(s);
		expect(s.radarrApi.calls).toEqual(["delete:1:true"]);
	});
	it("a retention rule that cannot be evaluated protects the item (fail closed)", async () => {
		const s = setup({ radarr: [movie(1)], watch: "fail" });
		live(s);
		s.rule("old", old(100));
		s.rule("recently watched", { type: "last_watched", params: { operator: "watched_within_days", days: 30 } }, { mode: "retention" });
		const log = await s.engine.run({ trigger: "manual" });
		expect(s.radarrApi.calls).toEqual([]);
		expect(log?.warnings.join()).toMatch(/Watch history/);
		// Planner-level protection (independent of the mutation-boundary recheck):
		const p = await s.engine.preview();
		expect(p.candidates).toHaveLength(0);
		expect(p.skipped[0]?.message).toMatch(/could not be evaluated/);
	});
	it("manually protected items are never queued", async () => {
		const s = setup({ radarr: [movie(1), movie(2)] });
		live(s);
		s.rule("old", old(100));
		s.store.protected.create({ instanceId: s.radarr.id, arrItemId: 1, itemType: "movie", title: "Movie 1" });
		const log = await s.engine.run({ trigger: "manual" });
		expect(log?.details.find((d: any) => d.arrItemId === 1)?.message).toBe("Manually protected");
		await approveAll(s);
		expect(s.radarrApi.calls).toEqual(["delete:2:true"]);
	});
	it("protecting an item after it was already queued blocks execution at the mutation boundary", async () => {
		const s = setup({ radarr: [movie(1)] });
		live(s);
		s.rule("old", old(100));
		await s.engine.run({ trigger: "manual" });
		const [a] = s.store.approvals.list("pending");
		s.store.protected.create({ instanceId: s.radarr.id, arrItemId: 1, itemType: "movie", title: "Movie 1" });
		const r = await s.engine.approve(a!.id, { actor: "me" });
		expect(r.status).toBe("blocked");
		expect(r.lastError).toBe("Manually protected");
		expect(s.radarrApi.calls).toEqual([]);
	});
	it("never fully deletes a series that hasn't ended", async () => {
		const s = setup({ radarr: [], sonarr: [series(1, { status: "continuing" })] });
		live(s);
		s.rule("old", old(100));
		const log = await s.engine.run({ trigger: "manual" });
		expect(s.sonarrApi!.calls).toEqual([]);
		expect(log?.details[0]?.message).toMatch(/Series is "continuing"/);
		const p = await s.engine.preview();
		expect(p.candidates).toHaveLength(0);
	});
	it("still allows unmonitor or delete_files on a series that hasn't ended", async () => {
		const s = setup({ radarr: [], sonarr: [series(1, { status: "continuing" })] });
		live(s);
		s.rule("old", old(100), { action: "unmonitor" });
		await s.engine.run({ trigger: "manual" });
		await approveAll(s);
		expect(s.sonarrApi!.calls).toEqual(["unmonitor:1"]);
	});
	it("watch rules never match when Plex is down", async () => {
		const s = setup({ radarr: [movie(1)], watch: "fail" });
		live(s);
		s.rule("unwatched", { type: "last_watched", params: { operator: "not_watched_in_days", days: 30 } });
		await s.engine.run({ trigger: "manual" });
		expect(s.radarrApi.calls).toEqual([]);
	});
	it("uses Plex data when available", async () => {
		const s = setup({ radarr: [movie(1), movie(2)], watch: { "movie:1001": { lastWatchedAt: new Date(NOW.getTime() - 5 * DAY), watchCount: 3, watchedBy: ["a"] } } });
		live(s);
		s.rule("unwatched", { type: "last_watched", params: { operator: "not_watched_in_days", days: 30 } });
		await s.engine.run({ trigger: "manual" });
		await approveAll(s);
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
		await s.engine.run({ trigger: "manual" });
		const [a] = s.store.approvals.list("pending");
		const get = s.radarrApi.get.bind(s.radarrApi);
		s.radarrApi.get = async (id) => ({ ...(await get(id)), sizeOnDisk: 99 * GB });
		const r = await s.engine.approve(a!.id, { actor: "me" });
		expect(s.radarrApi.calls).toEqual([]);
		expect(r.status).toBe("blocked");
		expect(r.lastError).toMatch(/size on disk changed/);
	});
	it("re-runs retention rules on fresh data at the mutation boundary", async () => {
		const s = setup({ radarr: [movie(1)] });
		live(s);
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
		live(s);
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
		await approveAll(s);
		expect(s.sonarrApi!.calls).toEqual(["delete:1:true"]);

		const s2 = setup({ radarr: [], sonarr: [series(1)] });
		live(s2);
		s2.rule("old", old(100));
		await s2.engine.run({ trigger: "manual" });
		const [a2] = s2.store.approvals.list("pending");
		const get = s2.sonarrApi!.get.bind(s2.sonarrApi);
		s2.sonarrApi!.get = async (id) => { const r = await get(id); r.statistics.episodeFileCount++; return r; };
		const r = await s2.engine.approve(a2!.id, { actor: "me" });
		expect(s2.sonarrApi!.calls).toEqual([]);
		expect(r.lastError).toMatch(/files changed/);
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
		live(s);
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
	it("a queued item past its wait can still be run now manually", async () => {
		const s = approvalSetup();
		await s.engine.run({ trigger: "manual" });
		const [a] = s.store.approvals.list("pending");
		s.clock.now = new Date(NOW.getTime() + 8 * DAY);
		const r = await s.engine.approve(a!.id, { actor: "me" });
		expect(r.status).toBe("executed");
	});
	it("refuses to execute approvals while in dry-run mode", async () => {
		const s = approvalSetup();
		await s.engine.run({ trigger: "manual" });
		const [a] = s.store.approvals.list("pending");
		s.store.config.update({ dryRun: true });
		await expect(s.engine.approve(a!.id, { actor: "me" })).rejects.toBeInstanceOf(DryRunError);
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
		s.store.config.update({ enabled: true, intervalEvery: 1, runTime: "00:00" });
		expect(await sched.tick()).toBe(true); // turning scheduling on runs right away, instead of waiting a full interval
		expect(await sched.tick()).toBe(false); // schedule advanced, even for a dry run
		s.clock.now = new Date(NOW.getTime() + 25 * 3_600_000);
		expect(await sched.tick()).toBe(true);
		expect(await sched.tick()).toBe(false); // schedule advanced again
		expect(s.store.logs.list()[0]?.trigger).toBe("scheduled");
	});
	it("turning dry run off also runs right away, even if already enabled and not due", async () => {
		const s = setup({ radarr: [movie(1)] });
		s.rule("old", old(100));
		const sched = createScheduler({ store: s.store, engine: s.engine, log: { info() {}, warn() {}, error() {} }, now: () => s.clock.now });
		s.store.config.update({ enabled: true, intervalEvery: 1, runTime: "00:00" });
		await sched.tick(); // consume the immediate run from enabling, back to "not due"
		expect(await sched.tick()).toBe(false);
		s.store.config.update({ dryRun: false });
		expect(await sched.tick()).toBe(true); // going live runs right away too
		expect(await sched.tick()).toBe(false); // and a no-op save afterwards doesn't re-trigger it
		s.store.config.update({ dryRun: false });
		expect(await sched.tick()).toBe(false);
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
	it("preview lists candidates and totals, queueing new matches but never executing or logging a run", async () => {
		const s = setup({ radarr: [movie(1), movie(2)] });
		live(s, { queueDelayDays: 5 });
		s.rule("old", old(100));
		const p = await s.engine.preview();
		expect(p.candidates).toHaveLength(2);
		expect(p.totalBytes).toBe(20 * GB);
		expect(s.radarrApi.calls).toEqual([]);
		expect(s.store.logs.list()).toHaveLength(0);
		// A match is never shown without a countdown: preview queues it on the spot.
		for (const c of p.candidates as any[]) {
			expect(c.queue).toMatchObject({ status: "pending" });
			expect(new Date(c.queue.executeAfter).getTime()).toBe(NOW.getTime() + 5 * DAY);
		}
		expect(s.store.approvals.list("pending")).toHaveLength(2);
	});
	it("preview during dry run never queues anything", async () => {
		const s = setup({ radarr: [movie(1)] });
		s.rule("old", old(100));
		const p = await s.engine.preview();
		expect((p.candidates[0] as any).queue).toBeNull();
		expect(s.store.approvals.list("pending")).toHaveLength(0);
	});
	it("preview lists items with no file on disk", async () => {
		const s = setup({ radarr: [movie(1), movie(2, { hasFile: false, movieFile: null, sizeOnDisk: 0 })] });
		const p = await s.engine.preview();
		expect(p.missing.map((m) => m.title)).toEqual(["Movie 2"]);
		expect(p.missing[0]?.itemType).toBe("movie");
	});
	it("preview keeps showing an already-queued item, annotated with its queue status instead of hiding it", async () => {
		const s = setup({ radarr: [movie(1), movie(2)] });
		live(s, { queueDelayDays: 5 });
		s.rule("old", old(100));
		await s.engine.run({ trigger: "manual" }); // queues both
		const p = await s.engine.preview();
		expect(p.candidates).toHaveLength(2);
		const c1 = p.candidates.find((c: any) => c.arrItemId === 1) as any;
		expect(c1.queue).toMatchObject({ status: "pending" });
		expect(c1.queue.id).toBeDefined();
		expect(new Date(c1.queue.executeAfter).getTime()).toBe(NOW.getTime() + 5 * DAY);
		expect(p.skipped.some((d: any) => d.message === "Already has an open approval")).toBe(false);
	});
});

describe("Plex + Seerr stack", () => {
	const alice = { id: 1, status: 2, createdAt: new Date(NOW.getTime() - 300 * DAY), updatedAt: NOW, is4k: false, requesters: ["Alice"] };
	const watchedBy = (...users: string[]) => ({ lastWatchedAt: new Date(NOW.getTime() - 10 * DAY), watchCount: users.length, watchedBy: users });
	const requesterWatched = { op: "and", of: [{ type: "seerr_requester_watched", params: { operator: "requester_watched" } }, old(100)] };

	it("removes titles the requester has already watched, and keeps the rest", async () => {
		const s = setup({
			radarr: [movie(1), movie(2), movie(3)],
			watch: { "movie:1001": watchedBy("Alice"), "movie:1002": watchedBy("Bob") },
			seerr: { "movie:1001": [alice], "movie:1002": [alice], "movie:1003": [alice] },
		});
		live(s);
		s.rule("requester watched", requesterWatched);
		await s.engine.run({ trigger: "manual" });
		await approveAll(s);
		expect(s.radarrApi.calls).toEqual(["delete:1:true"]); // 2: only Bob watched; 3: nobody watched
	});
	it("an unreachable Seerr blocks request-based removal and warns", async () => {
		const s = setup({ radarr: [movie(1)], watch: { "movie:1001": watchedBy("Alice") }, seerr: "fail" });
		live(s);
		s.rule("requester watched", requesterWatched);
		const log = await s.engine.run({ trigger: "manual" });
		expect(s.radarrApi.calls).toEqual([]);
		expect(log?.warnings.join()).toMatch(/Seerr: seerr down/);
	});
	it("an unreachable Plex blocks watch-based removal and warns", async () => {
		const s = setup({ radarr: [movie(1)], watch: "fail", seerr: { "movie:1001": [alice] } });
		live(s);
		s.rule("requester watched", requesterWatched);
		const log = await s.engine.run({ trigger: "manual" });
		expect(s.radarrApi.calls).toEqual([]);
		expect(log?.warnings.join()).toMatch(/Watch history: plex down/);
	});
	it("warns when rules need Seerr but none is configured", async () => {
		const s = setup({ radarr: [movie(1)] });
		s.rule("not requested", { type: "seerr_is_requested", params: { operator: "not_requested" } });
		const log = await s.engine.run({ trigger: "manual" });
		expect(log?.itemsFlagged).toBe(0);
		expect(log?.warnings.join()).toMatch(/no Seerr instance/);
	});
	it("manually-added (never requested) titles can be targeted, and a retention rule can still protect them", async () => {
		const s = setup({ radarr: [movie(1), movie(2, { tags: [1] })], seerr: { "movie:1001": [] } });
		live(s);
		s.rule("not requested", { op: "and", of: [{ type: "seerr_is_requested", params: { operator: "not_requested" } }, old(100)] });
		s.rule("keep", { type: "tag_match", params: { operator: "includes_any", tags: ["keep"] } }, { mode: "retention" });
		await s.engine.run({ trigger: "manual" });
		await approveAll(s);
		expect(s.radarrApi.calls).toEqual(["delete:1:true"]);
	});
	it("approval execution re-checks Seerr/Plex on fresh data", async () => {
		const s = setup({ radarr: [movie(1)], watch: { "movie:1001": watchedBy("Alice") }, seerr: { "movie:1001": [alice] } });
		live(s);
		s.rule("requester watched", requesterWatched);
		await s.engine.run({ trigger: "manual" });
		const [a] = s.store.approvals.list("pending");
		expect(a).toBeDefined();
		// Plex becomes unreachable before the operator clicks approve: execution must not proceed on stale evidence.
		const insts = s.store.instances.list().find((i) => i.type === "plex")!;
		s.store.instances.update(insts.id, { enabled: false });
		const r = await s.engine.approve(a!.id, { actor: "me" });
		expect(r.status).toBe("blocked");
		expect(s.radarrApi.calls).toEqual([]);
	});
});

describe("preview library summary", () => {
	it("totals movies, series, episodes and missing files", async () => {
		const s = setup({ radarr: [movie(1), movie(2, { hasFile: false, movieFile: null, sizeOnDisk: 0 })], sonarr: [series(1)] });
		const p = await s.engine.preview();
		expect(p.library).toEqual({ movies: 2, series: 1, files: 20, capacityBytes: 14 * GB, missing: 1, movieBytes: 10 * GB, seriesBytes: 40 * GB, totalBytes: 50 * GB });
	});
});

describe("delete season", () => {
	const aired = new Date(NOW.getTime() - 100 * DAY).toISOString();
	const future = new Date(NOW.getTime() + 7 * DAY).toISOString();
	const show = series(1, {
		seasons: [
			{ seasonNumber: 1, monitored: true, statistics: { sizeOnDisk: 20 * GB, episodeFileCount: 2 } },
			{ seasonNumber: 2, monitored: true, statistics: { sizeOnDisk: 10 * GB, episodeFileCount: 1 } },
			{ seasonNumber: 3, monitored: true, statistics: { sizeOnDisk: 10 * GB, episodeFileCount: 1 } },
		],
	});
	const ep = (season: number, n: number, airDateUtc: string) => ({ seasonNumber: season, episodeNumber: n, airDateUtc, hasFile: true });
	const req = (name: string, seasons: number[]) => ({ id: seasons[0]!, status: 5, createdAt: new Date(NOW.getTime() - 300 * DAY), updatedAt: NOW, is4k: false, requesters: [name], seasons });
	const seen = (user: string, eps: number[]) => ({ lastWatchedAt: NOW, watchCount: eps.length, watchedBy: [user], episodesByUser: new Map([[user, new Set(eps)]]) });
	const rule = (users?: string[]) => ({ type: "season_requester_watched", params: users ? { users } : {} });

	function stack(seerr = { "series:3001": [req("Alice", [1, 2]), req("Bob", [3])] }) {
		const s = setup({
			sonarr: [show],
			seerr,
			// S1 fully watched by Alice; S2 still airing; S3 fully watched, but by Alice, not its requester Bob.
			watch: { "season:3001:1": seen("Alice", [1, 2]), "season:3001:2": seen("Alice", [1]), "season:3001:3": seen("Alice", [1]) },
		});
		s.sonarrApi!.eps.set(1, [ep(1, 1, aired), ep(1, 2, aired), ep(2, 1, aired), ep(2, 2, future), ep(3, 1, aired)]);
		return s;
	}

	it("flags only seasons the requester has fully watched and that have finished airing", async () => {
		const s = stack();
		s.rule("season done", rule(), { action: "delete_season" });
		const p = await s.engine.preview();
		expect(p.candidates.map((c) => [c.itemType, c.seasonNumber, c.sizeOnDisk])).toEqual([["season", 1, 20 * GB]]);
		expect(p.candidates[0]!.reason).toMatch(/Season 1 fully watched by requester Alice/);
		expect(p.evaluated).toBe(1); // seasons aren't counted as extra titles
	});
	it("limits to particular requesters", async () => {
		const s = stack();
		s.rule("bob's seasons", rule(["Bob"]), { action: "delete_season" });
		expect((await s.engine.preview()).candidates).toEqual([]);
	});
	it("deletes the season through an approval, rechecking first", async () => {
		const s = stack();
		live(s);
		s.rule("season done", rule(), { action: "delete_season" });
		await s.engine.run({ trigger: "manual" });
		const [a] = s.store.approvals.list("pending");
		expect([a!.itemType, a!.seasonNumber]).toEqual(["season", 1]);
		// A second run must not propose the same season again.
		await s.engine.run({ trigger: "manual" });
		expect(s.store.approvals.list("pending")).toHaveLength(1);
		const r = await s.engine.approve(a!.id, { actor: "me" });
		expect(r.status).toBe("executed");
		expect(s.sonarrApi!.calls).toEqual(["delete_season:1:1"]);
	});
	it("season rules never act on whole series, and series rules never act on seasons", async () => {
		const s = stack();
		live(s);
		s.rule("old", old(100));
		await s.engine.run({ trigger: "manual" });
		await approveAll(s);
		expect(s.sonarrApi!.calls).toEqual(["delete:1:true"]);
	});
	it("lists episodes on disk by season, optionally one season", async () => {
		const s = stack();
		s.sonarrApi!.eps.set(1, [{ ...ep(1, 2, aired), episodeFileId: 12, title: "Two" }, { ...ep(1, 1, aired), episodeFileId: 11, title: "One" }, { ...ep(2, 1, aired), episodeFileId: 21 }, { ...ep(2, 2, future), hasFile: false }]);
		s.sonarrApi!.files.set(1, [{ id: 11, size: 1 * GB }, { id: 12, size: 2 * GB }, { id: 21, size: 4 * GB }]);
		const all = await s.engine.episodesOnDisk(s.sonarr!.id, 1);
		expect(all.map((x) => [x.number, x.size, x.episodes.map((e) => e.number)])).toEqual([[1, 3 * GB, [1, 2]], [2, 4 * GB, [1]]]);
		expect((await s.engine.episodesOnDisk(s.sonarr!.id, 1, 2)).map((x) => x.number)).toEqual([2]);
	});
	it("retention on the series protects its seasons", async () => {
		const s = stack();
		live(s);
		s.rule("season done", rule(), { action: "delete_season" });
		s.rule("keep monitored", { type: "monitored", params: {} }, { mode: "retention" });
		await s.engine.run({ trigger: "manual" });
		expect(s.sonarrApi!.calls).toEqual([]);
	});
});
