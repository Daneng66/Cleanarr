import { describe, expect, it } from "vitest";
import { buildApp } from "../src/server.js";
import { movie, setup, old } from "./helpers.js";

function app(apiKey: string | null = null, opts: Parameters<typeof setup>[0] = { radarr: [movie(1)] }) {
	const s = setup(opts);
	return { s, app: buildApp({ store: s.store, db: s.db, engine: s.engine, apiKey }) };
}

describe("auth", () => {
	it("is open when no key is configured", async () => {
		const { app: a } = app();
		expect((await a.inject("/api/auth")).json()).toEqual({ required: false });
	});
	it("requires the key (bearer or x-api-key) when configured; healthz and UI stay open", async () => {
		const { app: a } = app("s3cret");
		expect((await a.inject("/api/config")).statusCode).toBe(401);
		expect((await a.inject({ url: "/api/config", headers: { authorization: "Bearer wrong" } })).statusCode).toBe(401);
		expect((await a.inject({ url: "/api/config", headers: { authorization: "Bearer s3cret" } })).statusCode).toBe(200);
		expect((await a.inject({ url: "/api/config", headers: { "x-api-key": "s3cret" } })).statusCode).toBe(200);
		expect((await a.inject("/healthz")).statusCode).toBe(200);
	});
});

describe("request bodies", () => {
	it("action endpoints accept an empty body with a JSON content-type", async () => {
		const { app: a } = app();
		expect((await a.inject({ method: "POST", url: "/api/preview", headers: { "content-type": "application/json" }, payload: "" })).statusCode).toBe(200);
		expect((await a.inject({ method: "POST", url: "/api/run", headers: { "content-type": "application/json" }, payload: "" })).statusCode).toBe(200);
	});
	it("malformed JSON is a 400, not a 500", async () => {
		const { app: a } = app();
		const res = await a.inject({ method: "POST", url: "/api/rules", headers: { "content-type": "application/json" }, payload: "{nope" });
		expect(res.statusCode).toBe(400);
	});
});

describe("instances", () => {
	it("never returns API keys and stores them encrypted", async () => {
		const { s, app: a } = app();
		const res = await a.inject({ method: "POST", url: "/api/instances", payload: { name: "R2", type: "radarr", url: "http://r2:7878/", apiKey: "topsecret" } });
		expect(res.statusCode).toBe(201);
		expect(JSON.stringify(res.json())).not.toContain("topsecret");
		expect(JSON.stringify((await a.inject("/api/instances")).json())).not.toContain("topsecret");
		const raw = s.db.prepare("SELECT api_key_enc FROM instances WHERE name='R2'").get() as { api_key_enc: string };
		expect(raw.api_key_enc).not.toContain("topsecret");
		expect(s.store.instances.get(res.json().id)?.apiKey).toBe("topsecret");
		expect(res.json().url).toBe("http://r2:7878");
	});
	it("validates url scheme", async () => {
		const { app: a } = app();
		const res = await a.inject({ method: "POST", url: "/api/instances", payload: { name: "x", type: "radarr", url: "file:///etc/passwd", apiKey: "k" } });
		expect(res.statusCode).toBe(400);
	});
});

