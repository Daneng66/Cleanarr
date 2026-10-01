import Database from "better-sqlite3";

export type Db = Database.Database;

const MIGRATIONS: string[] = [
	`
CREATE TABLE instances (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	type TEXT NOT NULL CHECK (type IN ('sonarr','radarr','tautulli')),
	url TEXT NOT NULL,
	api_key_enc TEXT NOT NULL,
	enabled INTEGER NOT NULL DEFAULT 1,
	created_at TEXT NOT NULL
);

CREATE TABLE config (
	id INTEGER PRIMARY KEY CHECK (id = 1),
	enabled INTEGER NOT NULL DEFAULT 0,
	interval_hours INTEGER NOT NULL DEFAULT 24,
	dry_run INTEGER NOT NULL DEFAULT 1,
	max_removals_per_run INTEGER NOT NULL DEFAULT 50,
	require_approval INTEGER NOT NULL DEFAULT 1,
	approval_expiry_days INTEGER NOT NULL DEFAULT 7,
	rejection_memory_days INTEGER DEFAULT 0,
	last_run_at TEXT,
	next_run_at TEXT,
	run_claim_token TEXT,
	run_claimed_at TEXT
);
INSERT INTO config (id) VALUES (1);

CREATE TABLE rules (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	enabled INTEGER NOT NULL DEFAULT 1,
	priority INTEGER NOT NULL DEFAULT 0,
	mode TEXT NOT NULL DEFAULT 'cleanup' CHECK (mode IN ('cleanup','retention')),
	action TEXT NOT NULL DEFAULT 'delete' CHECK (action IN ('delete','unmonitor','delete_files')),
	expression TEXT NOT NULL,
	service_filter TEXT,
	instance_filter TEXT,
	exclude_tags TEXT,
	exclude_titles TEXT,
	use_global_rejection_memory INTEGER NOT NULL DEFAULT 1,
	rejection_memory_days INTEGER DEFAULT 0,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

CREATE TABLE approvals (
	id TEXT PRIMARY KEY,
	instance_id TEXT NOT NULL,
	arr_item_id INTEGER NOT NULL,
	item_type TEXT NOT NULL CHECK (item_type IN ('movie','series')),
	title TEXT NOT NULL,
	year INTEGER,
	size_on_disk INTEGER NOT NULL DEFAULT 0,
	rule_id TEXT NOT NULL,
	rule_name TEXT NOT NULL,
	reason TEXT NOT NULL,
	action TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'pending'
		CHECK (status IN ('pending','approved','retry_pending','rejected','executing','retry_executing','executed','expired','blocked')),
	execution_token TEXT,
	attempt_count INTEGER NOT NULL DEFAULT 0,
	safety_snapshot TEXT NOT NULL,
	last_error TEXT,
	reviewed_at TEXT,
	executed_at TEXT,
	expires_at TEXT NOT NULL,
	created_at TEXT NOT NULL
);
CREATE INDEX approvals_status ON approvals (status);
CREATE INDEX approvals_target ON approvals (instance_id, arr_item_id, item_type);

CREATE TABLE run_logs (
	id TEXT PRIMARY KEY,
	trigger TEXT NOT NULL,
	is_dry_run INTEGER NOT NULL,
	status TEXT NOT NULL CHECK (status IN ('running','completed','partial','error')),
	items_evaluated INTEGER NOT NULL DEFAULT 0,
	items_flagged INTEGER NOT NULL DEFAULT 0,
	items_removed INTEGER NOT NULL DEFAULT 0,
	items_unmonitored INTEGER NOT NULL DEFAULT 0,
	items_files_deleted INTEGER NOT NULL DEFAULT 0,
	items_skipped INTEGER NOT NULL DEFAULT 0,
	bytes_reclaimed INTEGER NOT NULL DEFAULT 0,
	details TEXT,
	warnings TEXT,
	error TEXT,
	duration_ms INTEGER NOT NULL DEFAULT 0,
	started_at TEXT NOT NULL,
	completed_at TEXT
);
CREATE INDEX run_logs_started ON run_logs (started_at);

-- Append-only, per-action history. Never rewritten and never folded back into run totals.
CREATE TABLE audit_events (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	correlation_id TEXT NOT NULL,
	event_type TEXT NOT NULL,
	outcome TEXT NOT NULL CHECK (outcome IN ('info','success','blocked','failed')),
	trigger TEXT NOT NULL,
	actor TEXT NOT NULL,
	run_log_id TEXT,
	approval_id TEXT,
	instance_id TEXT NOT NULL,
	arr_item_id INTEGER NOT NULL,
	item_type TEXT NOT NULL,
	title TEXT NOT NULL,
	rule_id TEXT,
	rule_name TEXT,
	action TEXT NOT NULL,
	reason TEXT NOT NULL,
	details TEXT,
	created_at TEXT NOT NULL
);
CREATE INDEX audit_correlation ON audit_events (correlation_id);
CREATE INDEX audit_created ON audit_events (created_at);

-- Tautulli rating_key -> external ids, so we don't re-resolve every key each run.
CREATE TABLE tautulli_guid_cache (
	instance_id TEXT NOT NULL,
	rating_key TEXT NOT NULL,
	guids TEXT NOT NULL,
	fetched_at TEXT NOT NULL,
	PRIMARY KEY (instance_id, rating_key)
);
`,
];

export function openDb(path: string): Db {
	const db = new Database(path);
	db.pragma("journal_mode = WAL");
	db.pragma("foreign_keys = ON");
	db.pragma("busy_timeout = 5000");
	migrate(db);
	return db;
}

export function migrate(db: Db): void {
	const current = db.pragma("user_version", { simple: true }) as number;
	for (let v = current; v < MIGRATIONS.length; v++) {
		db.transaction(() => {
			db.exec(MIGRATIONS[v] as string);
			db.pragma(`user_version = ${v + 1}`);
		})();
	}
}
