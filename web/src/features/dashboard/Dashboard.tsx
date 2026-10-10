import { useEffect, useMemo, useState } from "react";
import { AsyncView } from "../../components/ui/AsyncView";
import { Button } from "../../components/ui/Button";
import { Notice, Notices } from "../../components/ui/Feedback";
import { Readout, ReadoutSkeleton } from "../../components/ui/Readout";
import { Sk } from "../../components/ui/Skeleton";
import { actionLabel } from "../../components/ui/Tags";
import { useAsync } from "../../hooks/useAsync";
import { usePreview } from "../../hooks/usePreview";
import { nameOf, plural, sum } from "../../lib/format";
import { isRuleProtected } from "../../lib/protection";
import { useApi, usePreviewCache } from "../../providers/ApiProvider";
import { useDialog } from "../../providers/DialogProvider";
import { useShell } from "../../providers/ShellProvider";
import { useToast } from "../../providers/ToastProvider";
import { useRuleEditor } from "../rules/useRuleEditor";
import { useInstanceEditor } from "../instances/useInstanceEditor";
import type { Candidate, Instance, Preview, RuleRecord, RunLog, Status } from "../../types";
import { DriversPanel } from "./DriversPanel";
import { LastRunPanel } from "./LastRunPanel";
import { LibraryPanel } from "./LibraryPanel";
import { candidateKey, PosterGrid } from "./PosterGrid";
import { PosterSkeleton, PosterState } from "./PosterState";
import { TitleDetailDialog } from "./TitleDetail";

interface Base {
	status: Status;
	instances: Instance[];
	rules: RuleRecord[];
}

/** Same boxes as the loaded dashboard, so nothing jumps when data lands. */
const DashboardSkeleton = () => (
	<div aria-busy="true">
		<div className="deck">
			<div><LibraryPanel library={null} /><ReadoutSkeleton /><PosterSkeleton /></div>
			<aside className="panel"><div className="panel-head"><Sk kind="line short" /></div><div className="panel-body"><Sk kind="block" /></div></aside>
		</div>
	</div>
);

export function Dashboard() {
	const api = useApi();
	const state = useAsync<Base>(async () => {
		const [status, instances, rules] = await Promise.all([api.get<Status>("/status"), api.get<Instance[]>("/instances"), api.get<RuleRecord[]>("/rules")]);
		return { status, instances, rules };
	}, []);
	return <AsyncView state={state} skeleton={<DashboardSkeleton />}>{(b) => <DashboardBody base={b} />}</AsyncView>;
}

function DashboardBody({ base }: { base: Base }) {
	const { status: s, instances, rules } = base;
	const hasLibrary = instances.some((i) => i.type === "sonarr" || i.type === "radarr");
	return (
		<div>
			{s.config.dryRun && hasLibrary ? (
				<div className="notices"><Notice>Dry run is on: runs only report what they would do, and nothing is queued. <a href="#/settings">Turn it off in Settings</a> once the preview looks right.</Notice></div>
			) : null}
			<div>
				{!hasLibrary ? <ConnectLibrary /> : !rules.some((r) => r.enabled) ? <NoRules status={s} /> : <Overview status={s} />}
			</div>
		</div>
	);
}

function ConnectLibrary() {
	const editInstance = useInstanceEditor();
	return (
		<>
			<Readout n={null} title="Connect your library" text="Add Sonarr or Radarr and Cleanarr shows what your rules would remove here." />
			<PosterState kind="empty" title="No library connected" text="Titles your rules would remove show up here as posters, largest first."
				action={<Button icon="plus" onClick={() => { location.hash = "#/instances"; editInstance(); }}>Add Sonarr or Radarr</Button>} />
		</>
	);
}

function NoRules({ status }: { status: Status }) {
	const editRule = useRuleEditor();
	const { data, error } = usePreview();
	return (
		<>
			{error ? null : <LibraryPanel library={data?.library ?? null} protectedItems={data?.skipped.filter(isRuleProtected) ?? []} missingCount={data?.missing.length ?? 0} />}
			<Readout n={null} title="No cleanup rules yet" text="Write a rule and the preview shows exactly what it would pull, before anything changes." />
			<PosterState kind="empty" title="Nothing to pull yet" text="Rules decide which titles go, e.g. added over a year ago and not watched in 180 days."
				action={<Button icon="plus" onClick={() => { location.hash = "#/rules"; editRule(); }}>Write a rule</Button>} />
			<LastRunPanel run={status.lastRun} />
		</>
	);
}

