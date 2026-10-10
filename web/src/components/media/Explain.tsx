import { IconButton, Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { StateBadge } from "../ui/StateBadge";
import { ActionTag, ProtectTag } from "../ui/Tags";
import { BadNotice, Notices } from "../ui/Feedback";
import { bytes, kindLabel, nameOf } from "../../lib/format";
import { useApi } from "../../providers/ApiProvider";
import { useAsync } from "../../hooks/useAsync";
import type { Explain, ExplainNode, ExplainRule, ItemRef } from "../../types";

/** "Why?" toggle; the parent shows <ExplainPanel> while it's open. */
export function WhyButton({ item, open, onToggle, className = "", iconOnly = false }: { item: ItemRef; open: boolean; onToggle: () => void; className?: string; iconOnly?: boolean }) {
	const label = `Why is ${nameOf(item)} flagged?`;
	return iconOnly
		? <IconButton icon="why" label={label} className={className} aria-expanded={open} onClick={onToggle} />
		: <Button icon="why" className={className} aria-label={label} aria-expanded={open} onClick={onToggle}>Why?</Button>;
}

/** Per-rule, per-condition evaluation, fetched when it first appears (read-only, so no modal). */
export function ExplainPanel({ item }: { item: ItemRef }) {
	const api = useApi();
	const { data, error } = useAsync(
		() => api.post<Explain>("/explain", { instanceId: item.instanceId, arrItemId: item.arrItemId, seasonNumber: item.seasonNumber ?? null }),
		[item.instanceId, item.arrItemId, item.seasonNumber],
	);
	if (error) return <BadNotice>{error.message}</BadNotice>;
	if (!data) return <div className="skeleton" style={{ width: "50%" }} />;
	return <ExplainBody e={data} />;
}

const MARK: Record<string, [string, string]> = { true: ["check", "st state yes"], false: ["x", "st state loaded"], unknown: ["unknown", "st state unknown"] };
function CondTree({ n }: { n: ExplainNode }) {
	const [ic, cls] = MARK[n.state] || MARK.unknown!;
	return (
		<li>
			<span className={cls} style={{ font: "inherit", whiteSpace: "normal" }}>
				<Icon name={ic as "check"} />
				{n.type ? <span className={n.state === "true" ? "" : "muted"}>{n.reason}</span> : <span className="op">{n.op?.toUpperCase()}</span>}
			</span>
			{n.children ? <ul>{n.children.map((c, i) => <CondTree key={i} n={c} />)}</ul> : null}
		</li>
	);
}

function Verdict({ r }: { r: ExplainRule }) {
	const badge = !r.inScope ? <StateBadge state="out_of_scope" />
		: r.state === "true" ? (r.mode === "retention" ? <StateBadge state="protected" label="Protects it" /> : <StateBadge state="matches" />)
		: r.state === "false" ? <StateBadge state="no_match" /> : <StateBadge state="unknown" />;
	return (
		<div className="verdict">
			<div className="row"><strong>{r.name}</strong>{r.mode === "retention" ? <ProtectTag /> : <ActionTag action={r.action} />}<span className="grow" />{badge}</div>
			{r.excludedBy ? <div className="help">{r.excludedBy}</div> : null}
			{r.tree ? <ul className="tree"><CondTree n={r.tree} /></ul> : null}
		</div>
	);
}

export function ExplainBody({ e }: { e: Explain }) {
	const out = e.rules.filter((r) => !r.inScope);
	return (
		<div className="explain">
			<div className="itemfacts">
				<span>{e.item.seasonNumber != null ? `Season ${e.item.seasonNumber}` : kindLabel(e.item.kind)}</span>
				<span><b>{bytes(e.item.sizeOnDisk)}</b></span>
				<span>{e.item.monitored ? "Monitored" : "Unmonitored"}</span>
				{e.item.path ? <span className="mono">{e.item.path}</span> : null}
			</div>
			<Notices items={e.warnings} />
			{e.rules.filter((r) => r.inScope).map((r, i) => <Verdict key={i} r={r} />)}
			{out.length ? <details className="out-of-scope"><summary className="help">{`${out.length} out of scope`}</summary>{out.map((r, i) => <Verdict key={i} r={r} />)}</details> : null}
		</div>
	);
}
