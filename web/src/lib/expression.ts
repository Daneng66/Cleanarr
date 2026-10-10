import type { Expr, FieldDef, Leaf, RuleTypeDef } from "../types";

export const DEFAULT_LEAF: Leaf = { type: "age", params: { operator: "older_than", days: 365 } };

export const isLeaf = (e: Expr): e is Leaf => "type" in e;

/** What the builder can show: conditions (optionally negated) inside nested AND / OR groups. NOT around a whole group needs JSON. */
export function buildable(e: Expr | null | undefined): boolean {
	if (!e) return false;
	if (isLeaf(e)) return true;
	if (e.op === "not") return isLeaf(e.of);
	return (e.op === "and" || e.op === "or") && Array.isArray(e.of) && e.of.every(buildable);
}

// ── Editable tree: raw field text so a half-typed value never gets coerced ──
export type ParamValue = string | string[];
export interface CondNode {
	kind: "cond";
	id: string;
	negate: boolean;
	type: string;
	params: Record<string, ParamValue>;
}
export interface GroupNode {
	kind: "group";
	id: string;
	op: "and" | "or";
	kids: Node[];
}
export type Node = CondNode | GroupNode;

let seq = 0;
export const nodeId = () => `n${++seq}`;

const toParam = (v: unknown): ParamValue => (Array.isArray(v) ? v.map(String) : v == null ? "" : String(v));
export function newCond(leaf: Leaf = DEFAULT_LEAF, negate = false): CondNode {
	return { kind: "cond", id: nodeId(), negate, type: leaf.type, params: Object.fromEntries(Object.entries(leaf.params || {}).map(([k, v]) => [k, toParam(v)])) };
}
export function newGroup(expr: Expr | null | undefined): GroupNode {
	const op = expr && !isLeaf(expr) && expr.op === "or" ? "or" : "and";
	const items: Expr[] = !expr ? [DEFAULT_LEAF] : isLeaf(expr) || expr.op === "not" ? [expr] : expr.of;
	return { kind: "group", id: nodeId(), op, kids: items.map(toNode) };
}
function toNode(e: Expr): Node {
	if (isLeaf(e)) return newCond(e);
	if (e.op === "not") return newCond(e.of as Leaf, true);
	return newGroup(e);
}

/** Reads one condition's field text back into typed params, skipping blank and operator-hidden fields. */
export function readParams(cond: CondNode, def: RuleTypeDef | undefined): Record<string, unknown> {
	const p: Record<string, unknown> = {};
	if (!def) return p;
	const operator = def.fields.some((f) => f.name === "operator") ? fieldValue(def.fields.find((f) => f.name === "operator")!, cond.params.operator) : undefined;
	for (const f of def.fields) {
		if (operator && f.hideFor?.includes(operator as string)) continue;
		const raw = fieldValue(f, cond.params[f.name]);
		if (Array.isArray(raw)) { if (raw.length) p[f.name] = raw; continue; }
		const v = raw.trim();
		if (f.kind === "number") { if (v !== "") p[f.name] = Number(v); }
		else if (f.kind === "list") { const l = v.split(",").map((s) => s.trim()).filter(Boolean); if (l.length) p[f.name] = l; }
		else if (v !== "") p[f.name] = v;
	}
	return p;
}
/** Selects with no explicit choice read as their first option, like the control shows. */
export function fieldValue(f: FieldDef, v: ParamValue | undefined): ParamValue {
	if (v !== undefined && !(f.kind === "select" && v === "")) return v;
	return f.kind === "select" ? f.options?.[0] ?? "" : "";
}

export function condToExpr(c: CondNode, types: RuleTypeDef[]): Expr {
	const leaf: Leaf = { type: c.type, params: readParams(c, types.find((t) => t.type === c.type)) };
	return c.negate ? { op: "not", of: leaf } : leaf;
}
/** An expression, or null when the group is empty. */
export function groupToExpr(g: GroupNode, types: RuleTypeDef[]): Expr | null {
	const list = g.kids.map((k) => (k.kind === "group" ? groupToExpr(k, types) : condToExpr(k, types))).filter((x): x is Expr => !!x);
	return !list.length ? null : list.length === 1 ? list[0]! : { op: g.op, of: list };
}

// ── Reading ──
const fmt = (v: unknown) => (Array.isArray(v) ? (v.length > 1 ? `${v.slice(0, -1).join(", ")} or ${v.at(-1)}` : v.join("")) : String(v).replaceAll("_", " ").replace(/ in days$/, " in"));
export function paramText(def: RuleTypeDef | undefined, params: Record<string, unknown>): string {
	if (!def) return Object.values(params).map(fmt).join(" ");
	return def.fields.filter((f) => params[f.name] != null).map((f) => {
		const v = params[f.name];
		if (f.kind !== "number") return fmt(v);
		if (/\(GB\)/.test(f.label)) return `${v} GB`;
		if (/^\w+s$/.test(f.label)) return `${v} ${f.label.toLowerCase()}`;
		return `${f.label.replace(/\s*\(.*\)/, "").toLowerCase()} ${v}`;
	}).join(" ");
}
/** "Days" → "days", "Size (GB)" → "GB", "Plays" → "plays": shown inside the number box so the row reads as a sentence. */
export const unitOf = (label: string) => /\((GB|MB)\)/.exec(label)?.[1] || (/\(0.10\)/.test(label) ? "/ 10" : null) || (/^[A-Z][a-z]+s$/.test(label) ? label.toLowerCase() : null);
/** "expression: $(size).sizeGb: Too small…" → "Size on disk › Size (GB): Too small…" */
export const friendlyIssue = (types: RuleTypeDef[]) => (line: string) =>
	line.replace(/^expression[.\w]*: /, "").replace(/^body: /, "").replace(/\$\((\w+)\)\.?(\w*)/, (_, t: string, f: string) => {
		const def = types.find((x) => x.type === t);
		return [def?.label || t, def?.fields.find((x) => x.name === f)?.label || f].filter(Boolean).join(" › ");
	});
