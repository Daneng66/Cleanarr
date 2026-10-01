import { timingSafeEqual } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { createArrClient } from "./arr/client.js";
import { ConflictError, DryRunError, RunInProgressError, createEngine, type Engine } from "./cleanup/engine.js";
import { describeRuleTypes, } from "./rules/registry.js";
import { parseExpression } from "./rules/expression.js";
import * as S from "./routes/schemas.js";
import type { Store } from "./store.js";
import { createTautulliProvider, testTautulli } from "./watch/tautulli.js";
import type { Db } from "./db.js";

export interface AppDeps {
	store: Store;
	db: Db;
	engine?: Engine;
	apiKey: string | null;
	logger?: boolean | object;
	version?: string;
}

const same = (a: string, b: string) => {
	const x = Buffer.from(a);
	const y = Buffer.from(b);
	return x.length === y.length && timingSafeEqual(x, y);
};

export function buildApp(deps: AppDeps): FastifyInstance {
	const { store, db } = deps;
	const app = Fastify({ logger: deps.logger ?? false, bodyLimit: 1_000_000 });
	const engine =
		deps.engine ??
		createEngine({
			store,
			log: app.log,
			arr: (i) => createArrClient(i),
			watch: (i) => createTautulliProvider(i, db),
		});

	app.setErrorHandler((err: any, _req, reply) => {
		if (err instanceof ZodError) return reply.code(400).send({ error: "Validation failed", issues: err.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`) });
		if (err instanceof RunInProgressError) return reply.code(409).send({ error: err.message });
		if (err instanceof DryRunError) return reply.code(409).send({ error: err.message, code: "dry_run" });
		if (err instanceof ConflictError) return reply.code(409).send({ error: err.message });
		if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message });
		app.log.error(err);
		return reply.code(500).send({ error: "Internal error" });
	});

	app.get("/healthz", async () => ({ ok: true }));

	// ── API (optionally gated by CLEANARR_API_KEY) ─────────────────────────
	app.register(async (api) => {
		if (deps.apiKey) {
			const key = deps.apiKey;
			api.addHook("onRequest", async (req, reply) => {
				const header = req.headers.authorization;
				const given = (typeof header === "string" && header.startsWith("Bearer ") ? header.slice(7) : undefined) ?? (req.headers["x-api-key"] as string | undefined) ?? "";
				if (!same(given, key)) return reply.code(401).send({ error: "Unauthorized" });
			});
		}

		api.get("/auth", async () => ({ required: !!deps.apiKey }));
		api.get("/rule-types", async () => describeRuleTypes());

		// Instances. API keys are write-only: never returned.
		const publicInstance = (i: { id: string; name: string; type: string; url: string; enabled: boolean }) => ({ id: i.id, name: i.name, type: i.type, url: i.url, enabled: i.enabled });
		api.get("/instances", async () => store.instances.list().map(publicInstance));
		api.post("/instances", async (req, reply) => reply.code(201).send(publicInstance(store.instances.create(S.instanceCreate.parse(req.body)))));
		api.put<{ Params: { id: string } }>("/instances/:id", async (req, reply) => {
			const updated = store.instances.update(req.params.id, S.instanceUpdate.parse(req.body));
			return updated ? publicInstance(updated) : reply.code(404).send({ error: "Not found" });
		});
		api.delete<{ Params: { id: string } }>("/instances/:id", async (req, reply) => (store.instances.delete(req.params.id) ? reply.code(204).send() : reply.code(404).send({ error: "Not found" })));
		const probe = async (i: { type: "sonarr" | "radarr" | "tautulli"; url: string; apiKey: string }) => {
			try {
				if (i.type === "tautulli") await testTautulli(i);
				else await createArrClient(i).status();
				return { ok: true };
			} catch (e) {
				return { ok: false, error: (e as Error).message.replace(i.apiKey, "***") };
			}
		};
		api.post("/instances/test", async (req) => probe(S.instanceTest.parse(req.body)));
		api.post<{ Params: { id: string } }>("/instances/:id/test", async (req, reply) => {
			const i = store.instances.get(req.params.id);
			return i ? probe(i) : reply.code(404).send({ error: "Not found" });
		});

		// Config
		api.get("/config", async () => store.config.get());
		api.put("/config", async (req) => store.config.update(S.configUpdate.parse(req.body)));

		// Rules
		api.get("/rules", async () => store.rules.list());
		api.post("/rules", async (req, reply) => {
			const body = S.ruleCreate.parse(req.body);
			return reply.code(201).send(store.rules.create({ ...body, expression: parseExpression(body.expression) }));
		});
		api.put<{ Params: { id: string } }>("/rules/reorder", async (req) => (store.rules.reorder(S.ruleReorder.parse(req.body).ids), store.rules.list()));
		api.put<{ Params: { id: string } }>("/rules/:id", async (req, reply) => {
			const body = S.ruleUpdate.parse(req.body);
			const patch = { ...body, ...(body.expression !== undefined ? { expression: parseExpression(body.expression) } : {}) };
			const updated = store.rules.update(req.params.id, patch as never);
			return updated ?? reply.code(404).send({ error: "Not found" });
		});
		api.delete<{ Params: { id: string } }>("/rules/:id", async (req, reply) => (store.rules.delete(req.params.id) ? reply.code(204).send() : reply.code(404).send({ error: "Not found" })));

		// Runs
		api.get("/status", async () => ({ config: store.config.get(), approvals: store.approvals.counts(), totals: store.logs.stats(), lastRun: store.logs.list(1)[0] ?? null, version: deps.version ?? "dev" }));
		api.post("/preview", async () => engine.preview());
		api.post("/run", async (req) => {
			const body = S.runRequest.parse(req.body ?? {});
			return engine.run({ trigger: "manual", forceDryRun: body.dryRun === true });
		});
		api.post("/explain", async (req) => {
			const b = S.explainRequest.parse(req.body);
			return engine.explain(b.instanceId, b.arrItemId);
		});
		api.get<{ Querystring: { limit?: string; offset?: string } }>("/logs", async (req) => store.logs.list(Math.min(Number(req.query.limit ?? 50), 200), Number(req.query.offset ?? 0)));
		api.get<{ Params: { id: string } }>("/logs/:id", async (req, reply) => store.logs.get(req.params.id) ?? reply.code(404).send({ error: "Not found" }));

		// Approvals
		api.get<{ Querystring: { status?: string } }>("/approvals", async (req) => store.approvals.list(req.query.status));
		api.post<{ Params: { id: string } }>("/approvals/:id/approve", async (req) => engine.approve(req.params.id, { actor: "operator" }));
		api.post<{ Params: { id: string } }>("/approvals/:id/retry", async (req) => engine.approve(req.params.id, { actor: "operator", trigger: "retry" }));
		api.post<{ Params: { id: string } }>("/approvals/:id/reject", async (req) => engine.reject(req.params.id, "operator"));
		api.post("/approvals/bulk", async (req) => {
			const b = S.bulkApproval.parse(req.body);
			const results: Array<{ id: string; ok: boolean; status?: string; error?: string }> = [];
			for (const id of b.ids) {
				try {
					const r = b.action === "approve" ? await engine.approve(id, { actor: "operator" }) : engine.reject(id, "operator");
					results.push({ id, ok: true, status: r.status });
				} catch (e) {
					if (e instanceof DryRunError) throw e;
					results.push({ id, ok: false, error: (e as Error).message });
				}
			}
			return { results };
		});

		// Audit
		api.get<{ Querystring: { limit?: string; offset?: string; correlationId?: string; approvalId?: string } }>("/audit", async (req) =>
			store.audit.list({ limit: Math.min(Number(req.query.limit ?? 100), 500), offset: Number(req.query.offset ?? 0), correlationId: req.query.correlationId, approvalId: req.query.approvalId }),
		);
	}, { prefix: "/api" });

	// ── Web UI ─────────────────────────────────────────────────────────────
	app.register(fastifyStatic, { root: join(dirname(fileURLToPath(import.meta.url)), "web"), wildcard: false });
	app.setNotFoundHandler((req, reply) => (req.url.startsWith("/api/") ? reply.code(404).send({ error: "Not found" }) : reply.code(404).send("Not found")));

	return app;
}
