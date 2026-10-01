import { RULE_TYPES, type Eval, type EvalContext, type Tri } from "./registry.js";
import type { LibraryItem } from "../types.js";

export const MAX_DEPTH = 8;
export const MAX_NODES = 100;

export type Expression =
	| { type: string; params: Record<string, unknown> }
	| { op: "and" | "or"; of: Expression[] }
	| { op: "not"; of: Expression };

export class ExpressionError extends Error {
	constructor(readonly issues: string[]) {
		super(issues.join("; "));
	}
}

/** Validates a raw rule expression (structure, limits and per-type params) and returns the normalised tree. */
export function parseExpression(raw: unknown): Expression {
	const issues: string[] = [];
	let nodes = 0;
	function walk(node: unknown, path: string, depth: number): Expression | null {
		if (++nodes > MAX_NODES) {
			issues.push(`${path}: more than ${MAX_NODES} nodes`);
			return null;
		}
		if (depth > MAX_DEPTH) {
			issues.push(`${path}: deeper than ${MAX_DEPTH} levels`);
			return null;
		}
		if (typeof node !== "object" || node === null) {
			issues.push(`${path}: expected an object`);
			return null;
		}
		const n = node as Record<string, unknown>;
		if (n.op === "and" || n.op === "or") {
			if (!Array.isArray(n.of) || n.of.length === 0) {
				issues.push(`${path}: "${n.op}" needs a non-empty "of" array`);
				return null;
			}
			const kids = n.of.map((c, i) => walk(c, `${path}.of[${i}]`, depth + 1));
			return kids.every(Boolean) ? { op: n.op, of: kids as Expression[] } : null;
		}
		if (n.op === "not") {
			const kid = walk(n.of, `${path}.of`, depth + 1);
			return kid ? { op: "not", of: kid } : null;
		}
		if (typeof n.type === "string") {
			const def = RULE_TYPES.get(n.type);
			if (!def) {
				issues.push(`${path}: unknown rule type "${n.type}"`);
				return null;
			}
			const parsed = def.schema.safeParse(n.params ?? {});
			if (!parsed.success) {
				for (const i of parsed.error.issues) issues.push(`${path}(${n.type}).${i.path.join(".") || "params"}: ${i.message}`);
				return null;
			}
			return { type: n.type, params: parsed.data };
		}
		issues.push(`${path}: expected {type, params}, {op:"and"|"or", of:[...]} or {op:"not", of}`);
		return null;
	}
	const tree = walk(raw, "$", 1);
	if (!tree || issues.length) throw new ExpressionError(issues.length ? issues : ["Invalid expression"]);
	return tree;
}

export function requirements(expr: Expression): { files: boolean; watch: boolean; seerr: boolean } {
	const out = { files: false, watch: false, seerr: false };
	const visit = (e: Expression) => {
		if ("type" in e) {
			const needs = RULE_TYPES.get(e.type)?.needs;
			if (needs === "files") out.files = true;
			if (needs === "watch" || needs === "watch+seerr") out.watch = true;
			if (needs === "seerr" || needs === "watch+seerr") out.seerr = true;
		} else {
			for (const c of Array.isArray(e.of) ? e.of : [e.of]) visit(c);
		}
	};
	visit(expr);
	return out;
}

export interface EvalNode extends Eval {
	children?: EvalNode[];
	/** Leaves carry the rule type; groups carry their operator (for explain output). */
	type?: string;
	op?: "and" | "or" | "not";
}

/**
 * Three-valued evaluation. "unknown" means required evidence is missing; a rule only
 * matches on "true", so missing data can never cause a removal.
 */
export function evaluateExpression(expr: Expression, item: LibraryItem, ctx: EvalContext): EvalNode {
	if ("type" in expr) {
		const def = RULE_TYPES.get(expr.type);
		if (!def) return { state: "unknown", reason: `Unknown rule type ${expr.type}`, type: expr.type };
		return { ...def.evaluate(item, expr.params, ctx), type: expr.type };
	}
	if (expr.op === "not") {
		const inner = evaluateExpression(expr.of, item, ctx);
		const state: Tri = inner.state === "unknown" ? "unknown" : inner.state === "true" ? "false" : "true";
		return { state, reason: `NOT (${inner.reason})`, children: [inner], op: "not" };
	}
	const kids = expr.of.map((c) => evaluateExpression(c, item, ctx));
	const has = (s: Tri) => kids.some((k) => k.state === s);
	let state: Tri;
	if (expr.op === "and") state = has("false") ? "false" : has("unknown") ? "unknown" : "true";
	else state = has("true") ? "true" : has("unknown") ? "unknown" : "false";
	const sel = state === "true" && expr.op === "or" ? kids.filter((k) => k.state === "true") : kids;
	const reason = sel.map((k) => k.reason).join(expr.op === "and" ? " AND " : " OR ");
	return { state, reason: sel.length > 1 ? `(${reason})` : reason, children: kids, op: expr.op };
}
