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
	type: z.enum(["sonarr", "radarr", "plex", "seerr"]),
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
export const instanceTest = z.object({ type: z.enum(["sonarr", "radarr", "plex", "seerr"]), url, apiKey: z.string().trim().min(1) });

export const configUpdate = z
	.object({
		enabled: z.boolean(),
		intervalEvery: z.number().int().min(1).max(365),
		intervalUnit: z.enum(["days", "weeks", "months"]),
		runTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
		dryRun: z.boolean(),
		maxRemovalsPerRun: z.number().int().min(1).max(10_000),
		queueDelayDays: z.number().int().min(0).max(365),
		auditRetentionDays: z.number().int().min(1).max(3650),
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
	action: z.enum(["delete", "unmonitor", "delete_files", "delete_season"]).default("delete"),
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
});
export const ruleCreate = ruleBase;
export const ruleUpdate = ruleBase.partial();
export const ruleReorder = z.object({ ids: z.array(z.string()).min(1) });

export const runRequest = z.object({ dryRun: z.boolean().optional(), immediate: z.boolean().optional(), only: z.object({ instanceId: z.string(), arrItemId: z.number().int(), seasonNumber: z.number().int().nullish() }).optional() }).default({});
export const explainRequest = z.object({ instanceId: z.string(), arrItemId: z.number().int(), seasonNumber: z.number().int().nullish() });

export const protectedCreate = z.object({
	instanceId: z.string(),
	arrItemId: z.number().int(),
	itemType: z.enum(["movie", "series", "season"]),
	seasonNumber: z.number().int().nullish(),
	title: z.string().trim().min(1).max(300),
	note: z.string().trim().max(500).optional(),
	ignoreRetention: z.boolean().optional(),
});

export const libraryQuery = z.object({
	expression: z.unknown().optional().superRefine((v, ctx) => {
		if (v == null) return;
		try {
			parseExpression(v);
		} catch (e) {
			for (const m of e instanceof ExpressionError ? e.issues : [(e as Error).message]) ctx.addIssue({ code: "custom", message: m });
		}
	}),
	serviceFilter: z.array(z.enum(["sonarr", "radarr"])).nullish(),
	instanceFilter: z.array(z.string()).nullish(),
	excludeTags: z.array(z.string().min(1)).nullish(),
	excludeTitles: patterns.nullish(),
});
export const libraryRemove = z.object({
	action: z.enum(["delete", "delete_files", "unmonitor"]),
	items: z.array(z.object({ instanceId: z.string(), arrItemId: z.number().int() })).min(1).max(500),
});
