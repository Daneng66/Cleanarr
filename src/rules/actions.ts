import type { CleanupAction, RuleActions, Service } from "../types.js";

export const SLOTS = ["radarr", "sonarr_continuing", "sonarr_ended"] as const;
export type Slot = (typeof SLOTS)[number];

/** Which slot an item falls in: movies, or series split by Sonarr status. Season items follow their series. */
export const slotOf = (i: { service: Service; status: string | null }): Slot =>
	i.service === "radarr" ? "radarr" : i.status?.toLowerCase() === "ended" ? "sonarr_ended" : "sonarr_continuing";

/** Legacy single action + service filter (+ per-slot overrides) as slots. A null slot is "leave alone". */
export function toActions(action: CleanupAction, serviceFilter: Service[] | null, overrides?: Partial<RuleActions> | null): RuleActions {
	const on = (s: Service) => !serviceFilter?.length || serviceFilter.includes(s);
	const pick = (slot: Slot, s: Service): CleanupAction | null => {
		if (!on(s)) return null;
		const a = overrides?.[slot] ?? action;
		return s === "radarr" && a === "delete_season" ? null : a;
	};
	return { radarr: pick("radarr", "radarr"), sonarr_continuing: pick("sonarr_continuing", "sonarr"), sonarr_ended: pick("sonarr_ended", "sonarr") };
}

export const firstAction = (a: RuleActions): CleanupAction | null => SLOTS.map((s) => a[s]).find((v) => v) ?? null;

/** Services with any action; null when both (no service restriction). */
export function servicesOf(a: RuleActions): Service[] | null {
	const out: Service[] = [];
	if (a.radarr) out.push("radarr");
	if (a.sonarr_continuing || a.sonarr_ended) out.push("sonarr");
	return out.length === 2 ? null : out;
}
