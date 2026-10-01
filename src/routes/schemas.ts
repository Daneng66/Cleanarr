import { z } from "zod";
import { parseExpression, ExpressionError } from "../rules/expression.js";
import { getRegexError } from "../rules/regex.js";

const url = z
	.string()
	.trim()
	.url()
	.refine((u) => /^https?:\/\//i.test(u), "URL must be http(s)");

export const instanceCreate = z.object({
	name: z.string().trim().min(1).max(100),
	type: z.enum(["sonarr", "radarr", "tautulli"]),
	url,
	apiKey: z.string().trim().min(1),
	enabled: z.boolean().optional(),
});
export const instanceUpdate = z.object({
	name: z.string().trim().min(1).max(100).optional(),
	url: url.optional(),
	apiKey: z.string().trim().min(1).optional(),
	enabled: z.boolean().optional(),
});
export const instanceTest = z.object({ type: z.enum(["sonarr", "radarr", "tautulli"]), url, apiKey: z.string().trim().min(1) });

export const configUpdate = z
	.object({
		enabled: z.boolean(),
		intervalHours: z.number().int().min(1).max(24 * 30),
		dryRun: z.boolean(),
		maxRemovalsPerRun: z.number().int().min(1).max(10_000),
		requireApproval: z.boolean(),
		approvalExpiryDays: z.number().int().min(1).max(365),
		rejectionMemoryDays: z.number().int().min(0).max(3650).nullable(),
	})
	.partial();

const patterns = z.array(z.string().min(1)).superRefine((list, ctx) => {
	list.forEach((p, i) => {
		const err = getRegexError(p);
		if (err) ctx.addIssue({ code: "custom", message: err, path: [i] });
	});
});

const ruleBase = z.object({
	name: z.string().trim().min(1).max(100),
	enabled: z.boolean().default(true),
	priority: z.number().int().default(0),
	mode: z.enum(["cleanup", "retention"]).default("cleanup"),
	action: z.enum(["delete", "unmonitor", "delete_files"]).default("delete"),
	expression: z.unknown().superRefine((v, ctx) => {
		try {
			parseExpression(v);
		} catch (e) {
			for (const m of e instanceof ExpressionError ? e.issues : [(e as Error).message]) ctx.addIssue({ code: "custom", message: m });
		}
	}),
	serviceFilter: z.array(z.enum(["sonarr", "radarr"])).nullable().default(null),
	instanceFilter: z.array(z.string()).nullable().default(null),
	excludeTags: z.array(z.string().min(1)).nullable().default(null),
	excludeTitles: patterns.nullable().default(null),
	useGlobalRejectionMemory: z.boolean().default(true),
	rejectionMemoryDays: z.number().int().min(0).nullable().default(0),
});
export const ruleCreate = ruleBase;
export const ruleUpdate = ruleBase.partial();
export const ruleReorder = z.object({ ids: z.array(z.string()).min(1) });

export const runRequest = z.object({ dryRun: z.boolean().optional() }).default({});
export const bulkApproval = z.object({ ids: z.array(z.string()).min(1).max(100), action: z.enum(["approve", "reject"]) });
export const explainRequest = z.object({ instanceId: z.string(), arrItemId: z.number().int() });
