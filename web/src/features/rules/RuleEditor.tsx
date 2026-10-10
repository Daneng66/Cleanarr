import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button } from "../../components/ui/Button";
import { DialogFrame } from "../../components/ui/DialogFrame";
import { Icon } from "../../components/ui/Icon";
import { Field } from "../../components/ui/Layout";
import { Segmented } from "../../components/ui/Segmented";
import { TitleRegexTip } from "../../components/media/TitleRegexTip";
import { buildable, DEFAULT_LEAF, friendlyIssue, groupToExpr, newGroup, type GroupNode } from "../../lib/expression";
import { splitList } from "../../lib/format";
import { useApi, usePreviewCache } from "../../providers/ApiProvider";
import { useDialog, useDialogCancel } from "../../providers/DialogProvider";
import { useShell } from "../../providers/ShellProvider";
import { useToast } from "../../providers/ToastProvider";
import type { CleanupAction, Expr, Instance, RuleMode, RuleRecord, RuleTemplate, RuleTypeDef, Service } from "../../types";
import { ConditionGroup } from "./ConditionGroup";

export interface RuleEditorProps {
	rule?: RuleRecord | null;
	template?: RuleTemplate | null;
	types: RuleTypeDef[];
	requesters: string[];
	instances: Instance[];
}

const ACTIONS: Array<[CleanupAction, string]> = [
	["delete", "Delete: remove from library and delete files"],
	["delete_files", "Delete files, keep in library"],
	["delete_season", "Delete season: one season's files, then unmonitor it (Sonarr)"],
	["unmonitor", "Unmonitor only (frees no space)"],
];
type Scope = "all" | Service;

