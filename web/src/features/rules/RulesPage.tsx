import { useState } from "react";
import { AsyncView } from "../../components/ui/AsyncView";
import { Button, IconButton } from "../../components/ui/Button";
import { Empty } from "../../components/ui/Feedback";
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

	const changed = () => { cache.invalidate(); shell.reload(); };
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
	const scrollToTemplates = () => {
		const t = document.getElementById("templates");
		t?.scrollIntoView({ behavior: "smooth" });
		(t?.querySelector("button.primary") as HTMLElement | null)?.focus({ preventScroll: true });
	};

	return (
		<div>
			<PageHead title="Rules" lede="Evaluated top to bottom. The first matching cleanup rule decides what happens; protect rules always win."
				actions={<div className="row" style={{ gap: 8 }}>
					<Button icon="plus" onClick={() => editRule()}>Blank rule</Button>
					<Button className="primary" onClick={scrollToTemplates}>Add from template</Button>
				</div>} />
			{!rules.length
				? <Panel><Empty title="No rules yet" text="Pick a template from the library below, or write your own. The dashboard previews exactly what a rule would match before anything changes." /></Panel>
				: <>
					<RuleSection title="Cleanup rules" sub="The first matching rule decides the action." list={cleanup} types={types} onMove={move} onEdit={(r) => editRule(r)} onRemove={remove} />
					<RuleSection title="Protect rules" sub="Matching titles are never touched by a cleanup rule." list={protect} types={types} onMove={move} onEdit={(r) => editRule(r)} onRemove={remove} />
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
	onRemove: (r: RuleRecord) => void;
}
function RuleSection({ title, sub, list, types, onMove, onEdit, onRemove }: SectionProps) {
	if (!list.length) return null;
	return (
		<>
			<SectionTitle title={title} grow={false}><span className="faint small">{sub}</span></SectionTitle>
			<Panel>
				<ul className="rules">
					{list.map((r, i) => <RuleRow key={r.id} rule={r} index={i} last={i === list.length - 1} types={types} onMove={(d) => onMove(list, i, d)} onEdit={() => onEdit(r)} onRemove={() => onRemove(r)} />)}
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
	onRemove: () => void;
}
function RuleRow({ rule: r, index: i, last, types, onMove, onEdit, onRemove }: RowProps) {
	const api = useApi();
	const cache = usePreviewCache();
	const toast = useToast();
	// Optimistic: flips immediately, reverts if the save fails.
	const [enabled, setEnabled] = useState(r.enabled);
	const toggle = async (on: boolean) => {
		setEnabled(on);
		try { await api.put(`/rules/${r.id}`, { enabled: on }); cache.invalidate(); } catch (e) { setEnabled(!on); toast.fail(e); }
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
				<IconButton icon="up" label="Move up" className="ghost" disabled={i === 0} onClick={() => onMove(-1)} />
				<IconButton icon="down" label="Move down" className="ghost" disabled={last} onClick={() => onMove(1)} />
				<IconButton icon="edit" label={`Edit ${r.name}`} className="ghost" onClick={onEdit} />
				<IconButton icon="trash" label={`Delete ${r.name}`} className="ghost danger" onClick={onRemove} />
			</div>
		</li>
	);
}
