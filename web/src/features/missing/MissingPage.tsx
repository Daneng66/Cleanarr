import { useMemo } from "react";
import { AsyncView } from "../../components/ui/AsyncView";
import { Empty } from "../../components/ui/Feedback";
import { PageHead } from "../../components/ui/Layout";
import { TimeEl } from "../../components/ui/TimeEl";
import { OpenInArrButton } from "../../components/media/LinkButtons";
import { ProtectButton } from "../../components/media/ProtectButtons";
import { SkipCard, SkipTitle } from "../../components/media/ItemBits";
import { useAsync } from "../../hooks/useAsync";
import { plural } from "../../lib/format";
import { usePreviewCache } from "../../providers/ApiProvider";
import type { MissingRow } from "../../types";

export function MissingPage() {
	const cache = usePreviewCache();
	const state = useAsync(async () => (await cache.get()).missing, []);
	return <AsyncView state={state}>{(missing) => <Missing rows={missing} />}</AsyncView>;
}

/** Titles with nothing on disk yet. */
function Missing({ rows }: { rows: MissingRow[] }) {
	const sorted = useMemo(() => [...rows].sort((a, b) => a.title.localeCompare(b.title)), [rows]);
	return (
		<div>
			<PageHead back title={`${plural(rows.length, "title")} with no file`} lede="Nothing on disk for these, yet. Open them in Sonarr/Radarr, or protect them to keep them out of cleanup." />
			{rows.length ? (
				<div className="skip-grid">
					{sorted.map((d) => (
						<SkipCard key={`${d.instanceId}:${d.itemType}:${d.arrItemId}`} item={d}>
							<SkipTitle item={d} suffix={d.year ? ` (${d.year})` : ""} certification={d.certification} />
							<div className="why">{d.monitored ? "Monitored" : "Not monitored"}{d.added ? <> · added <TimeEl value={d.added} /></> : null}</div>
							<div className="foot"><div className="foot-left"><span className="row-acts"><OpenInArrButton item={d} className="ghost small" /><ProtectButton item={d} /></span></div></div>
						</SkipCard>
					))}
				</div>
			) : <Empty title="No missing files" />}
		</div>
	);
}