/** Create or edit a rule: a nested condition builder (or raw JSON for what it can't show), scope, and exclusions. */
export function RuleEditor({ rule, template, types, requesters, instances }: RuleEditorProps) {
	const api = useApi();
	const cache = usePreviewCache();
	const dialog = useDialog();
	const toast = useToast();
	const shell = useShell();
	const uid = useId();

	const src = rule ?? (template ? { name: template.title, mode: template.mode, action: template.action, expression: template.expression, serviceFilter: template.serviceFilter, serviceLocked: template.serviceFilter?.length === 1, excludeTags: null, excludeTitles: null } : null);
	const exprIn = src?.expression;
	const seasonOnly = !!src?.serviceLocked && src.action === "delete_season"; // season template: the action is fixed too
	const locked: Service | null = src?.serviceLocked && src.serviceFilter?.length === 1 ? src.serviceFilter[0]! : null; // single-platform template: service is fixed

	const [name, setName] = useState(src?.name || "");
	const [mode, setMode] = useState<RuleMode>(src?.mode || "cleanup");
	const [action, setAction] = useState<CleanupAction>(src?.action || "delete");
	const [root, setRoot] = useState<GroupNode>(() => newGroup(exprIn && buildable(exprIn) ? exprIn : undefined));
	const [jsonMode, setJsonMode] = useState(!!exprIn && !buildable(exprIn));
	const [json, setJson] = useState(() => JSON.stringify(exprIn || DEFAULT_LEAF, null, 2));
	const [jsonErr, setJsonErr] = useState<string | null>(null);
	const [service, setService] = useState<Scope>(locked || (src?.serviceFilter?.length === 1 ? src.serviceFilter[0]! : "all"));
	const [tags, setTags] = useState((src?.excludeTags || []).join(", "));
	const [titleRx, setTitleRx] = useState((src?.excludeTitles || []).join(", "));
	const [nameErr, setNameErr] = useState<string | null>(null);
	const [errors, setErrors] = useState<string[] | null>(null);
	const [saving, setSaving] = useState(false);
	const [confirmingDiscard, setConfirmingDiscard] = useState(false);
	const closing = useRef(false);
	const errorsRef = useRef<HTMLDivElement>(null);
	const nameRef = useRef<HTMLInputElement>(null);
	const saveRef = useRef<HTMLButtonElement>(null);
	const keepRef = useRef<HTMLButtonElement>(null);

	const avail = useMemo(() => {
		const s = new Set<string>(instances.filter((i) => i.enabled && (i.type === "radarr" || i.type === "sonarr")).map((i) => i.type));
		src?.serviceFilter?.forEach((v) => s.add(v)); // keep a saved rule's current service selectable
		return s;
	}, [instances, src]);
	const serviceOptions = (["all", "radarr", "sonarr"] as const)
		.filter((v) => (locked ? v === locked : v === "all" ? avail.size > 1 : avail.has(v)))
		.map((v) => [v, v === "all" ? "All" : v === "radarr" ? "Radarr" : "Sonarr"] as const);

	/** The expression as currently edited; throws on invalid JSON. */
	const buildExpr = (): Expr => (jsonMode ? JSON.parse(json) : groupToExpr(root, types) || DEFAULT_LEAF);
	const snapshot = () => {
		let e: string;
		try { e = JSON.stringify(buildExpr()); } catch { e = json; }
		return JSON.stringify([name, mode, action, e, service, tags, titleRx]);
	};
	const initial = useRef<string>(undefined);
	initial.current ??= snapshot();

	const close = () => { closing.current = true; dialog.close(); };
	// Closing with unsaved edits asks first, in the footer, instead of silently discarding them.
	const requestClose = () => {
		if (closing.current || snapshot() === initial.current) return close();
		setConfirmingDiscard(true);
	};
	useDialogCancel((e) => { if (!closing.current) { e.preventDefault(); requestClose(); } });
	useEffect(() => { nameRef.current?.focus(); }, []);
	useEffect(() => { if (confirmingDiscard) keepRef.current?.focus(); }, [confirmingDiscard]);
	useEffect(() => { if (errors) { errorsRef.current?.scrollIntoView({ block: "nearest" }); errorsRef.current?.focus(); } }, [errors]);

	const toggleJson = () => {
		if (!jsonMode) {
			setJson(JSON.stringify(groupToExpr(root, types) || DEFAULT_LEAF, null, 2));
			setJsonErr(null);
			return setJsonMode(true);
		}
		// Back to the builder only when the JSON can be represented there; never drop the user's edits.
		let expr: Expr;
		try { expr = JSON.parse(json); } catch (x) { return setJsonErr(`Fix the JSON first: ${(x as Error).message}`); }
		if (!buildable(expr)) return setJsonErr("This expression negates a whole group, which the builder can't show. Keep editing it as JSON.");
		setJsonErr(null);
		setRoot(newGroup(expr));
		setJsonMode(false);
	};

	async function submit() {
		setErrors(null); setNameErr(null);
		if (!name.trim()) { setNameErr("Give the rule a name."); return nameRef.current?.focus(); }
		let expression: Expr;
		try { expression = buildExpr(); }
		catch (x) { if (jsonMode) return setJsonErr(`Invalid JSON: ${(x as Error).message}`); return setErrors([(x as Error).message]); }
		const body = { name: name.trim(), mode, action, expression, serviceFilter: service === "all" ? null : [service], serviceLocked: !!locked, excludeTags: splitList(tags), excludeTitles: splitList(titleRx) };
		setSaving(true);
		try {
			if (rule) await api.put(`/rules/${rule.id}`, body); else await api.post("/rules", body);
			cache.invalidate();
			close();
			toast.show(rule ? "Rule saved" : "Rule created");
			shell.navigate("rules");
		} catch (x) {
			setErrors((x as Error).message.split("\n").map(friendlyIssue(types)));
		} finally { setSaving(false); }
	}

	const protect = mode === "retention";
	const title = rule ? "Edit rule" : template ? `New rule: ${template.title}` : "New rule";
	const lede = template ? `${template.description} Adjust the numbers to taste, then preview on the dashboard.` : "Nothing changes until a run. Preview on the dashboard before trusting a new rule.";
	const section = (t: string, extra?: React.ReactNode) => <div className="form-section">{t}<span className="grow" />{extra}</div>;

	return (
		<DialogFrame title={title} lede={lede} onClose={requestClose}
			foot={<>
				<div className="foot-row" hidden={confirmingDiscard}>
					<Button onClick={requestClose}>Cancel</Button>
					<button ref={saveRef} type="button" className={`primary${saving ? " busy" : ""}`} disabled={saving} onClick={submit}>{rule ? "Save rule" : "Create rule"}</button>
				</div>
				<div className="foot-row confirm" hidden={!confirmingDiscard}>
					<span className="grow">Discard your changes?</span>
					<button ref={keepRef} type="button" onClick={() => { setConfirmingDiscard(false); saveRef.current?.focus(); }}>Keep editing</button>
					<Button className="danger solid" onClick={close}>Discard</Button>
				</div>
			</>}>
			<div ref={errorsRef} className="notice bad form-errors" role="alert" tabIndex={-1} hidden={!errors}>
				<Icon name="fault" />
				<div><strong>The rule wasn't saved</strong><ul>{errors?.map((l, i) => <li key={i}>{l}</li>)}</ul></div>
			</div>

			{section("Rule")}
			<div className="field">
				<label className="lbl" htmlFor={`${uid}-name`}>Name</label>
				<input id={`${uid}-name`} ref={nameRef} value={name} maxLength={100} placeholder="e.g. Old and unwatched" aria-describedby={`${uid}-nameErr`} aria-invalid={nameErr ? true : undefined}
					onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
				<div className="field-error" id={`${uid}-nameErr`} hidden={!nameErr}>{nameErr}</div>
			</div>
			<fieldset className="field">
				<legend className="lbl">Type</legend>
				<Segmented label="Rule type" options={[["cleanup", "Cleanup"], ["retention", "Protect"]]} value={mode} onChange={setMode} />
				<div className="help">{protect ? "Matching items are never touched by any cleanup rule." : "Matching items are flagged for the action below. The first matching cleanup rule wins."}</div>
			</fieldset>
			<div className="field" hidden={protect}>
				<label className="lbl" htmlFor={`${uid}-action`}>Action</label>
				<select id={`${uid}-action`} value={action} disabled={seasonOnly} onChange={(e) => setAction(e.target.value as CleanupAction)}>
					{ACTIONS.filter(([v]) => !seasonOnly || v === "delete_season").map(([v, l]) => <option key={v} value={v}>{l}</option>)}
				</select>
			</div>

			{section("Conditions", <Button icon="code" className="small ghost" onClick={toggleJson}>{jsonMode ? "Use builder" : "Edit as JSON"}</Button>)}
			<div hidden={jsonMode}>
				<ConditionGroup node={root} depth={0} types={types} requesters={requesters} onChange={setRoot} />
			</div>
			<div hidden={!jsonMode}>
				<p className="help" style={{ marginTop: 0 }}>{'For nested logic: {op: "and" | "or" | "not", of: …} groups around {type, params} conditions.'}</p>
				<textarea rows={14} aria-label="Expression JSON" value={json} onChange={(e) => setJson(e.target.value)} />
				<div className="field-error" hidden={!jsonErr}>{jsonErr}</div>
			</div>

			{section("Scope")}
			<fieldset className="field">
				<legend className="lbl">Services</legend>
				<Segmented label="Services" options={serviceOptions} value={service} onChange={setService} disabled={!!locked} />
				<div className="help">Which library this rule looks at.</div>
			</fieldset>
			{section("Ignore")}
			<Field label="Ignore tags" htmlFor={`${uid}-tags`} help="Sonarr/Radarr tag labels, comma separated.">
				<input id={`${uid}-tags`} value={tags} placeholder="e.g. keep" onChange={(e) => setTags(e.target.value)} />
			</Field>
			<div className="field">
				<div className="lbl-row"><label className="lbl" htmlFor={`${uid}-rx`}>Ignore titles</label><TitleRegexTip /></div>
				<input id={`${uid}-rx`} value={titleRx} placeholder="e.g. ^Star Wars" onChange={(e) => setTitleRx(e.target.value)} />
				<div className="help">Regular expressions, comma separated.</div>
			</div>
		</DialogFrame>
	);
}
