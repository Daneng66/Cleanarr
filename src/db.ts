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
	// 2: Plex + Seerr instance types; watch rules are provider-neutral (were tautulli_*).
	`
CREATE TABLE instances_new (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	type TEXT NOT NULL CHECK (type IN ('sonarr','radarr','plex','tautulli','seerr')),
	url TEXT NOT NULL,
	api_key_enc TEXT NOT NULL,
	enabled INTEGER NOT NULL DEFAULT 1,
	created_at TEXT NOT NULL
);
INSERT INTO instances_new SELECT * FROM instances;
DROP TABLE instances;
ALTER TABLE instances_new RENAME TO instances;

UPDATE rules SET expression = REPLACE(REPLACE(REPLACE(expression,
	'"tautulli_last_watched"', '"last_watched"'),
	'"tautulli_watch_count"', '"watch_count"'),
	'"tautulli_watched_by"', '"watched_by"');
`,
	// 3: Tautulli support removed; Plex is the only watch-history source.
	`
DELETE FROM instances WHERE type = 'tautulli';
CREATE TABLE instances_new (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	type TEXT NOT NULL CHECK (type IN ('sonarr','radarr','plex','seerr')),
	url TEXT NOT NULL,
	api_key_enc TEXT NOT NULL,
	enabled INTEGER NOT NULL DEFAULT 1,
	created_at TEXT NOT NULL
);
INSERT INTO instances_new SELECT * FROM instances;
DROP TABLE instances;
ALTER TABLE instances_new RENAME TO instances;
DROP TABLE tautulli_guid_cache;
`,
	// 4: Per-season cleanup: "delete_season" rules and season approvals.
	`
CREATE TABLE rules_new (
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
	use_global_rejection_memory INTEGER NOT NULL DEFAULT 1,
	rejection_memory_days INTEGER DEFAULT 0,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);
INSERT INTO rules_new SELECT * FROM rules;
DROP TABLE rules;
ALTER TABLE rules_new RENAME TO rules;

CREATE TABLE approvals_new (
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
	status TEXT NOT NULL DEFAULT 'pending'
		CHECK (status IN ('pending','approved','retry_pending','rejected','executing','retry_executing','executed','expired','blocked')),
	execution_token TEXT,
	attempt_count INTEGER NOT NULL DEFAULT 0,
	safety_snapshot TEXT NOT NULL,
	last_error TEXT,
	reviewed_at TEXT,
	executed_at TEXT,
	expires_at TEXT NOT NULL,
	created_at TEXT NOT NULL,
	season_number INTEGER
);
INSERT INTO approvals_new SELECT *, NULL FROM approvals;
DROP TABLE approvals;
ALTER TABLE approvals_new RENAME TO approvals;
CREATE INDEX approvals_status ON approvals (status);
CREATE INDEX approvals_target ON approvals (instance_id, arr_item_id, item_type);
`,
	// 5: Approvals replaced by a delay queue (no manual gate; items auto-execute once their wait elapses).
	// "expires_at" (a safety-net deadline) becomes "execute_after" (the earliest time it's allowed to run).
	// Manual protection: items excluded from cleanup regardless of any rule.
	`
CREATE TABLE config_new (
	id INTEGER PRIMARY KEY CHECK (id = 1),
	enabled INTEGER NOT NULL DEFAULT 0,
	interval_hours INTEGER NOT NULL DEFAULT 24,
	dry_run INTEGER NOT NULL DEFAULT 1,
	max_removals_per_run INTEGER NOT NULL DEFAULT 50,
	queue_delay_days INTEGER NOT NULL DEFAULT 3,
	rejection_memory_days INTEGER DEFAULT 0,
	last_run_at TEXT,
	next_run_at TEXT,
	run_claim_token TEXT,
	run_claimed_at TEXT
);
INSERT INTO config_new (id, enabled, interval_hours, dry_run, max_removals_per_run, queue_delay_days, rejection_memory_days, last_run_at, next_run_at, run_claim_token, run_claimed_at)
	SELECT id, enabled, interval_hours, dry_run, max_removals_per_run, approval_expiry_days, rejection_memory_days, last_run_at, next_run_at, run_claim_token, run_claimed_at FROM config;
DROP TABLE config;
ALTER TABLE config_new RENAME TO config;

CREATE TABLE approvals_new (
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
	status TEXT NOT NULL DEFAULT 'pending'
		CHECK (status IN ('pending','approved','retry_pending','rejected','executing','retry_executing','executed','expired','blocked')),
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
INSERT INTO approvals_new SELECT id,instance_id,arr_item_id,item_type,title,year,size_on_disk,rule_id,rule_name,reason,action,status,execution_token,attempt_count,safety_snapshot,last_error,reviewed_at,executed_at,expires_at,created_at,season_number FROM approvals;
DROP TABLE approvals;
ALTER TABLE approvals_new RENAME TO approvals;
CREATE INDEX approvals_status ON approvals (status);
CREATE INDEX approvals_target ON approvals (instance_id, arr_item_id, item_type);
CREATE INDEX approvals_execute_after ON approvals (execute_after);

CREATE TABLE protected_items (
	id TEXT PRIMARY KEY,
	instance_id TEXT NOT NULL,
	arr_item_id INTEGER NOT NULL,
	item_type TEXT NOT NULL CHECK (item_type IN ('movie','series','season')),
	season_number INTEGER,
	title TEXT NOT NULL,
	note TEXT,
	created_at TEXT NOT NULL
);
CREATE INDEX protected_items_target ON protected_items (instance_id, arr_item_id, item_type, season_number);
`,
	// 6: A protected_items row with ignore_retention = 1 is an override, not protection: retention rules no longer shield that item.
	`ALTER TABLE protected_items ADD COLUMN ignore_retention INTEGER NOT NULL DEFAULT 0;`,
	// 7: Rejection memory removed; protecting an item is the only durable way to keep it out of cleanup.
	`
CREATE TABLE config_new (
	id INTEGER PRIMARY KEY CHECK (id = 1),
	enabled INTEGER NOT NULL DEFAULT 0,
	interval_hours INTEGER NOT NULL DEFAULT 24,
	dry_run INTEGER NOT NULL DEFAULT 1,
	max_removals_per_run INTEGER NOT NULL DEFAULT 50,
	queue_delay_days INTEGER NOT NULL DEFAULT 3,
	last_run_at TEXT,
	next_run_at TEXT,
	run_claim_token TEXT,
	run_claimed_at TEXT
);
INSERT INTO config_new (id, enabled, interval_hours, dry_run, max_removals_per_run, queue_delay_days, last_run_at, next_run_at, run_claim_token, run_claimed_at)
	SELECT id, enabled, interval_hours, dry_run, max_removals_per_run, queue_delay_days, last_run_at, next_run_at, run_claim_token, run_claimed_at FROM config;
DROP TABLE config;
ALTER TABLE config_new RENAME TO config;

CREATE TABLE rules_new (
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
INSERT INTO rules_new (id,name,enabled,priority,mode,action,expression,service_filter,instance_filter,exclude_tags,exclude_titles,created_at,updated_at)
	SELECT id,name,enabled,priority,mode,action,expression,service_filter,instance_filter,exclude_tags,exclude_titles,created_at,updated_at FROM rules;
DROP TABLE rules;
ALTER TABLE rules_new RENAME TO rules;
`,
	// 8: Schedule is "every N days/weeks/months at HH:MM" instead of a raw hour count; existing hourly intervals become whole days.
	`
ALTER TABLE config ADD COLUMN interval_every INTEGER NOT NULL DEFAULT 1;
ALTER TABLE config ADD COLUMN interval_unit TEXT NOT NULL DEFAULT 'days' CHECK (interval_unit IN ('days','weeks','months'));
ALTER TABLE config ADD COLUMN run_time TEXT NOT NULL DEFAULT '03:00';
UPDATE config SET interval_every = MAX(1, interval_hours / 24);
ALTER TABLE config DROP COLUMN interval_hours;
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

export function migrate(db: Db, target: number = MIGRATIONS.length): void {
	const current = db.pragma("user_version", { simple: true }) as number;
	for (let v = current; v < target; v++) {
		db.transaction(() => {
			db.exec(MIGRATIONS[v] as string);
			db.pragma(`user_version = ${v + 1}`);
		})();
	}
}
