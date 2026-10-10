import { Panel, SectionTitle } from "../../components/ui/Layout";
import { StateBadge } from "../../components/ui/StateBadge";
import { TimeEl } from "../../components/ui/TimeEl";
import { plural } from "../../lib/format";
import type { RunLog } from "../../types";

export function LastRunPanel({ run: r }: { run: RunLog | null }) {
	if (!r) {
		return (
			<section style={{ marginTop: 28 }}>
				<div className="panel lastrun"><StateBadge state="loaded" label="No runs yet" /><span>Run now, or turn on the schedule in <a href="#/settings">Settings</a>.</span></div>
			</section>
		);
	}
	return (
		<section style={{ marginTop: 28 }}>
			<SectionTitle title="Last run"><a href="#/history" className="small">All runs</a></SectionTitle>
			<Panel>
				<div className="lastrun">
					<StateBadge state={r.status} />
					<span className="tag">{r.isDryRun ? "Dry run" : "Live"}</span>
					<TimeEl value={r.startedAt} />
					<span>{`${r.itemsEvaluated} evaluated · ${r.itemsFlagged} flagged · ${r.itemsRemoved} removed · ${r.itemsSkipped} skipped`}</span>
					{r.warnings.length ? <a href="#/history">{plural(r.warnings.length, "warning")}</a> : null}
				</div>
			</Panel>
		</section>
	);
}
