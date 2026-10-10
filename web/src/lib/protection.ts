import type { ItemRef, RunDetail } from "../types";

/** A cleanup match is held back for exactly one of two reasons; the mark vocabulary already has a face for each. */
export type SkipCategory = "protected" | "skipped";
export const SKIP_ORDER: SkipCategory[] = ["protected", "skipped"];
export function skipCategory(d: { message?: string }): [SkipCategory, string] {
	const m = d.message || "";
	if (m.startsWith("Protected by retention rule") || m.startsWith("Retention rule") || m === "Manually protected") return ["protected", "Protected"];
	return ["skipped", "Skipped"];
}
export const isRuleProtected = (d: RunDetail) => skipCategory(d)[0] === "protected";

export const itemKey = (d: ItemRef) => `${d.instanceId}:${d.arrItemId}:${d.itemType}:${d.seasonNumber ?? ""}`;
export const protectBody = (d: ItemRef, extra: Record<string, unknown> = {}) => ({
	instanceId: d.instanceId, arrItemId: d.arrItemId, itemType: d.itemType, seasonNumber: d.seasonNumber ?? null, title: d.title, ...extra,
});

/** Splits `Protected by retention rule "X": cond` into its rule name and condition. */
export function parseKeptBy(m: string): { rule: string; condition?: string } | null {
	const x = /^(?:Protected by )?retention rule "(.+?)"(?::\s*(.*))?$/i.exec(m);
	return x ? { rule: x[1]!, condition: x[2] || undefined } : null;
}

/** Evaluation reasons for AND/OR rules arrive wrapped in one pair of brackets; drop it for reading. */
export function plainReason(r: string): string {
	if (!r.startsWith("(") || !r.endsWith(")")) return r;
	let depth = 0;
	for (let i = 0; i < r.length - 1; i++) {
		depth += r[i] === "(" ? 1 : r[i] === ")" ? -1 : 0;
		if (depth === 0) return r;
	}
	return r.slice(1, -1);
}
