import Database from "better-sqlite3";

export type Db = Database.Database;

// Fresh databases get the final schema directly, stamped as version BASELINE. Installs already at
// BASELINE or later skip it; add future schema changes to MIGRATIONS (MIGRATIONS[0] is version BASELINE + 1).
const BASELINE = 10;

const BASELINE_SCHEMA = `
CREATE TABLE instances (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	type TEXT NOT NULL CHECK (type IN ('sonarr','radarr','plex','seerr')),
	url TEXT NOT NULL,
	api_key_enc TEXT NOT NULL,
	enabled INTEGER NOT NULL DEFAULT 1,
	created_at TEXT NOT NULL
);

CREATE TABLE config (
	id INTEGER PRIMARY KEY CHECK (id = 1),
	enabled INTEGER NOT NULL DEFAULT 0,
	dry_run INTEGER NOT NULL DEFAULT 1,
	max_removals_per_run INTEGER NOT NULL DEFAULT 50,
	queue_delay_days INTEGER NOT NULL DEFAULT 3,
	last_run_at TEXT,
	next_run_at TEXT,
	run_claim_token TEXT,
	run_claimed_at TEXT,
	interval_every INTEGER NOT NULL DEFAULT 1,
	interval_unit TEXT NOT NULL DEFAULT 'days' CHECK (interval_unit IN ('days','weeks','months')),
	run_time TEXT NOT NULL DEFAULT '03:00',
	audit_retention_days INTEGER NOT NULL DEFAULT 7
);
INSERT INTO config (id) VALUES (1);

CREATE TABLE rules (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	enabled INTEGER NOT NULL DEFAULT 1,
	priority INTEGER NOT NULL DEFAULT 0,
	mode TEXT NOT NULL DEFAULT 'cleanup' CHECK (mode IN ('cleanup','retention')),
	action TEXT NOT NULL DEFAULT 'delete' CHECK (action IN ('delete','unmonitor','delete_files','delete_season')),
	expression TEXT NOT NULL,
	service_filter TEXT,
	instance_filter TEXT,
	exclude_tags TEXT,
	exclude_titles TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

-- The delay queue: items auto-execute once execute_after has passed.
CREATE TABLE approvals (
	id TEXT PRIMARY KEY,
	instance_id TEXT NOT NULL,
	arr_item_id INTEGER NOT NULL,
	item_type TEXT NOT NULL CHECK (item_type IN ('movie','series','season')),
	title TEXT NOT NULL,
	year INTEGER,
	size_on_disk INTEGER NOT NULL DEFAULT 0,
	rule_id TEXT NOT NULL,
	rule_name TEXT NOT NULL,
	reason TEXT NOT NULL,
	action TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','failed','reclaimed')),
	execution_token TEXT,
	attempt_count INTEGER NOT NULL DEFAULT 0,
	safety_snapshot TEXT NOT NULL,
	last_error TEXT,
	reviewed_at TEXT,
	executed_at TEXT,
	execute_after TEXT NOT NULL,
	created_at TEXT NOT NULL,
	season_number INTEGER
);
CREATE INDEX approvals_status ON approvals (status);
CREATE INDEX approvals_target ON approvals (instance_id, arr_item_id, item_type);
CREATE INDEX approvals_execute_after ON approvals (execute_after);

-- Items excluded from cleanup regardless of any rule; ignore_retention = 1 is an override, not protection.
CREATE TABLE protected_items (
	id TEXT PRIMARY KEY,
	instance_id TEXT NOT NULL,
	arr_item_id INTEGER NOT NULL,
	item_type TEXT NOT NULL CHECK (item_type IN ('movie','series','season')),
	season_number INTEGER,
	title TEXT NOT NULL,
	note TEXT,
	created_at TEXT NOT NULL,
	ignore_retention INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX protected_items_target ON protected_items (instance_id, arr_item_id, item_type, season_number);

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
`;

const MIGRATIONS: string[] = ["ALTER TABLE config ADD COLUMN kids_max_age INTEGER NOT NULL DEFAULT 12"];

export function openDb(path: string): Db {
	const db = new Database(path);
	db.pragma("journal_mode = WAL");
	db.pragma("foreign_keys = ON");
	db.pragma("busy_timeout = 5000");
	migrate(db);
	return db;
}

export function migrate(db: Db): void {
	const apply = (sql: string, version: number) =>
		db.transaction(() => {
			db.exec(sql);
			db.pragma(`user_version = ${version}`);
		})();
	let v = db.pragma("user_version", { simple: true }) as number;
	if (v === 0) apply(BASELINE_SCHEMA, (v = BASELINE));
	for (; v < BASELINE + MIGRATIONS.length; v++) apply(MIGRATIONS[v - BASELINE] as string, v + 1);
	db.exec("INSERT OR IGNORE INTO config (id) VALUES (1)"); // config.get() assumes the default row exists
}