/** The dashboard proper: reclaimable total, flagged posters, what drives it. */
function Overview({ status: s }: { status: Status }) {
	const api = useApi();
	const cache = usePreviewCache();
	const dialog = useDialog();
	const toast = useToast();
	const shell = useShell();
	const { data: p, error, refresh } = usePreview();
	const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
	const [deleting, setDeleting] = useState<ReadonlySet<string>>(new Set());
	const cfg = s.config;
	const flagged = p?.candidates;

	useEffect(() => {
		if (flagged && flagged.length !== shell.waiting) shell.setWaiting(flagged.length);
	}, [flagged, shell]);

	const toggle = (set: ReadonlySet<string>, key: string, on: boolean) => { const n = new Set(set); on ? n.add(key) : n.delete(key); return n; };

	/** Reclaim this one title now. Queued items go through their approval; unqueued ones through a single-title run. */
	const reclaimOne = async (c: Candidate) => {
		const q = c.queue;
		const label = actionLabel(c.action);
		const title = c.action === "delete_files" ? `Delete files for “${nameOf(c)}” now?` : `${label} “${nameOf(c)}” now?`;
		if (!(await dialog.confirm({ title, text: "Re-checked against live data first, and blocked if anything changed.", action: `${label} now`, danger: true }))) return;
		const key = candidateKey(c);
		dialog.close();
		setDeleting((d) => toggle(d, key, true));
		try {
			let done: boolean, detail = "";
			if (q) {
				const r = await api.post<{ status: string; lastError?: string }>(`/approvals/${q.id}/approve`);
				done = r.status === "reclaimed"; detail = r.lastError || r.status;
			} else {
				const r = await api.post<{ itemsRemoved: number; itemsUnmonitored: number; itemsFilesDeleted: number }>("/run", { immediate: true, only: { instanceId: c.instanceId, arrItemId: c.arrItemId, seasonNumber: c.seasonNumber ?? null } });
				done = r.itemsRemoved + r.itemsUnmonitored + r.itemsFilesDeleted > 0;
			}
			if (done) { cache.remove(c); toast.show("Reclaimed"); }
			else { toast.show(q ? `Not reclaimed: ${detail}` : "Nothing was reclaimed"); cache.invalidate(); shell.reload(); }
		} catch (e) {
			setDeleting((d) => toggle(d, key, false));
			throw e;
		}
	};

	const openTitle = (c: Candidate) => {
		let changed = false;
		// A protected item no longer matches a cleanup rule: drop just its card once the dialog closes (stale preview is refetched next time).
		dialog.open(<TitleDetailDialog c={c} cfg={cfg} onReclaim={reclaimOne} onProtectChange={() => { changed = !changed; }} />, {
			kind: "wide",
			onClosed: () => { if (changed) { cache.invalidate(); setHidden((h) => toggle(h, candidateKey(c), true)); } },
		});
	};

	const reclaimAll = async () => {
		const text = cfg.dryRun ? "This is a dry run: Cleanarr records what it would do and changes nothing." : "Matches are actioned immediately, skipping the queue wait. This can't be undone.";
		if (!(await dialog.confirm({ title: "Reclaim now?", text, action: cfg.dryRun ? "Run dry run" : "Reclaim now" }))) return;
		const r = await api.post<{ status: string; itemsFlagged: number; itemsRemoved: number }>("/run", { immediate: true });
		toast.show(`Run ${r.status}: ${r.itemsFlagged} flagged, ${r.itemsRemoved} removed`);
		cache.invalidate();
		shell.reload();
	};

	const acts = (
		<div className="acts">
			<Button icon="refresh" onAction={refresh}>Run Rules</Button>
			<Button icon="play" className="primary" disabled={!flagged?.length} title={flagged && !flagged.length ? "Nothing to reclaim" : ""} onAction={reclaimAll}>Reclaim now</Button>
		</div>
	);

	const summary = useMemo(() => (p ? summarise(p, s) : null), [p, s]);
	const prot = useMemo(() => p?.skipped.filter(isRuleProtected) ?? [], [p]);

	return (
		<>
			{error && !p ? null : <LibraryPanel library={p?.library ?? null} protectedItems={prot} missingCount={p?.missing.length ?? 0} />}
			{error && !p ? <Readout n={null} title="Preview failed" text={error.message} actions={acts} />
				: !p || !summary ? <ReadoutSkeleton actions={acts} />
				: <Readout n={summary.reclaim} title="reclaimable by your rules" text={<Facts p={p} s={summary} />} actions={acts} />}
			{error && !p ? <PosterState kind="empty" title="Couldn't read the library" text="Check that your instances are reachable, then refresh." action={<a className="btn" href="#/instances">Check instances</a>} />
				: !p || !summary ? <PosterSkeleton />
				: p.candidates.length ? <PosterGrid candidates={p.candidates} cfg={cfg} hidden={hidden} deleting={deleting} onSelect={openTitle} />
				: <PosterState kind="empty clear" title="Nothing to purge. Your library is suspiciously tidy." action={<a className="btn" href="#/rules">Review rules</a>}
					text={`No title matches a cleanup rule.${summary.orphaned ? ` ${plural(summary.orphaned, "queued removal")} no longer match${summary.orphaned === 1 ? "es" : ""} and will be re-checked before running.` : " Loosen a rule or check back after more is added."}`} />}
			{p?.warnings.length ? <Notices items={p.warnings} style={{ marginTop: 16 }} /> : null}
			{p?.candidates.length ? <DriversPanel candidates={p.candidates} /> : null}
			<LastRunPanel run={s.lastRun} />
		</>
	);
}

function summarise(p: Preview, s: Status) {
	const flagged = p.candidates;
	const openHere = flagged.filter((c) => c.queue && c.queue.status !== "reclaimed").length;
	const totalOpen = (s.approvals.pending || 0) + (s.approvals.failed || 0);
	return {
		reclaim: sum(flagged),
		ruleCount: new Set(flagged.map((c) => c.ruleId)).size,
		queuedCount: flagged.filter((c) => c.queue).length,
		orphaned: Math.max(0, totalOpen - openHere),
	};
}

const Nw = ({ children }: { children: string }) => <span className="nw">{children}</span>;
function Facts({ p, s }: { p: Preview; s: ReturnType<typeof summarise> }) {
	const n = p.candidates.length;
	if (!n) return <>{`${plural(p.evaluated, "title")} evaluated. Your rules match nothing right now.`}</>;
	return (
		<>
			<Nw>{`${plural(n, "title")} flagged by ${plural(s.ruleCount, "rule")}`}</Nw>{" · "}<Nw>{`${plural(p.evaluated, "title")} evaluated`}</Nw>
			{s.queuedCount ? <>{" · "}<Nw>{`${plural(s.queuedCount, "title")} already queued`}</Nw></> : null}
			{s.orphaned ? <>{" · "}<Nw>{`${plural(s.orphaned, "queued removal")} no longer match${s.orphaned === 1 ? "es" : ""}`}</Nw></> : null}
		</>
	);
}
