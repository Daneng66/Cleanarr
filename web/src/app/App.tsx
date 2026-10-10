import { useCallback, useEffect, useState } from "react";
import { useHashRoute } from "../hooks/useHashRoute";
import { ApiProvider } from "../providers/ApiProvider";
import { CatalogProvider } from "../providers/CatalogProvider";
import { DialogHost, DialogProvider } from "../providers/DialogProvider";
import { ShellProvider } from "../providers/ShellProvider";
import { ToastProvider } from "../providers/ToastProvider";
import { Header } from "./Header";
import { ROUTE_DEFS } from "./routes";

/** Composition root: services are wired here once; everything below receives them through context. */
export function App() {
	return (
		<ToastProvider>
			<DialogProvider>
				<ApiProvider>
					<CatalogProvider>
						<Routed />
					</CatalogProvider>
				</ApiProvider>
			</DialogProvider>
		</ToastProvider>
	);
}

function Routed() {
	const route = useHashRoute();
	const [reloadKey, setReloadKey] = useState(0);
	const reload = useCallback(() => setReloadKey((k) => k + 1), []);
	const { title, Page } = ROUTE_DEFS[route];
	useEffect(() => { document.title = `${title} · Cleanarr`; }, [title]);
	return (
		<ShellProvider route={route} onReload={reload}>
			<Header reloadKey={reloadKey} />
			<main id="view"><Page key={`${route}:${reloadKey}`} /></main>
			<DialogHost />
		</ShellProvider>
	);
}
