import type { ComponentType } from "react";
import type { Route } from "../hooks/useHashRoute";
import { Dashboard } from "../features/dashboard/Dashboard";
import { HistoryPage } from "../features/history/HistoryPage";
import { InstancesPage } from "../features/instances/InstancesPage";
import { LibraryPage } from "../features/library/LibraryPage";
import { MissingPage } from "../features/missing/MissingPage";
import { ProtectedPage } from "../features/protected/ProtectedPage";
import { RulesPage } from "../features/rules/RulesPage";
import { SettingsPage } from "../features/settings/SettingsPage";

export interface RouteDef {
	title: string;
	Page: ComponentType;
	/** Shown in the main nav. Sub-pages are reached from the dashboard instead. */
	nav: boolean;
}

/** The one place a page is registered. The shell and nav read from this table. */
export const ROUTE_DEFS: Record<Route, RouteDef> = {
	dashboard: { title: "Dashboard", Page: Dashboard, nav: true },
	library: { title: "Library", Page: LibraryPage, nav: true },
	rules: { title: "Rules", Page: RulesPage, nav: true },
	history: { title: "History", Page: HistoryPage, nav: true },
	instances: { title: "Instances", Page: InstancesPage, nav: true },
	settings: { title: "Settings", Page: SettingsPage, nav: true },
	missing: { title: "Missing files", Page: MissingPage, nav: false },
	protected: { title: "Protected", Page: ProtectedPage, nav: false },
};
export const SUB_PAGES: Route[] = (Object.keys(ROUTE_DEFS) as Route[]).filter((r) => !ROUTE_DEFS[r].nav);
