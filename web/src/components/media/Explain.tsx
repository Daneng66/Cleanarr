import { IconButton, Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Sk } from "../ui/Skeleton";
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

export function useExplain(item: ItemRef) {
	const api = useApi();
	return useAsync(
		() => api.post<Explain>("/explain", { instanceId: item.instanceId, arrItemId: item.arrItemId, seasonNumber: item.seasonNumber ?? null }),
		[item.instanceId, item.arrItemId, item.seasonNumber],
	);
}

/** Per-rule, per-condition evaluation, fetched when it first appears (read-only, so no modal). */
export function ExplainPanel({ item }: { item: ItemRef }) {
	const { data, error } = useExplain(item);
	if (error) return <BadNotice>{error.message}</BadNotice>;
	if (!data) return <ExplainSkeleton />;
	return <ExplainBody e={data} />;
}

/** Same silhouette as <Outcome> plus a few <Verdict> cards (or, when `collapsed`, the <RuleDetails> row), so the section doesn't jump when data lands. */
export function ExplainSkeleton({ collapsed = false }: { collapsed?: boolean }) {
	return (
		<div className="explain" aria-busy="true" aria-label="Checking active rules">
			<div className="outcome"><Sk kind="outhead" /><Sk kind="line short" /></div>
			{collapsed ? <div className="rule-details"><Sk kind="rname" /></div> : [0, 1, 2].map((i) => (
				<div className="verdict" key={i}>
					<div className="row"><Sk kind="rname" /><span className="grow" /><Sk kind="rbadge" /></div>
				</div>
			))}
		</div>
	);
}

const DOES: Record<string, string> = { delete: "delete it from the library", delete_season: "delete this season", delete_files: "delete its files and keep the entry", unmonitor: "stop monitoring it" };
const list = (r: ExplainRule[]) => r.map((x) => x.name).join(", ");

/** The one-sentence answer: what would the active rules do to this item? Retention beats cleanup, as in a real run. */
export function Outcome({ e, manuallyProtected }: { e: Explain; manuallyProtected: boolean }) {
	const live = e.rules.filter((r) => r.inScope);
	const holds = live.filter((r) => r.mode === "retention" && r.state === "true");
	const hits = live.filter((r) => r.mode !== "retention" && r.state === "true");
	const unsure = live.filter((r) => r.state === "unknown");
	const [tone, icon, head, sub]: [string, "check" | "flagged" | "protected" | "unknown", string, string?] =
		manuallyProtected ? ["hold", "protected", "Protected by you", "Rules skip it, whatever they say."]
		: holds.length ? ["hold", "protected", `Kept by ${list(holds)}`, hits.length ? `${list(hits)} would otherwise ${DOES[hits[0]!.action] ?? "act on it"}.` : "Retention rules win over cleanup rules."]
		: hits.length ? ["flag", "flagged", `Would ${DOES[hits[0]!.action] ?? "be acted on"}`, `Matched by ${list(hits)}.`]
		: unsure.length ? ["warn", "unknown", "No match, but not certain", `${unsure.length === 1 ? "A rule" : `${unsure.length} rules`} couldn't be evaluated (${list(unsure)}). Missing evidence never matches.`]
		: live.length ? ["safe", "check", "Safe: no active rule matches", `${live.length} of ${e.rules.length} rules apply to it.`]
		: ["safe", "check", "No active rule applies to it", e.rules.length ? undefined : "There are no enabled rules."];
	return (
		<div className={`outcome ${tone}`} role="status">
			<p className="head"><Icon name={icon} />{head}</p>
			{sub ? <p className="sub">{sub}</p> : null}
		</div>
	);
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

/** Collapsed-by-default <ExplainBody>. */
export function RuleDetails({ e }: { e: Explain }) {
	return (
		<details className="rule-details">
			<summary>Rule details</summary>
			<ExplainBody e={e} facts={false} outOfScope={false} />
		</details>
	);
}

export function ExplainBody({ e, facts = true, outOfScope = true }: { e: Explain; facts?: boolean; outOfScope?: boolean }) {
	const out = e.rules.filter((r) => !r.inScope);
	return (
		<div className="explain">
			{facts ? <div className="itemfacts">
				<span>{e.item.seasonNumber != null ? `Season ${e.item.seasonNumber}` : kindLabel(e.item.kind)}</span>
				<span><b>{bytes(e.item.sizeOnDisk)}</b></span>
				<span>{e.item.monitored ? "Monitored" : "Unmonitored"}</span>
				{e.item.path ? <span className="mono">{e.item.path}</span> : null}
			</div> : null}
			<Notices items={e.warnings} />
			{e.rules.filter((r) => r.inScope).map((r, i) => <Verdict key={i} r={r} />)}
			{outOfScope && out.length ? <details className="out-of-scope"><summary className="help">{`${out.length} out of scope`}</summary>{out.map((r, i) => <Verdict key={i} r={r} />)}</details> : null}
		</div>
	);
}
