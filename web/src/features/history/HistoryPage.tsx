import { AsyncView } from "../../components/ui/AsyncView";
import { Button } from "../../components/ui/Button";
import { DialogFrame } from "../../components/ui/DialogFrame";
import { BadNotice, Empty, Notice } from "../../components/ui/Feedback";
import { PageHead, SectionTitle } from "../../components/ui/Layout";
import { StateBadge } from "../../components/ui/StateBadge";
import { ActionTag } from "../../components/ui/Tags";
import { TimeEl } from "../../components/ui/TimeEl";
import { useAsync } from "../../hooks/useAsync";
import { bytes, kindLabel, nameOf, when } from "../../lib/format";
import { volser } from "../../lib/reclaim";
import { useApi } from "../../providers/ApiProvider";
import { useDialog } from "../../providers/DialogProvider";
import type { AuditEntry, RunDetail, RunLog } from "../../types";

export function HistoryPage() {
	const api = useApi();
	const state = useAsync(async () => {
		const [runs, audit] = await Promise.all([api.get<RunLog[]>("/logs?limit=30"), api.get<AuditEntry[]>("/audit?limit=100")]);
		return { runs, audit };
	}, []);
	return (
		<AsyncView state={state}>
			{({ runs, audit }) => (
				<div>
					<PageHead title="History" lede="Every run, and an append-only record of every selection, approval, block and removal." />
					<RunsTable runs={runs} />
					<AuditTable audit={audit} />
				</div>
			)}
		</AsyncView>
	);
}

function RunsTable({ runs }: { runs: RunLog[] }) {
	const api = useApi();
	const dialog = useDialog();
	const details = async (r: RunLog) => {
		const full = await api.get<RunLog>(`/logs/${r.id}`);
		dialog.open(<RunDetailsDialog run={full} />, { kind: "wide" });
	};
	return (
		<section>
			<SectionTitle title="Runs" grow={false} />
			{runs.length ? (
				<div className="panel table-wrap">
					<table>
						<thead><tr><th>Started</th><th>Trigger</th><th>Mode</th><th>Status</th><th className="num">Flagged</th><th className="num">Removed</th><th className="num">Reclaimed</th><th /></tr></thead>
						<tbody>
							{runs.map((r) => (
								<tr key={r.id}>
									<td><TimeEl value={r.startedAt} /></td>
									<td>{r.trigger}</td>
									<td><span className="tag">{r.isDryRun ? "Dry run" : "Live"}</span></td>
									<td><StateBadge state={r.status} />{r.error ? <div className="sub bad">{r.error}</div> : null}</td>
									<td className="num mono">{r.itemsFlagged}</td>
									<td className="num mono">{r.itemsRemoved}</td>
									<td className="num mono">{bytes(r.bytesReclaimed)}</td>
									<td className="num"><Button className="small" onAction={() => details(r)}>Details</Button></td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			) : <div className="panel"><Empty title="No runs yet" text="Run cleanup from the dashboard, or turn on the schedule in Settings." /></div>}
		</section>
	);
}

const AUDIT_STATE: Record<string, string> = { success: "success", blocked: "blocked", failed: "failed" };
function AuditTable({ audit }: { audit: AuditEntry[] }) {
	return (
		<section>
			<SectionTitle title="Audit trail" grow={false} />
			{audit.length ? (
				<div className="panel table-wrap">
					<table>
						<thead><tr><th>When</th><th>Event</th><th>Item</th><th>Actor</th><th>Detail</th></tr></thead>
						<tbody>
							{audit.map((e, i) => (
								<tr key={i}>
									<td className="small"><TimeEl value={e.created_at} /></td>
									<td><StateBadge state={AUDIT_STATE[e.outcome] || "loaded"} label={e.event_type.replaceAll("_", " ")} /></td>
									<td>{e.title}<div className="sub">{`${e.rule_name || "—"} · ${e.action}`}</div></td>
									<td className="small">{`${e.actor} (${e.trigger})`}</td>
									<td className={`small${e.outcome === "failed" ? " bad" : ""}`}>{e.reason}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			) : <div className="panel"><Empty title="No activity yet" text="Every rule match, approval, block, failure and removal from your media library is recorded here." /></div>}
		</section>
	);
}

function DetailTable({ rows }: { rows: RunDetail[] }) {
	if (!rows.length) return <Empty title="Nothing to show" />;
	return (
		<div className="table-wrap">
			<table>
				<thead><tr><th>Title</th><th>Rule</th><th>Reason</th><th className="num">Size</th><th>Result</th></tr></thead>
				<tbody>
					{rows.map((d, i) => (
						<tr key={i}>
							<td>{nameOf(d)}<div className="sub">{kindLabel(d.itemType)} · <span className="vol" title="Cartridge label">{volser(d)}</span></div></td>
							<td>{d.ruleName}<div className="sub"><ActionTag action={d.action} /></div></td>
							<td className="small">{d.reason}</td>
							<td className="num mono">{bytes(d.sizeOnDisk)}</td>
							<td><StateBadge state={d.outcome} />{d.message ? <div className={`sub${d.outcome === "failed" ? " bad" : ""}`}>{d.message}</div> : null}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

function RunDetailsDialog({ run }: { run: RunLog }) {
	const dialog = useDialog();
	const failed = run.details.filter((d) => d.outcome === "failed").length;
	return (
		<DialogFrame title={`Run ${when(run.startedAt)}`} onClose={dialog.close} foot={<Button onClick={dialog.close}>Close</Button>}
			lede={`${run.isDryRun ? "Dry run" : "Live"} · ${run.trigger} · ${run.itemsFlagged} flagged · ${run.itemsRemoved} removed${failed ? ` · ${failed} failed` : ""}`}>
			{run.warnings.length || run.error ? (
				<div className="notices">{run.warnings.map((w, i) => <Notice key={i}>{w}</Notice>)}{run.error ? <BadNotice>{run.error}</BadNotice> : null}</div>
			) : null}
			<DetailTable rows={[...run.details].sort((a, b) => +(b.outcome === "failed") - +(a.outcome === "failed"))} />
		</DialogFrame>
	);
}
