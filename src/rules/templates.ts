import type { CleanupAction, RuleMode } from "../types.js";
import { parseExpression, requirements } from "./expression.js";

/** The rule library: the main way to add rules. Each is a starting point for a common scenario. Picking one pre-fills the rule editor; nothing is saved until the user does. */
export type TemplateGroup = "Protect" | "Clean up";

export interface RuleTemplate {
	id: string;
	group: TemplateGroup;
	title: string;
	description: string;
	mode: RuleMode;
	action: CleanupAction;
	expression: unknown;
	serviceFilter?: Array<"sonarr" | "radarr">;
}

type Expr = Record<string, unknown>;
const c = (type: string, params: Record<string, unknown> = {}): Expr => ({ type, params });

export const RULE_TEMPLATES: RuleTemplate[] = [
	// ── Clean up ───────────────────────────────────────────────────────────
	{ id: "cleanup-unwatched-60", group: "Clean up", title: "Added and not watched for 60 days", description: "Removes anything that was added more than 60 days ago and has never been watched.", mode: "cleanup", action: "delete", expression: { op: "and", of: [c("age", { operator: "older_than", days: 60 }), c("watch_count", { operator: "equals", count: 0 })] } },
	{ id: "cleanup-unwatched-365", group: "Clean up", title: "Last watched more than 365 days ago", description: "Removes anything whose last play was more than 365 days ago. Never-watched titles only count once they've been in the library that long.", mode: "cleanup", action: "delete", expression: c("last_watched", { operator: "not_watched_in_days", days: 365 }) },
	{ id: "cleanup-requester-watched-365", group: "Clean up", title: "Requester watched it, no one since (365 days)", description: "Removes films the person who requested them has watched, once nobody has played them for 365 days.", mode: "cleanup", action: "delete", serviceFilter: ["radarr"], expression: { op: "and", of: [c("seerr_requester_watched", { operator: "requester_watched" }), c("last_watched", { operator: "not_watched_in_days", days: 365 })] } },
	{ id: "cleanup-season-requester-watched-365", group: "Clean up", title: "Requester watched the season, no views since (365 days)", description: "Removes a season's episodes once the person who requested it has watched every episode and nobody has played it for 365 days, unless anyone else has watched any episode.", mode: "cleanup", action: "delete_season", serviceFilter: ["sonarr"], expression: { op: "and", of: [c("season_requester_watched"), { op: "not", of: c("watched_by_others") }, c("last_watched", { operator: "not_watched_in_days", days: 365 })] } },

	{ id: "cleanup-ended-unmonitored", group: "Clean up", title: "Ended series with no monitored seasons", description: "Removes series that have ended and have no monitored seasons, so nothing more will be downloaded.", mode: "cleanup", action: "delete", serviceFilter: ["sonarr"], expression: { op: "and", of: [c("status", { statuses: ["ended"] }), c("no_monitored_seasons")] } },

	// ── Protect ────────────────────────────────────────────────────────────
	{ id: "protect-kids", group: "Protect", title: "Protect kids content", description: "Keeps films and shows rated suitable for kids, up to the age set under Settings, with ratings from any country matched by minimum age. Unrated titles aren't protected.", mode: "retention", action: "delete", expression: c("certification", { operator: "suitable_for_kids" }) },
	{ id: "protect-recent", group: "Protect", title: "Protect anything watched recently", description: "Keeps anything played in the last 30 days, whatever other rules say.", mode: "retention", action: "delete", expression: c("last_watched", { operator: "watched_within_days", days: 30 }) },
	{ id: "protect-new", group: "Protect", title: "Protect new additions", description: "Keeps anything added to the library in the last 60 days, so new arrivals get time to be watched.", mode: "retention", action: "delete", expression: c("age", { operator: "newer_than", days: 60 }) },
	{ id: "protect-requests", group: "Protect", title: "Protect fresh requests", description: "Keeps anything requested in Seerr in the last 90 days, watched or not.", mode: "retention", action: "delete", expression: c("seerr_request_age", { operator: "newer_than", days: 90 }) },
	{ id: "protect-keep-tag", group: "Protect", title: "Protect the “keep” tag", description: "Keeps anything tagged “keep” in Sonarr or Radarr. Tag your favourites there to protect them.", mode: "retention", action: "delete", expression: c("tag_match", { operator: "includes_any", tags: ["keep"] }) },
	{ id: "protect-airing", group: "Protect", title: "Protect shows still airing", description: "Keeps series that are still airing, since new episodes and seasons may be coming.", mode: "retention", action: "delete", serviceFilter: ["sonarr"], expression: c("status", { statuses: ["continuing"] }) },
];

/** Templates plus what each one needs connected, so the UI can say "Needs Plex" before the user picks it. */
export function describeTemplates() {
	return RULE_TEMPLATES.map((t) => ({ ...t, needs: requirements(parseExpression(t.expression)) }));
}
