import type { Candidate, ItemRef } from "../types";

const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];
export function bytesParts(n: number): [string, string] {
	if (!n) return ["0", "B"];
	const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), 5);
	const v = n / 1024 ** i;
	return [v.toFixed(i < 2 ? 0 : v >= 100 ? 0 : 1), UNITS[i]!];
}
export const bytes = (n: number) => bytesParts(n).join(" ");
export const when = (s?: string | null) => (s ? new Date(s).toLocaleString() : "—");
export function ago(s?: string | null) {
	if (!s) return "—";
	const d = (new Date(s).getTime() - Date.now()) / 1000, a = Math.abs(d);
	const [v, u] = a < 60 ? [a, "s"] : a < 3600 ? [a / 60, "min"] : a < 86400 ? [a / 3600, "h"] : [a / 86400, "d"];
	const t = `${Math.round(v!)} ${u}`;
	return d < 0 ? `${t} ago` : `in ${t}`;
}
export const plural = (n: number, one: string, many = one + "s") => `${n.toLocaleString()} ${n === 1 ? one : many}`;
export const kindLabel = (k: string) => ({ movie: "Movie", series: "Series", season: "Season" } as Record<string, string>)[k] || k;
export const seasonName = (n: number) => (n === 0 ? "Specials" : `Season ${n}`);
/** Season items carry their series' title; the season number tells them apart. */
export const nameOf = (x: { title: string; seasonNumber?: number | null }) => (x.seasonNumber != null ? `${x.title} · Season ${x.seasonNumber}` : x.title);
export const byName = (a: ItemRef, b: ItemRef) => nameOf(a).localeCompare(nameOf(b), undefined, { numeric: true, sensitivity: "base" });
/** Unmonitoring frees no space. */
export const frees = (x: { action: string }) => x.action !== "unmonitor";
export const sum = (rows: Candidate[]) => rows.filter(frees).reduce((n, r) => n + (r.sizeOnDisk || 0), 0);
export const sumSize = (rows: Array<{ sizeOnDisk?: number }>) => rows.reduce((n, r) => n + (r.sizeOnDisk || 0), 0);
export const splitList = (s: string) => {
	const l = s.split(",").map((x) => x.trim()).filter(Boolean);
	return l.length ? l : null;
};
