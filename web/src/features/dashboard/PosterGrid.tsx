import { useMemo, useState } from "react";
import { Art } from "../../components/media/Art";
import { bytes, byName, frees, plural, sum, nameOf } from "../../lib/format";
import { countdownBadge, soonestMs, volser } from "../../lib/reclaim";
import type { Candidate, Config } from "../../types";

const PAGE_POSTERS = 48;
export const candidateKey = (c: Candidate) => `${c.instanceId}:${c.itemType}:${c.arrItemId}:${c.seasonNumber ?? ""}:${c.ruleId}`;

function PosterCard({ c, cfg, deleting, onSelect }: { c: Candidate; cfg: Config; deleting: boolean; onSelect: (c: Candidate) => void }) {
	const season = c.seasonNumber ?? c.onlySeason;
	const countdown = countdownBadge(c, cfg);
	return (
		<div role="listitem" data-key={volser(c)} className={deleting ? "deleting" : undefined}>
			<button type="button" className={`poster ${frees(c) ? "" : "keep"}`} aria-label={`${nameOf(c)}, ${bytes(c.sizeOnDisk)}, ${c.ruleName}`} onClick={() => onSelect(c)}>
				<span className="art">
					<Art src={c.poster} title={c.title} fallbackClass="noart" lazy />
					{season != null ? <span className="badge">{`S${season}`}</span> : null}
					<span className="size">{bytes(c.sizeOnDisk)}</span>
					{countdown ? <span className="countdown">{countdown}</span> : null}
				</span>
				<span className="cap"><span className="t">{c.title}</span><span className="m">{c.ruleName}</span></span>
			</button>
		</div>
	);
}

export interface PosterGridProps {
	candidates: Candidate[];
	cfg: Config;
	/** Cards to leave out (e.g. just protected). Totals still count them until the next preview. */
	hidden: ReadonlySet<string>;
	deleting: ReadonlySet<string>;
	onSelect: (c: Candidate) => void;
}
/** Flagged titles as posters, soonest first then largest, paged. */
export function PosterGrid({ candidates, cfg, hidden, deleting, onSelect }: PosterGridProps) {
	const [shown, setShown] = useState(PAGE_POSTERS);
	const sorted = useMemo(() => [...candidates].sort((a, b) => soonestMs(a, cfg) - soonestMs(b, cfg) || byName(a, b)), [candidates, cfg]);
	const visible = sorted.filter((c) => !hidden.has(candidateKey(c)));
	return (
		<div className="posters">
			<div className="scale"><span>{`${plural(candidates.length, "title")} · soonest then largest`}</span><span>{`${bytes(sum(candidates))} frees space`}</span></div>
			<div className="grid" role="list" aria-label="Flagged titles, soonest then largest">
				{visible.slice(0, shown).map((c) => <PosterCard key={candidateKey(c)} c={c} cfg={cfg} deleting={deleting.has(candidateKey(c))} onSelect={onSelect} />)}
			</div>
			<button type="button" className="more" hidden={shown >= sorted.length} onClick={() => setShown(sorted.length)}>{`Show all ${sorted.length}`}</button>
		</div>
	);
}
