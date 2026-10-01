import type { CleanupAction, RuleMode } from "../types.js";
import { parseExpression, requirements } from "./expression.js";

/** Starting points for common cleanup scenarios. Picking one pre-fills the rule editor; nothing is saved until the user does. */
export interface RuleTemplate {
	id: string;
	title: string;
	description: string;
	mode: RuleMode;
	action: CleanupAction;
	expression: unknown;
	serviceFilter?: Array<"sonarr" | "radarr">;
}

export const RULE_TEMPLATES: RuleTemplate[] = [
	{
		id: "stale",
		title: "Not watched in a year",
		description: "Titles nobody has played in 12 months. Never-watched titles only qualify once they've been in the library that long.",
		mode: "cleanup",
		action: "delete",
		expression: { op: "and", of: [{ type: "last_watched", params: { operator: "not_watched_in_days", days: 365 } }, { type: "age", params: { operator: "older_than", days: 365 } }] },
	},
	{
		id: "never-watched",
		title: "Never watched after 6 months",
		description: "Downloaded, sat in the library for half a year, and never played once.",
		mode: "cleanup",
		action: "delete",
		expression: { op: "and", of: [{ type: "watch_count", params: { operator: "equals", count: 0 } }, { type: "age", params: { operator: "older_than", days: 180 } }] },
	},
	{
		id: "requester-done",
		title: "Requester has watched it",
		description: "The person who asked for it in Seerr has watched it, and it's been in the library for 60 days.",
		mode: "cleanup",
		action: "delete",
		expression: { op: "and", of: [{ type: "seerr_requester_watched", params: { operator: "requester_watched" } }, { type: "age", params: { operator: "older_than", days: 60 } }] },
	},
	{
		id: "low-rated",
		title: "Low rated and unwatched",
		description: "Rated below 5/10, never played, and added more than 3 months ago.",
		mode: "cleanup",
		action: "delete",
		expression: { op: "and", of: [{ type: "rating", params: { operator: "less_than", score: 5 } }, { type: "watch_count", params: { operator: "equals", count: 0 } }, { type: "age", params: { operator: "older_than", days: 90 } }] },
	},
	{
		id: "ended-abandoned",
		title: "Ended series nobody watches",
		description: "Finished shows with no plays in the last year. Usually the biggest single source of reclaimable space.",
		mode: "cleanup",
		action: "delete",
		serviceFilter: ["sonarr"],
		expression: { op: "and", of: [{ type: "status", params: { statuses: ["ended"] } }, { type: "last_watched", params: { operator: "not_watched_in_days", days: 365 } }] },
	},
	{
		id: "big-unwatched",
		title: "Large files nobody plays",
		description: "Anything over 40 GB that hasn't been watched in 6 months, usually remuxes and 4K copies. Deletes the files but keeps the entry.",
		mode: "cleanup",
		action: "delete_files",
		expression: { op: "and", of: [{ type: "size", params: { operator: "greater_than", sizeGb: 40 } }, { type: "last_watched", params: { operator: "not_watched_in_days", days: 180 } }] },
	},
	{
		id: "unmonitor-ended",
		title: "Stop searching for ended series",
		description: "Unmonitor finished shows so Sonarr stops looking for upgrades. Frees no space and keeps the files.",
		mode: "cleanup",
		action: "unmonitor",
		serviceFilter: ["sonarr"],
		expression: { op: "and", of: [{ type: "status", params: { statuses: ["ended"] } }, { type: "monitored", params: {} }] },
	},
	{
		id: "protect-recent",
		title: "Protect anything watched recently",
		description: "Never touch titles someone played in the last 30 days, whatever other rules say.",
		mode: "retention",
		action: "delete",
		expression: { type: "last_watched", params: { operator: "watched_within_days", days: 30 } },
	},
	{
		id: "protect-requests",
		title: "Protect fresh requests",
		description: "Keep anything requested in Seerr during the last 90 days, watched or not.",
		mode: "retention",
		action: "delete",
		expression: { type: "seerr_request_age", params: { operator: "newer_than", days: 90 } },
	},
	{
		id: "protect-kids",
		title: "Protect films for kids",
		description: "Never touch films with a children's rating: G, PG, U, FSK 6 and the equivalents in whichever country Radarr uses. Films with no rating count as unknown, so they're protected too until they have one.",
		mode: "retention",
		action: "delete",
		serviceFilter: ["radarr"],
		expression: { type: "certification", params: { operator: "suitable_for_kids" } },
	},
	{
		id: "protect-kids-shows",
		title: "Protect shows for kids",
		description: "Never touch series with a children's rating: TV-Y, TV-Y7, TV-G or the local equivalent. Shows with no rating count as unknown, so they're protected too until they have one.",
		mode: "retention",
		action: "delete",
		serviceFilter: ["sonarr"],
		expression: { type: "certification", params: { operator: "suitable_for_kids" } },
	},
	{
		id: "protect-keep-tag",
		title: "Protect the “keep” tag",
		description: "Anything tagged keep in Sonarr or Radarr is off limits. Tag favourites there to protect them.",
		mode: "retention",
		action: "delete",
		expression: { type: "tag_match", params: { operator: "includes_any", tags: ["keep"] } },
	},
];

/** Templates plus what each one needs connected, so the UI can say "Needs Plex" before the user picks it. */
export function describeTemplates() {
	return RULE_TEMPLATES.map((t) => ({ ...t, needs: requirements(parseExpression(t.expression)) }));
}
