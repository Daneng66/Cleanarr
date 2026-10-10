import { useEffect, useState } from "react";

export const ROUTES = ["dashboard", "library", "rules", "history", "instances", "settings", "missing", "protected"] as const;
export type Route = (typeof ROUTES)[number];

function read(): Route {
	const r = location.hash.slice(2).split(/[/?]/)[0] as Route;
	return ROUTES.includes(r) ? r : "dashboard";
}
export function useHashRoute(): Route {
	const [route, setRoute] = useState<Route>(read);
	useEffect(() => {
		const on = () => setRoute(read());
		window.addEventListener("hashchange", on);
		return () => window.removeEventListener("hashchange", on);
	}, []);
	return route;
}
export const goto = (route: Route) => { location.hash = `#/${route}`; };
