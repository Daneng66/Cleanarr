import type { FileInfo, LibraryItem, Service } from "../types.js";
import type { RawFile, RawItem } from "./client.js";

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const date = (v: unknown): Date | null => {
	if (typeof v !== "string") return null;
	const d = new Date(v);
	return Number.isNaN(d.getTime()) ? null : d;
};

/** Public poster URL from an *arr `images` array. TMDb posters are fetched at grid size rather than original. */
export function posterOf(images: unknown): string | null {
	const p = Array.isArray(images) ? images.find((i) => i?.coverType === "poster") : null;
	const url = str(p?.remoteUrl);
	return url ? url.replace("image.tmdb.org/t/p/original/", "image.tmdb.org/t/p/w342/") : null;
}

export function normalizeFile(raw: RawFile): FileInfo {
	const media = raw.mediaInfo ?? {};
	let resolution = num(raw.quality?.quality?.resolution);
	if (!resolution && typeof media.resolution === "string") {
		const m = /^(\d+)x(\d+)$/.exec(media.resolution);
		if (m) resolution = Number(m[2]);
	}
	const languages: string[] = Array.isArray(raw.languages)
		? raw.languages.map((l: RawItem) => String(l?.name ?? "")).filter(Boolean)
		: typeof media.audioLanguages === "string"
			? media.audioLanguages.split("/").map((s: string) => s.trim()).filter(Boolean)
			: [];
	return {
		id: num(raw.id) ?? 0,
		path: str(raw.path) ?? str(raw.relativePath) ?? "",
		size: num(raw.size) ?? 0,
		dateAdded: date(raw.dateAdded),
		quality: str(raw.quality?.quality?.name),
		resolution,
		videoCodec: str(media.videoCodec),
		audioCodec: str(media.audioCodec),
		audioChannels: num(media.audioChannels),
		hdr: str(media.videoDynamicRangeType) ?? str(media.videoDynamicRange),
		releaseGroup: str(raw.releaseGroup),
		customFormatScore: num(raw.customFormatScore),
		languages,
	};
}

export function normalizeItem(
	raw: RawItem,
	ctx: {
		instanceId: string;
		service: Service;
		tags: Map<number, string>;
		profiles: Map<number, string>;
		/** Sonarr: pre-loaded episode files; omit when not needed. */
		episodeFiles?: RawFile[];
	},
): LibraryItem {
	const isMovie = ctx.service === "radarr";
	const stats = raw.statistics ?? {};
	const ratings = raw.ratings ?? {};
	const rating = isMovie ? num(ratings.tmdb?.value) : num(ratings.value);
	const files: FileInfo[] | null = isMovie
		? raw.movieFile
			? [normalizeFile(raw.movieFile)]
			: []
		: ctx.episodeFiles
			? ctx.episodeFiles.map(normalizeFile)
			: null;
	const profileId = num(raw.qualityProfileId);
	const fileCount = isMovie ? (raw.hasFile || raw.movieFile ? 1 : 0) : (num(stats.episodeFileCount) ?? 0);
	return {
		instanceId: ctx.instanceId,
		service: ctx.service,
		arrId: raw.id,
		kind: isMovie ? "movie" : "series",
		title: str(raw.title) ?? `#${raw.id}`,
		year: num(raw.year),
		monitored: raw.monitored === true,
		hasFile: isMovie ? fileCount > 0 : fileCount > 0,
		status: str(raw.status),
		released: isMovie
			? raw.status === undefined || raw.status === "released" || [raw.digitalRelease, raw.physicalRelease].some((d) => (date(d)?.getTime() ?? Infinity) <= Date.now())
			: fileCount > 0 || (num(stats.episodeCount) ?? 1) > 0, // Sonarr counts only aired episodes
		qualityProfileId: profileId,
		qualityProfileName: profileId !== null ? (ctx.profiles.get(profileId) ?? null) : null,
		sizeOnDisk: num(isMovie ? raw.sizeOnDisk : stats.sizeOnDisk) ?? 0,
		added: date(raw.added),
		genres: Array.isArray(raw.genres) ? raw.genres.map(String) : [],
		certification: str(raw.certification),
		tags: Array.isArray(raw.tags)
			? raw.tags.map((t: number) => ctx.tags.get(t)).filter((t: string | undefined): t is string => !!t)
			: [],
		rating,
		imdbRating: isMovie ? num(ratings.imdb?.value) : null,
		runtime: num(raw.runtime),
		path: str(raw.path),
		originalLanguage: str(raw.originalLanguage?.name),
		tmdbId: num(raw.tmdbId),
		tvdbId: num(raw.tvdbId),
		imdbId: str(raw.imdbId),
		files,
		fileCount,
		poster: posterOf(raw.images),
	};
}

/**
 * Splits a normalized series into one item per season that has files on disk. Each season item
 * keeps the series' identity and metadata (so tags, titles and filters apply unchanged) with
 * that season's size, files and episode list.
 */
export function seasonItems(series: LibraryItem, raw: RawItem, episodes: RawItem[], episodeFiles?: RawFile[]): LibraryItem[] {
	const out: LibraryItem[] = [];
	const fileById = new Map((episodeFiles ?? []).map((f) => [num(f.id), f] as const));
	for (const s of Array.isArray(raw.seasons) ? raw.seasons : []) {
		const n = num(s.seasonNumber);
		const fileCount = num(s.statistics?.episodeFileCount) ?? 0;
		if (n === null || fileCount === 0) continue;
		out.push({
			...series,
			kind: "season",
			monitored: s.monitored === true,
			hasFile: true,
			sizeOnDisk: num(s.statistics?.sizeOnDisk) ?? 0,
			fileCount,
			poster: posterOf(s.images) ?? series.poster,
			files: episodeFiles ? episodeFiles.filter((f) => f.seasonNumber === n).map(normalizeFile) : null,
			season: {
				number: n,
				episodes: episodes
					.filter((e) => e.seasonNumber === n && num(e.episodeNumber) !== null)
					.map((e) => ({
						number: e.episodeNumber as number,
						airDate: date(e.airDateUtc),
						added: date(fileById.get(num(e.episodeFileId))?.dateAdded),
						hasFile: e.hasFile === true,
					})),
			},
		});
	}
	return out;
}
