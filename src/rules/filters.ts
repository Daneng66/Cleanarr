import type { LibraryItem, RuleRecord } from "../types.js";
import { safeRegex } from "./regex.js";

/** Scope filters applied before the rule condition. Unsafe exclusion patterns fail closed (item excluded). */
export function passesFilters(item: LibraryItem, rule: RuleRecord): { ok: true } | { ok: false; why: string } {
	if (rule.serviceFilter?.length && !rule.serviceFilter.includes(item.service)) return { ok: false, why: "service filter" };
	if (rule.instanceFilter?.length && !rule.instanceFilter.includes(item.instanceId)) return { ok: false, why: "instance filter" };
	if (rule.excludeTags?.length) {
		const excluded = new Set(rule.excludeTags.map((t) => t.toLowerCase()));
		const hit = item.tags.find((t) => excluded.has(t.toLowerCase()));
		if (hit) return { ok: false, why: `excluded tag "${hit}"` };
	}
	for (const pattern of rule.excludeTitles ?? []) {
		const re = safeRegex(pattern);
		if (!re) return { ok: false, why: `unsafe exclude pattern "${pattern}"` };
		if (re.test(item.title)) return { ok: false, why: `excluded title pattern "${pattern}"` };
	}
	return { ok: true };
}
