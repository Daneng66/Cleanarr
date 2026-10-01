export type Service = "sonarr" | "radarr";
export type InstanceType = Service | "plex" | "seerr";
export type ItemKind = "movie" | "series";
export type CleanupAction = "delete" | "unmonitor" | "delete_files";
export type RuleMode = "cleanup" | "retention";
export type Trigger = "scheduled" | "manual" | "approval" | "retry";

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

/** Service-neutral view of a Radarr movie or Sonarr series. */
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
}

export interface WatchInfo {
	lastWatchedAt: Date | null;
	watchCount: number;
	watchedBy: string[];
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
	useGlobalRejectionMemory: boolean;
	rejectionMemoryDays: number | null;
}

export interface ConfigRecord {
	enabled: boolean;
	intervalHours: number;
	dryRun: boolean;
	maxRemovalsPerRun: number;
	requireApproval: boolean;
	approvalExpiryDays: number;
	/** 0 = off, N = days, null = forever. */
	rejectionMemoryDays: number | null;
	lastRunAt: string | null;
	nextRunAt: string | null;
}
