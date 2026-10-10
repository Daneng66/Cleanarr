import { Stat, StatsPanel } from "../../components/ui/Layout";
import { bytes, sumSize } from "../../lib/format";
import type { RunDetail } from "../../types";

interface Sized { itemType: string; sizeOnDisk?: number }

/** Headline numbers across every instance: rule-protected titles plus manual ones not already counted. */
export function ProtectedStats({ byRules, manualCount, all }: { byRules: RunDetail[]; manualCount: number; all: Array<Sized & { message?: string }> }) {
	const sized = (list: Sized[]) => bytes(sumSize(list));
	const movies = all.filter((d) => d.itemType === "movie"), series = all.filter((d) => d.itemType !== "movie");
	const ruleNames = new Set(byRules.map((d) => /"(.+?)"/.exec(d.message || "")?.[1]).filter(Boolean));
	return (
		<StatsPanel style={{ marginBottom: 16 }}>
			<Stat label="Protected" value={all.length.toLocaleString()} sub={`${byRules.length.toLocaleString()} by rules · ${manualCount.toLocaleString()} manual`} />
			<Stat label="Size kept" value={sized(all)} sub="on disk" />
			<Stat label="Movies" value={movies.length.toLocaleString()} sub={sized(movies)} />
			<Stat label="Series" value={series.length.toLocaleString()} sub={sized(series)} />
			<Stat label="Rules protecting" value={ruleNames.size.toLocaleString()} sub="retention rules" />
		</StatsPanel>
	);
}
