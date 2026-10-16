// Shapes of the JSON the Cleanarr API returns. The server owns the contract; these are the fields the UI reads.
export type Service = "sonarr" | "radarr";
export type InstanceType = Service | "plex" | "seerr";
export type CleanupAction = "delete" | "unmonitor" | "delete_files" | "delete_season";
export type RuleActions = Record<"radarr" | "sonarr_continuing" | "sonarr_ended", CleanupAction | null>;
export type RuleMode = "cleanup" | "retention";
export type Outcome = "flagged" | "pending" | "removed" | "unmonitored" | "files_deleted" | "skipped" | "blocked" | "failed";

/** Identifies one library title (or one season of a series) in a specific instance. */
export interface ItemRef {
	instanceId: string;
	arrItemId: number;
	itemType: string;
	seasonNumber?: number | null;
	title: string;
}

export interface Instance {
	id: string;
	name: string;
	type: InstanceType;
	url: string;
	enabled: boolean;
}

export interface QueueInfo {
	id: string;
	status: string;
	executeAfter: string;
	lastError?: string | null;
}

export interface MatchedReason {
	type: string;
	text: string;
}

export interface RunDetail extends ItemRef {
	onlySeason?: number;
	year?: number | null;
	ruleId: string;
	ruleName: string;
	action: CleanupAction;
	reason: string;
	reasons?: MatchedReason[];
	sizeOnDisk: number;
	poster?: string | null;
	certification?: string | null;
	outcome: Outcome;
	message?: string;
}

export interface Candidate extends RunDetail {
	queue?: QueueInfo | null;
}

export interface MissingRow extends ItemRef {
	year: number | null;
	poster: string | null;
	monitored: boolean;
	added: string | null;
	certification: string | null;
}

export interface LibrarySummary {
	totalBytes: number;
	capacityBytes?: number | null;
	movies: number;
	series: number;
	files: number;
	movieBytes: number;
	seriesBytes: number;
	missing: number;
}

export interface Preview {
	evaluated: number;
	warnings: string[];
	candidates: Candidate[];
	skipped: RunDetail[];
	totalBytes: number;
	library: LibrarySummary;
	missing: MissingRow[];
}

export interface Config {
	enabled: boolean;
	intervalEvery: number;
	intervalUnit: "days" | "weeks" | "months";
	runTime: string;
	dryRun: boolean;
	maxRemovalsPerRun: number;
	queueDelayDays: number;
	auditRetentionDays: number;
	kidsMaxAge: number;
	lastRunAt: string | null;
	nextRunAt: string | null;
}

export interface RunLog {
	id: string;
	startedAt: string;
	trigger: string;
	isDryRun: boolean;
	status: string;
	itemsEvaluated: number;
	itemsFlagged: number;
	itemsRemoved: number;
	itemsSkipped: number;
	bytesReclaimed: number;
	warnings: string[];
	error?: string | null;
	details: RunDetail[];
}

export interface Status {
	config: Config;
	approvals: { pending?: number; failed?: number };
	lastRun: RunLog | null;
}

export interface AuditEntry {
	created_at: string;
	event_type: string;
	outcome: string;
	title: string;
	rule_name?: string | null;
	action: string;
	actor: string;
	trigger: string;
	reason: string;
}

// ── Rules ──
export type Expr = Leaf | { op: "not"; of: Expr } | { op: "and" | "or"; of: Expr[] };
export interface Leaf {
	type: string;
	params: Record<string, unknown>;
}

export interface RuleRecord {
	id: string;
	name: string;
	enabled: boolean;
	mode: RuleMode;
	action: CleanupAction;
	actions?: RuleActions;
	expression: Expr;
	serviceFilter: Service[] | null;
	excludeTags: string[] | null;
	excludeTitles: string[] | null;
	serviceLocked?: boolean;
}

export interface FieldDef {
	name: string;
	label: string;
	kind: "number" | "select" | "list" | "text";
	options?: string[];
	placeholder?: string;
	source?: string;
	hideFor?: string[];
}

export interface RuleTypeDef {
	type: string;
	label: string;
	group: string;
	description: string;
	fields: FieldDef[];
}

export interface RuleTemplate {
	id?: string;
	title: string;
	description: string;
	group: string;
	mode: RuleMode;
	action: CleanupAction;
	expression: Expr;
	serviceFilter?: Service[] | null;
	needs: { watch?: boolean; seerr?: boolean };
}

// ── Protection ──
export interface ProtectedRow extends ItemRef {
	id: string;
	ignoreRetention?: boolean;
}

// ── Library browser ──
export interface LibraryRow extends ItemRef {
	service: Service;
	year: number | null;
	poster: string | null;
	sizeOnDisk: number;
	monitored: boolean;
	hasFile: boolean;
	status: string | null;
	added: string | null;
	certification: string | null;
	genres: string[];
	tags: string[];
	qualityProfile: string | null;
	rating: number | null;
	path: string | null;
	fileCount: number;
	lastWatchedAt: string | null;
	protectedId: string | null;
}

export interface RemoveResult {
	instanceId: string;
	arrItemId: number;
	status: "done" | "blocked" | "failed" | "gone";
	message?: string;
}

// ── Explain ──
export interface ExplainNode {
	state: string;
	type?: string;
	reason?: string;
	op?: string;
	children?: ExplainNode[];
}
export interface ExplainRule {
	name: string;
	mode: RuleMode;
	action: CleanupAction;
	inScope: boolean;
	state: string;
	excludedBy?: string;
	tree?: ExplainNode;
}
export interface Explain {
	item: { seasonNumber?: number | null; kind: string; sizeOnDisk: number; monitored: boolean; path?: string | null };
	warnings: string[];
	rules: ExplainRule[];
}

export interface SeasonEpisodes {
	number: number;
	size: number;
	episodes: unknown[];
}
