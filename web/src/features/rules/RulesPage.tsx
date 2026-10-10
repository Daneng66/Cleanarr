import { useRef, useState } from "react";
import { AsyncView } from "../../components/ui/AsyncView";
import { Button, IconButton } from "../../components/ui/Button";
import { Empty } from "../../components/ui/Feedback";
import { Menu } from "../../components/ui/Menu";
import { Panel, PageHead, SectionTitle } from "../../components/ui/Layout";
import { RuleKindTag, ServiceTag } from "../../components/ui/Tags";
import { useAsync } from "../../hooks/useAsync";
import { useApi, usePreviewCache } from "../../providers/ApiProvider";
import { useCatalog } from "../../providers/CatalogProvider";
import { useDialog } from "../../providers/DialogProvider";
import { useShell } from "../../providers/ShellProvider";
import { useToast } from "../../providers/ToastProvider";
import type { Instance, RuleRecord, RuleTemplate, RuleTypeDef } from "../../types";
import { ExprText } from "./ExprText";
import { TemplatesSection } from "./TemplatesSection";
import { useRuleEditor } from "./useRuleEditor";

interface Data {
	rules: RuleRecord[];
	types: RuleTypeDef[];
	templates: RuleTemplate[];
	instances: Instance[];
}

export function RulesPage() {
	const api = useApi();
	const catalog = useCatalog();
	const state = useAsync<Data>(async () => {
		const [rules, types, templates, instances] = await Promise.all([api.get<RuleRecord[]>("/rules"), catalog.types(), api.get<RuleTemplate[]>("/rule-templates"), api.get<Instance[]>("/instances")]);
		return { rules, types, templates, instances };
	}, []);
	return <AsyncView state={state}>{(d) => <Rules {...d} />}</AsyncView>;
}

function Rules({ rules, types, templates, instances }: Data) {
	const api = useApi();
	const cache = usePreviewCache();
	const dialog = useDialog();
	const toast = useToast();
	const shell = useShell();
	const editRule = useRuleEditor();
	const cleanup = rules.filter((r) => r.mode !== "retention"), protect = rules.filter((r) => r.mode === "retention");

	const changed = () => { cache.rerun(); shell.reload(); };
	const move = async (list: RuleRecord[], i: number, d: number) => {
		const g = list.map((r) => r.id);
		[g[i], g[i + d]] = [g[i + d]!, g[i]!];
		const ids = list === protect ? [...cleanup.map((r) => r.id), ...g] : [...g, ...protect.map((r) => r.id)];
		try { await api.put("/rules/reorder", { ids }); changed(); } catch (e) { toast.fail(e); }
	};
	const remove = async (r: RuleRecord) => {
		if (!(await dialog.confirm({ title: `Delete “${r.name}”?`, text: "The rule is removed. Its history stays in the audit trail.", action: "Delete rule", danger: true }))) return;
		try { await api.delete(`/rules/${r.id}`); changed(); } catch (e) { toast.fail(e); }
	};
	const useTemplate = (t: RuleTemplate) => editRule(null, t);
	const fileInput = useRef<HTMLInputElement>(null);
	const importRules = async (file: File) => {
		let items: unknown[];
		try {
			const data = JSON.parse(await file.text());
			items = Array.isArray(data) ? data : [data];
			if (!items.length || items.some((x) => !x || typeof x !== "object")) throw new Error();
		} catch { toast.fail(new Error("That file isn't a rule or a list of rules.")); return; }
		let ok = 0;
		const failed: string[] = [];
		for (const x of items as Array<Record<string, unknown>>) {
			try { await api.post("/rules", pick(x)); ok++; } catch (e) { failed.push(`${String(x.name ?? "Unnamed")}: ${e instanceof Error ? e.message.split("\n")[0] : e}`); }
		}
		if (ok) changed();
		if (failed.length) toast.fail(new Error(`Imported ${ok}, skipped ${failed.length}. ${failed[0]}`));
		else toast.show(`Imported ${ok} rule${ok === 1 ? "" : "s"}`);
	};
	const exportRules = (list: RuleRecord[], name: string) => {
		downloadJson(name, list.map(portable));
		toast.show(`Exported ${list.length} rule${list.length === 1 ? "" : "s"}`);
	};

	return (
		<div>
			<PageHead title="Rules" lede="Evaluated top to bottom. The first matching cleanup rule decides what happens; protect rules always win."
				actions={<div className="row" style={{ gap: 8 }}>
						<Button icon="plus" onClick={() => editRule()}>Blank rule</Button>
						<Menu label="More rule actions" items={[
							{ label: "Import rules", icon: "upload", onSelect: () => fileInput.current?.click() },
							{ label: "Export all rules", icon: "download", disabled: !rules.length, onSelect: () => exportRules(rules, "cleanarr-rules") },
						]} />
						<input ref={fileInput} type="file" accept="application/json,.json" hidden
							onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void importRules(f); }} />
					</div>} />
			{!rules.length
				? <Panel><Empty title="No rules yet" text="Pick a template from the library below, or write your own. The dashboard previews exactly what a rule would match before anything changes." /></Panel>
				: <>
					<RuleSection title="Cleanup rules" sub="The first matching rule decides the action." list={cleanup} types={types} onMove={move} onEdit={(r) => editRule(r)} onDuplicate={(r) => editRule(r, null, true)} onExport={(r) => exportRules([r], slug(r.name))} onRemove={remove} />
					<RuleSection title="Protect rules" sub="Matching titles are never touched by a cleanup rule." list={protect} types={types} onMove={move} onEdit={(r) => editRule(r)} onDuplicate={(r) => editRule(r, null, true)} onExport={(r) => exportRules([r], slug(r.name))} onRemove={remove} />
				</>}
			<TemplatesSection templates={templates} instances={instances} types={types} onUse={useTemplate} />
		</div>
	);
}

