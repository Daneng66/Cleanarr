import { useMemo, useRef } from "react";
import type { ToggleOps } from "../../components/media/ProtectButtons";
import { itemKey, protectBody } from "../../lib/protection";
import { useApi } from "../../providers/ApiProvider";
import type { ItemRef, ProtectedRow } from "../../types";

export interface ProtectionOps {
	/** Toggle for a title a retention rule (or a manual entry) already protects. */
	ruleToggle(d: ItemRef): ToggleOps;
	/** Toggle for a manual-only protection. */
	manualToggle(p: ProtectedRow): ToggleOps;
	/** Lift any rule override, and protect titles no rule covers. */
	protect(d: ItemRef): Promise<unknown>;
	/** Drop the manual protection and, where a retention rule still covers it, override that rule too. */
	unprotect(d: ItemRef): Promise<unknown>;
}

/**
 * Knows how manual protections and retention-rule overrides relate.
 * Manual protection is deleted/recreated; retention-rule protection is overridden/restored per item.
 * `covered` holds the keys of titles a retention rule protects.
 */
export function useProtectionOps(rows: ProtectedRow[], covered: ReadonlySet<string>): ProtectionOps {
	const api = useApi();
	const manual = useRef(new Map<string, string>());
	const override = useRef(new Map<string, string>());
	manual.current = useMemo(() => new Map(rows.filter((p) => !p.ignoreRetention).map((p) => [itemKey(p), p.id])), [rows]);
	override.current = useMemo(() => new Map(rows.filter((p) => p.ignoreRetention).map((p) => [itemKey(p), p.id])), [rows]);

	return useMemo<ProtectionOps>(() => {
		const post = async (d: ItemRef, extra: Record<string, unknown> = {}) => (await api.post<ProtectedRow>("/protected", protectBody(d, extra))).id;
		const del = (id: string) => api.delete(`/protected/${id}`);
		const m = () => manual.current, o = () => override.current;
		return {
			ruleToggle(d) {
				const k = itemKey(d);
				// Decided once, when the card appears.
				return m().has(k)
					? { off: async () => { await del(m().get(k)!); m().delete(k); }, on: async () => { m().set(k, await post(d)); } }
					: { off: async () => { o().set(k, await post(d, { ignoreRetention: true })); }, on: async () => { await del(o().get(k)!); o().delete(k); } };
			},
			manualToggle(p) {
				let id = p.id;
				return { off: () => del(id), on: async () => { id = await post(p, { ignoreRetention: p.ignoreRetention }); } };
			},
			async protect(d) {
				const k = itemKey(d);
				if (o().has(k)) { await del(o().get(k)!); o().delete(k); }
				if (!covered.has(k) && !m().has(k)) m().set(k, await post(d));
			},
			unprotect(d) {
				const k = itemKey(d);
				return Promise.all([m().has(k) ? del(m().get(k)!) : null, covered.has(k) && !o().has(k) ? post(d, { ignoreRetention: true }) : null]);
			},
		};
	}, [api, covered]);
}
