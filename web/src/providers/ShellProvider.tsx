import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { goto, type Route } from "../hooks/useHashRoute";

export interface Shell {
	route: Route;
	/** Titles the last preview flagged; drives the nav badge. */
	waiting: number;
	setWaiting(n: number): void;
	/** Re-runs the current page's loading from scratch. */
	reload(): void;
	/** Go to a page, or reload it if it's already showing. */
	navigate(route: Route): void;
	/** Re-reads the run mode shown in the header. */
	refreshMode(): void;
	modeVersion: number;
}
const Ctx = createContext<Shell | null>(null);

export function ShellProvider({ route, onReload, children }: { route: Route; onReload: () => void; children: ReactNode }) {
	const [waiting, setWaiting] = useState(0);
	const [modeVersion, setModeVersion] = useState(0);
	const refreshMode = useCallback(() => setModeVersion((v) => v + 1), []);
	const value = useMemo<Shell>(() => ({
		route, waiting, setWaiting, reload: onReload, refreshMode, modeVersion,
		navigate: (r) => (r === route ? onReload() : goto(r)),
	}), [route, waiting, onReload, refreshMode, modeVersion]);
	return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useShell(): Shell {
	const v = useContext(Ctx);
	if (!v) throw new Error("ShellProvider missing");
	return v;
}
