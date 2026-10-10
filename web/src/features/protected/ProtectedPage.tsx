import { useEffect, useMemo, useState } from "react";
import { AsyncView } from "../../components/ui/AsyncView";
import { Button } from "../../components/ui/Button";
import { Empty } from "../../components/ui/Feedback";
import { PageHead } from "../../components/ui/Layout";
import { Segmented } from "../../components/ui/Segmented";
import { useAsync } from "../../hooks/useAsync";
import { byName, plural } from "../../lib/format";
import { isRuleProtected, itemKey, SKIP_ORDER, skipCategory } from "../../lib/protection";
import { useApi, usePreviewCache } from "../../providers/ApiProvider";
import { useDialog } from "../../providers/DialogProvider";
import { useShell } from "../../providers/ShellProvider";
import { useToast } from "../../providers/ToastProvider";
import type { Instance, ItemRef, ProtectedRow, RunDetail } from "../../types";
import { ManualProtectedCard, RuleProtectedCard } from "./ProtectedCards";
import { ProtectedStats } from "./ProtectedStats";
import { useProtectionOps } from "./useProtectionOps";

type Mode = "all" | "rule" | "manual";

export function ProtectedPage() {
	const api = useApi();
	const cache = usePreviewCache();
	const state = useAsync(async () => {
		const [preview, instances] = await Promise.all([cache.get(), api.get<Instance[]>("/instances")]);
		return { protAll: preview.skipped.filter(isRuleProtected), instances: instances.filter((i) => i.type === "sonarr" || i.type === "radarr") };
	}, []);
	return <AsyncView state={state}>{(d) => <ProtectedView {...d} />}</AsyncView>;
}

type Shown = ItemRef & { poster?: string | null; certification?: string | null; sizeOnDisk?: number };

