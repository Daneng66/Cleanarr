export type Service = "sonarr" | "radarr";
export type InstanceType = Service | "plex" | "seerr";
export type ItemKind = "movie" | "series" | "season";
/** delete_season: delete one season's episode files and unmonitor that season. Only rules with it see season items. */
export type CleanupAction = "delete" | "unmonitor" | "delete_files" | "delete_season";
export type RuleMode = "cleanup" | "retention";
export type Trigger = "scheduled" | "manual" | "approval" | "retry" | "queue" | "pickup";

export interface Instance {
	id: string;
	name: string;
	type: InstanceType;
	url: string;
	apiKey: string;
	enabled: boolean;
}

/** One media file on disk (a movie file or an episode file). */
export interface FileInfo {
	id: number;
	path: string;
	size: number;
	dateAdded: Date | null;
	quality: string | null;
	resolution: number | null; // vertical lines, e.g. 1080
	videoCodec: string | null;
	audioCodec: string | null;
	audioChannels: number | null;
	hdr: string | null;
	releaseGroup: string | null;
	customFormatScore: number | null;
	languages: string[];
}

export interface SeasonInfo {
	number: number;
	/** Every episode Sonarr lists for the season, aired or not. */
	episodes: Array<{ number: number; airDate: Date | null; hasFile: boolean }>;
}

/** Service-neutral view of a Radarr movie, Sonarr series, or one season of a series (kind "season", arrId = series id). */
export interface LibraryItem {
	instanceId: string;
	service: Service;
	arrId: number;
	kind: ItemKind;
	title: string;
	year: number | null;
	monitored: boolean;
	hasFile: boolean;
	status: string | null;
	/** False when nothing has released/aired yet, so a missing file is expected. Undefined counts as released. */
	released?: boolean;
	qualityProfileId: number | null;
	qualityProfileName: string | null;
	sizeOnDisk: number;
	added: Date | null;
	genres: string[];
	/** Age rating as Radarr/Sonarr report it (e.g. PG-13, TV-Y7); null when the item has none. */
	certification: string | null;
	tags: string[];
	rating: number | null;
	imdbRating: number | null;
	runtime: number | null;
	path: string | null;
	originalLanguage: string | null;
	tmdbId: number | null;
	tvdbId: number | null;
	imdbId: string | null;
	/** null = not loaded; file-metadata rules evaluate to "unknown" rather than guessing. */
	files: FileInfo[] | null;
	fileCount: number;
	/** Public poster image URL (TMDb/TVDB) as Sonarr/Radarr report it; null when there is none. */
	poster: string | null;
	/** Set only on season items. */
	season?: SeasonInfo;
}

export interface WatchInfo {
	lastWatchedAt: Date | null;
	watchCount: number;
	watchedBy: string[];
	/** Season items only: episode numbers of that season each user has watched. */
	episodesByUser?: Map<string, Set<number>>;
}

export interface WatchData {
	/** Keyed `movie:tmdb:<id>` | `series:tvdb:<id>` | `series:tmdb:<id>`. */
	byKey: Map<string, WatchInfo>;
}

export interface Candidate {
	item: LibraryItem;
	rule: RuleRecord;
	reason: string;
}

export interface RuleRecord {
	id: string;
	name: string;
	enabled: boolean;
	priority: number;
	mode: RuleMode;
	action: CleanupAction;
	expression: unknown;
	serviceFilter: Service[] | null;
	instanceFilter: string[] | null;
	excludeTags: string[] | null;
	excludeTitles: string[] | null;
}

export interface ConfigRecord {
	enabled: boolean;
	intervalEvery: number;
	intervalUnit: "days" | "weeks" | "months";
	/** Local time of day, "HH:MM". */
	runTime: string;
	dryRun: boolean;
	maxRemovalsPerRun: number;
	/** How long a match waits in the queue before Cleanarr applies it automatically. 0 = next run. */
	queueDelayDays: number;
	lastRunAt: string | null;
	nextRunAt: string | null;
}
