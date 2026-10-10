import type { LibraryRow } from "../../types";

export const SORTS = {
	title: ["Title", (a: LibraryRow, b: LibraryRow) => a.title.localeCompare(b.title)],
	size: ["Size", (a: LibraryRow, b: LibraryRow) => b.sizeOnDisk - a.sizeOnDisk],
	added: ["Date added", (a: LibraryRow, b: LibraryRow) => (b.added || "").localeCompare(a.added || "")],
	year: ["Year", (a: LibraryRow, b: LibraryRow) => (b.year || 0) - (a.year || 0)],
	rating: ["Rating", (a: LibraryRow, b: LibraryRow) => (b.rating || 0) - (a.rating || 0)],
} as const;
export type SortKey = keyof typeof SORTS;

export const libKey = (d: { instanceId: string; arrItemId: number }) => `${d.instanceId}:${d.arrItemId}`;
export const hasFiles = (d: LibraryRow) => d.hasFile || d.fileCount > 0;