function ProtectedView({ protAll, instances }: { protAll: RunDetail[]; instances: Instance[] }) {
	const api = useApi();
	const cache = usePreviewCache();
	const dialog = useDialog();
	const toast = useToast();
	const shell = useShell();
	const [mode, setMode] = useState<Mode>("all");
	const [inst, setInst] = useState("all");
	const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
	const list = useAsync(() => api.get<ProtectedRow[]>("/protected"), [mode, inst]);
	const loaded = !list.loading && !!list.data;
	const rows = list.data ?? [];

	useEffect(() => { setSelected(new Set()); }, [mode, inst]);
	useEffect(() => { if (list.error) toast.fail(list.error); }, [list.error, toast]);

	const info = useMemo(() => new Map(protAll.map((d) => [itemKey(d), d])), [protAll]);
	const covered = useMemo(() => new Set(info.keys()), [info]);
	const ops = useProtectionOps(rows, covered);

	const inScope = (d: ItemRef) => inst === "all" || d.instanceId === inst;
	const merged = (p: ProtectedRow): Shown & ProtectedRow => ({ ...(info.get(itemKey(p)) as Partial<RunDetail>), ...p }) as Shown & ProtectedRow;
	const prot = useMemo(() => protAll.filter(inScope).sort((a, b) => SKIP_ORDER.indexOf(skipCategory(a)[0]) - SKIP_ORDER.indexOf(skipCategory(b)[0]) || byName(a, b)), [protAll, inst]); // eslint-disable-line react-hooks/exhaustive-deps
	// Overrides ("unprotected") aren't protected, so they don't belong in the list.
	const manual = rows.filter((p) => inScope(p) && !p.ignoreRetention);
	const seen = new Set(prot.map(itemKey));
	const manualShown = (mode === "all" ? manual.filter((p) => !seen.has(itemKey(p))) : manual).map(merged).sort(byName);
	const showRules = mode !== "manual", showManual = mode !== "rule";
	const pickables: ItemRef[] = [...(showRules ? prot : []), ...(showManual ? manualShown : [])];
	const nothingManual = mode === "manual" && !manualShown.length;

	const rawManual = rows.filter((p) => !p.ignoreRetention);
	const seenAll = new Set(protAll.map(itemKey));
	const statsAll = [...protAll, ...rawManual.filter((p) => !seenAll.has(itemKey(p))).map(merged)];

	const pick = (d: ItemRef) => ({
		checked: selected.has(itemKey(d)),
		onChange: (on: boolean) => setSelected((s) => { const n = new Set(s); on ? n.add(itemKey(d)) : n.delete(itemKey(d)); return n; }),
	});
	const chosen = pickables.filter((d) => selected.has(itemKey(d)));
	const allPicked = chosen.length > 0 && chosen.length === pickables.length;

	const bulk = (label: "Protect" | "Unprotect", note: string) => async () => {
		if (!chosen.length) return toast.show("Select titles first", true);
		if (!(await dialog.confirm({ title: `${label} ${plural(chosen.length, "title")}?`, text: note, action: label, danger: label === "Unprotect" }))) return;
		await Promise.all(chosen.map((d) => (label === "Unprotect" ? ops.unprotect(d) : ops.protect(d))));
		cache.invalidate();
		toast.show(`${label}ed ${plural(chosen.length, "title")}`);
		shell.reload(); // rule-protected cards come from the preview, so rebuild the page
	};

	const head = (t: string, n: number) => mode === "all" && n ? <div className="section-title"><h2>{t}</h2><span className="faint small">{n.toLocaleString()}</span></div> : null;

	return (
		<div>
			<PageHead back title="Protected" lede="Titles matching a cleanup rule but kept by a retention rule, or items you protected by hand." />
			{loaded ? <ProtectedStats byRules={protAll} manualCount={rawManual.length} all={statsAll} /> : null}
			<div className="row" style={{ marginBottom: 16, gap: 12, flexWrap: "wrap", alignItems: "center" }}>
				<Segmented label="List" value={mode} onChange={setMode} options={[["all", "All"], ["rule", "By rules"], ["manual", "Manually protected"]]} />
				{instances.length > 1 ? <Segmented label="Instance" value={inst} onChange={setInst} options={[["all", "All instances"], ...instances.map((i) => [i.id, i.name] as const)]} /> : null}
				{loaded && !nothingManual ? (
					<div style={{ marginLeft: "auto" }}>
						<div className="row" style={{ gap: 12, flexWrap: "wrap", marginLeft: "auto" }}>
							<label className="row">
								<input type="checkbox" aria-label="Select all" checked={allPicked}
									onChange={(e) => setSelected(e.target.checked ? new Set(pickables.map(itemKey)) : new Set())} />Select all
							</label>
							<span className="faint">{chosen.length ? `${chosen.length} selected` : ""}</span>
							<Button icon="protected" onAction={bulk("Protect", "Lifts any rule override and protects titles no rule covers.")}>Protect selected</Button>
							<Button icon="unprotected" className="danger solid" onAction={bulk("Unprotect", "Cleanup rules can match them again on the next run.")}>Unprotect selected</Button>
						</div>
					</div>
				) : null}
			</div>
			{!loaded ? (list.error ? null : <Empty title="Loading…" />)
				: nothingManual ? <Empty title="Nothing manually protected" />
				: <>
					{showRules ? <>{head("Protected by rules", prot.length)}<div className="skip-grid">{prot.map((d) => <RuleProtectedCard key={itemKey(d)} d={d} toggle={ops.ruleToggle(d)} pick={pick(d)} />)}</div></> : null}
					{showManual && manualShown.length ? <>{head("Manually protected", manualShown.length)}<div className="skip-grid">{manualShown.map((d) => <ManualProtectedCard key={d.id} d={d} ignoreRetention={d.ignoreRetention} toggle={ops.manualToggle(d)} pick={pick(d)} />)}</div></> : null}
				</>}
		</div>
	);
}
