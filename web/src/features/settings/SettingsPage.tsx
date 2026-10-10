import { useId, useState } from "react";
import { AsyncView } from "../../components/ui/AsyncView";
import { Button } from "../../components/ui/Button";
import { Field, PageHead, Switch } from "../../components/ui/Layout";
import { useAsync } from "../../hooks/useAsync";
import { useApi, usePreviewCache } from "../../providers/ApiProvider";
import { useDialog } from "../../providers/DialogProvider";
import { useShell } from "../../providers/ShellProvider";
import { useToast } from "../../providers/ToastProvider";
import type { Config } from "../../types";

const KIDS: Array<[number, string]> = [
	[0, "All ages only (G, U, TV-Y)"], [7, "Up to 7+ (PG, TV-Y7)"], [12, "Up to 12+ (recommended)"], [13, "Up to 13+ (PG-13, TV-PG)"], [14, "Up to 14+ (TV-14)"], [16, "Up to 16+"],
];

export function SettingsPage() {
	const api = useApi();
	const state = useAsync(() => api.get<Config>("/config"), []);
	return <AsyncView state={state}>{(c) => <Settings initial={c} />}</AsyncView>;
}

const Panel = ({ title, children }: { title: string; children: React.ReactNode }) => (
	<section><div className="panel"><div className="panel-head"><h2>{title}</h2></div><div className="panel-body">{children}</div></div></section>
);

function Settings({ initial }: { initial: Config }) {
	const api = useApi();
	const cache = usePreviewCache();
	const dialog = useDialog();
	const toast = useToast();
	const shell = useShell();
	const uid = useId();
	const [saved, setSaved] = useState(initial);
	const [f, setF] = useState({
		dryRun: initial.dryRun, enabled: initial.enabled, every: String(initial.intervalEvery), unit: initial.intervalUnit, time: initial.runTime,
		max: String(initial.maxRemovalsPerRun), delay: String(initial.queueDelayDays), kids: String(initial.kidsMaxAge), auditDays: String(initial.auditRetentionDays),
	});
	const set = <K extends keyof typeof f>(k: K) => (v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
	const num = (k: keyof typeof f, min: number) => <input id={`${uid}-${k}`} type="number" min={min} inputMode="numeric" value={f[k] as string} onChange={(e) => set(k)(e.target.value as never)} />;

	const save = async () => {
		const goingLive = !f.dryRun && saved.dryRun;
		if (goingLive && !(await dialog.confirm({
			title: "Turn off dry run?", action: "Turn off dry run", danger: true,
			text: `Runs will queue real removals and apply them automatically after ${f.delay} day${Number(f.delay) === 1 ? "" : "s"}, unless cancelled or protected.`,
		}))) return;
		setSaved(await api.put<Config>("/config", {
			dryRun: f.dryRun, enabled: f.enabled, intervalEvery: Number(f.every), intervalUnit: f.unit, runTime: f.time, maxRemovalsPerRun: Number(f.max),
			queueDelayDays: Number(f.delay), auditRetentionDays: Number(f.auditDays), kidsMaxAge: Number(f.kids),
		}));
		cache.invalidate();
		toast.show("Settings saved");
		shell.refreshMode();
	};

	return (
		<div style={{ maxWidth: 760 }}>
			<PageHead title="Settings" lede="How cautious Cleanarr is, and when it runs." />
			<Panel title="Safety"><Switch checked={f.dryRun} onChange={set("dryRun")} label="Dry run" help="Report what would be removed without changing anything or queueing it. Keep this on until the preview looks right." /></Panel>
			<Panel title="Schedule">
				<Switch checked={f.enabled} onChange={set("enabled")} label="Run on a schedule" help="Run cleanup automatically on the schedule below." />
				<div style={{ marginTop: 12 }}>
					<div className="cols">
						<Field label="Run every" htmlFor={`${uid}-every`}>{num("every", 1)}</Field>
						<Field label="Unit" htmlFor={`${uid}-unit`}>
							<select id={`${uid}-unit`} value={f.unit} onChange={(e) => set("unit")(e.target.value as Config["intervalUnit"])}>
								{["days", "weeks", "months"].map((u) => <option key={u} value={u}>{u}</option>)}
							</select>
						</Field>
						<Field label="At (server time)" htmlFor={`${uid}-time`}><input id={`${uid}-time`} type="time" value={f.time} onChange={(e) => set("time")(e.target.value)} /></Field>
					</div>
				</div>
			</Panel>
			<Panel title="Queue">
				<div className="cols">
					<Field label="Max removals per run" htmlFor={`${uid}-max`} help="Caps both executions and new queue items per run.">{num("max", 1)}</Field>
					<Field label="Queue delay (days)" htmlFor={`${uid}-delay`} help="How long a match waits before Cleanarr applies it automatically.">{num("delay", 0)}</Field>
				</div>
			</Panel>
			<Panel title="Kids' content">
				<Field label="Suitable for kids up to" htmlFor={`${uid}-kids`} help={'Used by the "suitable for kids" content-rating rules, e.g. your protect rules. Ratings from any country are matched by minimum age; unrated titles never count as kids.'}>
					<select id={`${uid}-kids`} value={f.kids} onChange={(e) => set("kids")(e.target.value)}>{KIDS.map(([v, t]) => <option key={v} value={String(v)}>{t}</option>)}</select>
				</Field>
			</Panel>
			<Panel title="Audit log">
				<Field label="Keep audit log for (days)" htmlFor={`${uid}-auditDays`} help="Audit entries older than this are deleted on each run.">{num("auditDays", 1)}</Field>
			</Panel>
			<div className="row end" style={{ marginTop: 20 }}><Button className="primary" onAction={save}>Save settings</Button></div>
		</div>
	);
}