interface SectionProps {
	title: string;
	sub: string;
	list: RuleRecord[];
	types: RuleTypeDef[];
	onMove: (list: RuleRecord[], i: number, d: number) => void;
	onEdit: (r: RuleRecord) => void;
	onDuplicate: (r: RuleRecord) => void;
	onExport: (r: RuleRecord) => void;
	onRemove: (r: RuleRecord) => void;
}
function RuleSection({ title, sub, list, types, onMove, onEdit, onDuplicate, onExport, onRemove }: SectionProps) {
	if (!list.length) return null;
	return (
		<>
			<SectionTitle title={title} grow={false}><span className="faint small">{sub}</span></SectionTitle>
			<Panel>
				<ul className="rules">
					{list.map((r, i) => <RuleRow key={r.id} rule={r} index={i} last={i === list.length - 1} types={types} onMove={(d) => onMove(list, i, d)} onEdit={() => onEdit(r)} onDuplicate={() => onDuplicate(r)} onExport={() => onExport(r)} onRemove={() => onRemove(r)} />)}
				</ul>
			</Panel>
		</>
	);
}

interface RowProps {
	rule: RuleRecord;
	index: number;
	last: boolean;
	types: RuleTypeDef[];
	onMove: (d: number) => void;
	onEdit: () => void;
	onDuplicate: () => void;
	onExport: () => void;
	onRemove: () => void;
}
function RuleRow({ rule: r, index: i, last, types, onMove, onEdit, onDuplicate, onExport, onRemove }: RowProps) {
	const api = useApi();
	const cache = usePreviewCache();
	const toast = useToast();
	// Optimistic: flips immediately, reverts if the save fails.
	const [enabled, setEnabled] = useState(r.enabled);
	const toggle = async (on: boolean) => {
		setEnabled(on);
		try { await api.put(`/rules/${r.id}`, { enabled: on }); cache.rerun(); } catch (e) { setEnabled(!on); toast.fail(e); }
	};
	return (
		<li className={enabled ? "" : "off"}>
			<div className="slotno" title={`Priority ${i + 1}`}>{String(i + 1).padStart(2, "0")}</div>
			<input type="checkbox" className="toggle" checked={enabled} aria-label={`${r.name} enabled`} onChange={(e) => toggle(e.target.checked)} />
			<div className="body">
				<div className="nm"><strong>{r.name}</strong><RuleKindTag mode={r.mode} action={r.action} />{r.serviceFilter?.map((s) => <ServiceTag key={s} service={s} />)}</div>
				<div className="expr"><ExprText expr={r.expression} types={types} /></div>
			</div>
			<div className="acts">
				<IconButton icon="edit" label={`Edit ${r.name}`} className="ghost" onClick={onEdit} />
				<Menu label={`More actions for ${r.name}`} items={[
					{ label: "Move up", icon: "up", disabled: i === 0, onSelect: () => onMove(-1) },
					{ label: "Move down", icon: "down", disabled: last, onSelect: () => onMove(1) },
					{ label: "Duplicate", icon: "copy", onSelect: onDuplicate },
					{ label: "Export JSON", icon: "download", onSelect: onExport },
					"-",
					{ label: "Delete", icon: "trash", danger: true, onSelect: onRemove },
				]} />
			</div>
		</li>
	);
}

const slug = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "rule";

/** The rule as the create API accepts it: no id, no runtime state, so the file round-trips. */
const FIELDS = ["name", "mode", "action", "actions", "expression", "serviceFilter", "excludeTags", "excludeTitles"] as const;
const pick = (x: Record<string, unknown>) => Object.fromEntries(FIELDS.filter((k) => x[k] !== undefined).map((k) => [k, x[k]]));
const portable = (r: RuleRecord) => ({ name: r.name, mode: r.mode, action: r.action, ...(r.actions && { actions: r.actions }), expression: r.expression, serviceFilter: r.serviceFilter, excludeTags: r.excludeTags, excludeTitles: r.excludeTitles });

function downloadJson(name: string, data: unknown) {
	const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
	Object.assign(document.createElement("a"), { href: url, download: `${name}.json` }).click();
	URL.revokeObjectURL(url);
}
