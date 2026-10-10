import { useEffect, useState } from "react";
import { ROUTES, type Route } from "../hooks/useHashRoute";
import { useApi } from "../providers/ApiProvider";
import { useShell } from "../providers/ShellProvider";
import type { Status } from "../types";
import { ROUTE_DEFS, SUB_PAGES } from "./routes";

function Brand() {
	return (
		<a className="brand" href="#/dashboard" aria-label="Cleanarr home">
			<svg viewBox="0 0 30 22" aria-hidden="true">
				<rect x="1" y="1" width="28" height="20" rx="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
				<rect x="5" y="6" width="13" height="10" rx="1" fill="currentColor" />
				<path d="M7.5 8v6M9.5 8v6M12 8v6M14 8v6M15.5 8v6" stroke="#1d2225" strokeWidth="1" />
				<circle cx="23.5" cy="11" r="2.2" fill="#e4a11b" />
			</svg>
			Cleanarr
		</a>
	);
}

function Nav() {
	const { route, waiting } = useShell();
	return (
		<nav id="nav" aria-label="Main">
			{ROUTES.filter((r) => ROUTE_DEFS[r].nav).map((r: Route) => (
				<a key={r} href={`#/${r}`} className={r === route || (r === "dashboard" && SUB_PAGES.includes(route)) ? "active" : ""} aria-current={r === route ? "page" : undefined}>
					{ROUTE_DEFS[r].title}
					{r === "dashboard" && waiting ? <span className="count" aria-label={`${waiting} on the dashboard`}>{waiting}</span> : null}
				</a>
			))}
		</nav>
	);
}

/** Dry-run / live indicator; re-reads whenever the page changes or settings are saved. */
function ModeBadge({ reloadKey }: { reloadKey: number }) {
	const api = useApi();
	const { route, modeVersion } = useShell();
	const [mode, setMode] = useState<{ cls: string; text: string } | null>(null);
	useEffect(() => {
		let live = true;
		api.get<Status>("/status").then((s) => {
			if (live) setMode(s.config.dryRun ? { cls: "dry", text: "Dry run" } : { cls: "live", text: `Live · ${s.config.queueDelayDays}d queue` });
		}, () => {});
		return () => { live = false; };
	}, [api, route, reloadKey, modeVersion]);
	return (
		<a id="mode" className={`mode ${mode?.cls ?? ""}`.trim()} href="#/settings" title="Run mode (change in Settings)">
			<span className="led" /><span className="txt">{mode?.text ?? "…"}</span>
		</a>
	);
}

export function Header({ reloadKey }: { reloadKey: number }) {
	return (
		<header className="rack-top">
			<div className="inner"><Brand /><Nav /><ModeBadge reloadKey={reloadKey} /></div>
		</header>
	);
}
