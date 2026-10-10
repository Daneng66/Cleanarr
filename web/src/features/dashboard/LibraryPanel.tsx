import type { ReactNode } from "react";
import { SectionTitle, Stat, StatsPanel } from "../../components/ui/Layout";
import { Sk } from "../../components/ui/Skeleton";
import { bytes, plural, sumSize } from "../../lib/format";
import type { LibrarySummary, RunDetail } from "../../types";

/** One stat tile; while `ready` is false it shows placeholders of the same size. */
function Tile({ ready, label, value, sub, more }: { ready: boolean; label: string; value?: ReactNode; sub?: ReactNode; more?: ReactNode }) {
	if (!ready) return <div><div className="k">{label}</div><Sk kind="val" /><Sk kind="line short" /></div>;
	return <Stat label={label} value={value} sub={sub} more={more} />;
}

/** Library totals; `library = null` renders the same panel with placeholder values while the preview loads. */
export function LibraryPanel({ library: l, protectedItems = [], missingCount = 0 }: { library: LibrarySummary | null; protectedItems?: RunDetail[]; missingCount?: number }) {
	const ready = !!l;
	return (
		<section style={{ marginBottom: 28 }} aria-busy={ready ? undefined : "true"}>
			<SectionTitle title="Library" />
			<StatsPanel>
				<Tile ready={ready} label="Total size" value={l && <>{bytes(l.totalBytes)}{l.capacityBytes ? <small className="cap">{`/${bytes(l.capacityBytes)}`}</small> : null}</>} sub={l && plural(l.movies + l.series, "title")} />
				<Tile ready={ready} label="Movies" value={l?.movies.toLocaleString()} sub={l && bytes(l.movieBytes)} />
				<Tile ready={ready} label="Series" value={l?.series.toLocaleString()} sub={l && `${plural(l.files, "episode")} · ${bytes(l.seriesBytes)}`} />
				<Tile ready={ready} label="Missing files" value={l?.missing.toLocaleString()} sub="no file on disk" more={missingCount ? <a className="link" href="#/missing">View details</a> : null} />
				<Tile ready={ready} label="Protected" value={protectedItems.length.toLocaleString()} sub={bytes(sumSize(protectedItems))} more={protectedItems.length ? <a className="link" href="#/protected">View details</a> : null} />
			</StatsPanel>
		</section>
	);
}