describe("rules & config", () => {
	it("rejects invalid expressions with readable issues", async () => {
		const { app: a } = app();
		const res = await a.inject({ method: "POST", url: "/api/rules", payload: { name: "bad", expression: { type: "age", params: { operator: "older_than", days: 0 } } } });
		expect(res.statusCode).toBe(400);
		expect(res.json().issues.join()).toMatch(/days/);
	});
	it("rejects unsafe exclude regexes", async () => {
		const { app: a } = app();
		const res = await a.inject({ method: "POST", url: "/api/rules", payload: { name: "bad", expression: old(10), excludeTitles: ["(a+)+"] } });
		expect(res.statusCode).toBe(400);
	});
	it("CRUD + reorder", async () => {
		const { app: a } = app();
		const mk = async (name: string) => (await a.inject({ method: "POST", url: "/api/rules", payload: { name, expression: old(10) } })).json();
		const r1 = await mk("one");
		const r2 = await mk("two");
		const re = await a.inject({ method: "PUT", url: "/api/rules/reorder", payload: { ids: [r2.id, r1.id] } });
		expect(re.json().map((r: any) => r.name)).toEqual(["two", "one"]);
		expect((await a.inject({ method: "PUT", url: `/api/rules/${r1.id}`, payload: { enabled: false } })).json().enabled).toBe(false);
		expect((await a.inject({ method: "DELETE", url: `/api/rules/${r1.id}` })).statusCode).toBe(204);
		expect((await a.inject({ method: "DELETE", url: `/api/rules/${r1.id}` })).statusCode).toBe(404);
	});
	it("defaults to the safe posture", async () => {
		const { app: a } = app();
		expect((await a.inject("/api/config")).json()).toMatchObject({ enabled: false, dryRun: true });
	});
	it("exposes rule type metadata for the UI", async () => {
		const { app: a } = app();
		const types = (await a.inject("/api/rule-types")).json();
		expect(types.find((t: any) => t.type === "age").fields).toHaveLength(2);
	});
});

describe("runs and approvals over HTTP", () => {
	it("runs end to end: rule → run → approval → approve", async () => {
		const { s, app: a } = app();
		await a.inject({ method: "POST", url: "/api/rules", payload: { name: "old", expression: old(100) } });
		await a.inject({ method: "PUT", url: "/api/config", payload: { dryRun: false } });
		const run = (await a.inject({ method: "POST", url: "/api/run", payload: {} })).json();
		expect(run.itemsFlagged).toBe(1);
		const [ap] = (await a.inject("/api/approvals?status=pending")).json();
		expect(ap.title).toBe("Movie 1");
		const done = (await a.inject({ method: "POST", url: `/api/approvals/${ap.id}/approve` })).json();
		expect(done.status).toBe("reclaimed");
		expect(s.radarrApi.calls).toEqual(["delete:1:true"]);
		expect((await a.inject({ method: "POST", url: `/api/approvals/${ap.id}/approve` })).statusCode).toBe(409);
		expect((await a.inject("/api/audit")).json().length).toBe(2);
		expect((await a.inject("/api/status")).json().totals).toMatchObject({ removed: 1, bytes: 10 * 1024 ** 3 });
	});
	it("dry-run blocks approve with a clear 409", async () => {
		const { s, app: a } = app();
		await a.inject({ method: "POST", url: "/api/rules", payload: { name: "old", expression: old(100) } });
		await a.inject({ method: "PUT", url: "/api/config", payload: { dryRun: false } });
		await a.inject({ method: "POST", url: "/api/run", payload: {} });
		await a.inject({ method: "PUT", url: "/api/config", payload: { dryRun: true } });
		const [ap] = s.store.approvals.list("pending");
		const res = await a.inject({ method: "POST", url: `/api/approvals/${ap!.id}/approve` });
		expect(res.statusCode).toBe(409);
		expect(res.json().code).toBe("dry_run");
	});
	it("preview includes already-queued items with their countdown, instead of hiding them", async () => {
		const { app: a } = app("", { radarr: [movie(1), movie(2)] });
		await a.inject({ method: "POST", url: "/api/rules", payload: { name: "old", expression: old(100) } });
		await a.inject({ method: "PUT", url: "/api/config", payload: { dryRun: false } });
		await a.inject({ method: "POST", url: "/api/run", payload: {} });
		const p = (await a.inject({ method: "POST", url: "/api/preview" })).json();
		expect(p.candidates).toHaveLength(2);
		expect(p.candidates.every((c: any) => c.queue?.status === "pending" && c.queue?.id)).toBe(true);
	});
	it("explain endpoint", async () => {
		const { s, app: a } = app();
		await a.inject({ method: "POST", url: "/api/rules", payload: { name: "old", expression: old(100) } });
		const res = await a.inject({ method: "POST", url: "/api/explain", payload: { instanceId: s.radarr.id, arrItemId: 1 } });
		expect(res.json().rules[0].state).toBe("true");
	});
	it("a queued item auto-executes once its wait elapses, via a later run", async () => {
		const { s, app: a } = app();
		await a.inject({ method: "POST", url: "/api/rules", payload: { name: "old", expression: old(100) } });
		await a.inject({ method: "PUT", url: "/api/config", payload: { dryRun: false, queueDelayDays: 1 } });
		await a.inject({ method: "POST", url: "/api/run", payload: {} });
		expect(s.radarrApi.calls).toEqual([]);
		s.clock.now = new Date(s.clock.now.getTime() + 25 * 3_600_000);
		const run2 = (await a.inject({ method: "POST", url: "/api/run", payload: {} })).json();
		expect(run2.itemsRemoved).toBe(1);
		expect(s.radarrApi.calls).toEqual(["delete:1:true"]);
	});
});

