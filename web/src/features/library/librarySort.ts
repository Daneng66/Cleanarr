import type { LibraryRow } from "../../types";

/** Never-watched sorts as oldest, so it leads a "most days since watched" list. */
const lastWatchedMs = (d: LibraryRow) => (d.lastWatchedAt ? Date.parse(d.lastWatchedAt) : -Infinity);

export const SORTS = {
	title: ["Title", (a: LibraryRow, b: LibraryRow) => a.title.localeCompare(b.title)],
	size: ["Size", (a: LibraryRow, b: LibraryRow) => b.sizeOnDisk - a.sizeOnDisk],
	added: ["Date added", (a: LibraryRow, b: LibraryRow) => (b.added || "").localeCompare(a.added || "")],
	year: ["Year", (a: LibraryRow, b: LibraryRow) => (b.year || 0) - (a.year || 0)],
	rating: ["Rating", (a: LibraryRow, b: LibraryRow) => (b.rating || 0) - (a.rating || 0)],
	lastWatched: ["Last watched (days)", (a: LibraryRow, b: LibraryRow) => lastWatchedMs(a) - lastWatchedMs(b)],
	watchesAsc: ["Watch count (low to high)", (a: LibraryRow, b: LibraryRow) => a.watchCount - b.watchCount],
	watchesDesc: ["Watch count (high to low)", (a: LibraryRow, b: LibraryRow) => b.watchCount - a.watchCount],
} as const;
export type SortKey = keyof typeof SORTS;

export const libKey = (d: { instanceId: string; arrItemId: number }) => `${d.instanceId}:${d.arrItemId}`;
export const hasFiles = (d: LibraryRow) => d.hasFile || d.fileCount > 0;
