import { createContext, useContext, useMemo, useRef, type ReactNode } from "react";
import { useApi } from "./ApiProvider";
import type { RuleTypeDef } from "../types";

/** Reference data the rule builder needs. Rule types never change while running, so they load once. */
export interface Catalog {
	types(): Promise<RuleTypeDef[]>;
	/** Seerr users; empty when Seerr isn't connected (fields fall back to free text). */
	requesters(): Promise<string[]>;
}
const Ctx = createContext<Catalog | null>(null);

export function CatalogProvider({ children }: { children: ReactNode }) {
	const api = useApi();
	const types = useRef<Promise<RuleTypeDef[]> | null>(null);
	const catalog = useMemo<Catalog>(() => ({
		types: () => {
			const p = (types.current ??= api.get<RuleTypeDef[]>("/rule-types"));
			p.catch(() => { if (types.current === p) types.current = null; });
			return p;
		},
		requesters: () => api.get<string[]>("/requesters").catch(() => []),
	}), [api]);
	return <Ctx.Provider value={catalog}>{children}</Ctx.Provider>;
}
export function useCatalog(): Catalog {
	const v = useContext(Ctx);
	if (!v) throw new Error("CatalogProvider missing");
	return v;
}