describe("manual protection", () => {
	it("create, list, delete, and link endpoint", async () => {
		const { s, app: a } = app();
		const created = (await a.inject({ method: "POST", url: "/api/protected", payload: { instanceId: s.radarr.id, arrItemId: 1, itemType: "movie", title: "Movie 1" } })).json();
		expect((await a.inject("/api/protected")).json()).toHaveLength(1);
		expect((await a.inject({ method: "DELETE", url: `/api/protected/${created.id}` })).statusCode).toBe(204);
		expect((await a.inject("/api/protected")).json()).toHaveLength(0);
		const link = (await a.inject(`/api/link/${s.radarr.id}/1`)).json();
		expect(link.url).toMatch(/\/movie\//);
	});
	it("a protected item is never queued", async () => {
		const { s, app: a } = app();
		await a.inject({ method: "POST", url: "/api/protected", payload: { instanceId: s.radarr.id, arrItemId: 1, itemType: "movie", title: "Movie 1" } });
		await a.inject({ method: "POST", url: "/api/rules", payload: { name: "old", expression: old(100) } });
		await a.inject({ method: "PUT", url: "/api/config", payload: { dryRun: false } });
		await a.inject({ method: "POST", url: "/api/run", payload: {} });
		expect(s.radarrApi.calls).toEqual([]);
		expect((await a.inject("/api/approvals?status=pending")).json()).toHaveLength(0);
	});
});

describe("library", () => {
	const GB = 1024 ** 3;
	it("lists everything, filters with a rule expression, and flags protected titles", async () => {
		const { s, app: a } = app(null, { radarr: [movie(1), movie(2, { sizeOnDisk: 1 * GB })] });
		const all = (await a.inject({ method: "POST", url: "/api/library", payload: {} })).json();
		expect(all.items).toHaveLength(2);
		const arrId = all.items[0].arrItemId;
		s.store.protected.create({ instanceId: all.items[0].instanceId, arrItemId: arrId, itemType: "movie", seasonNumber: null, title: "x" });
		const filtered = (await a.inject({ method: "POST", url: "/api/library", payload: { expression: old(10), excludeTitles: ["Movie 2"] } })).json();
		expect(filtered.items.map((i: { title: string }) => i.title)).toEqual(["Movie 1"]);
		expect(filtered.items[0].protectedId).toBeTruthy();
		expect((await a.inject({ method: "POST", url: "/api/library", payload: { expression: { type: "nope", params: {} } } })).statusCode).toBe(400);
	});
	it("bulk remove skips manually protected titles", async () => {
		const { s, app: a } = app(null, { radarr: [movie(1), movie(2)] });
		const items = (await a.inject({ method: "POST", url: "/api/library", payload: {} })).json().items as Array<{ instanceId: string; arrItemId: number }>;
		s.store.protected.create({ instanceId: items[0]!.instanceId, arrItemId: items[0]!.arrItemId, itemType: "movie", seasonNumber: null, title: "x" });
		const res = (await a.inject({ method: "POST", url: "/api/library/remove", payload: { action: "delete", items: items.map(({ instanceId, arrItemId }) => ({ instanceId, arrItemId })) } })).json();
		expect(res.map((r: { status: string }) => r.status)).toEqual(["blocked", "done"]);
		expect(s.radarrApi.calls).toEqual([`delete:${items[1]!.arrItemId}:true`]);
	});
});
