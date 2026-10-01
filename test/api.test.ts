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
		expect((await a.inject("/api/config")).json()).toMatchObject({ enabled: false, dryRun: true, requireApproval: true });
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
		expect(done.status).toBe("executed");
		expect(s.radarrApi.calls).toEqual(["delete:1:true"]);
		expect((await a.inject({ method: "POST", url: `/api/approvals/${ap.id}/approve` })).statusCode).toBe(409);
		expect((await a.inject("/api/audit")).json().length).toBeGreaterThan(2);
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
	it("bulk reject", async () => {
		const { s, app: a } = app("", { radarr: [movie(1), movie(2)] });
		await a.inject({ method: "POST", url: "/api/rules", payload: { name: "old", expression: old(100) } });
		await a.inject({ method: "PUT", url: "/api/config", payload: { dryRun: false } });
		await a.inject({ method: "POST", url: "/api/run", payload: {} });
		const ids = s.store.approvals.list("pending").map((x) => x.id);
		const res = (await a.inject({ method: "POST", url: "/api/approvals/bulk", payload: { ids, action: "reject" } })).json();
		expect(res.results.every((r: any) => r.ok && r.status === "rejected")).toBe(true);
	});
	it("explain endpoint", async () => {
		const { s, app: a } = app();
		await a.inject({ method: "POST", url: "/api/rules", payload: { name: "old", expression: old(100) } });
		const res = await a.inject({ method: "POST", url: "/api/explain", payload: { instanceId: s.radarr.id, arrItemId: 1 } });
		expect(res.json().rules[0].state).toBe("true");
	});
});
