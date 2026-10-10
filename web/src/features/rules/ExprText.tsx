import { Fragment } from "react";
import { paramText } from "../../lib/expression";
import type { Expr, RuleTypeDef } from "../../types";

/** A rule expression as a readable sentence: bold condition names, AND / OR / NOT markers. */
export function ExprText({ expr, types }: { expr: Expr; types: RuleTypeDef[] }) {
	if ("type" in expr) {
		const def = types.find((x) => x.type === expr.type);
		return <><b>{def?.label || expr.type}</b>{" "}{paramText(def, expr.params)}</>;
	}
	if (expr.op === "not") return <><span className="op">NOT</span>{" "}<ExprText expr={expr.of} types={types} /></>;
	return (
		<>
			{expr.of.map((c, i) => {
				const nested = !("type" in c) && c.op !== "not";
				return (
					<Fragment key={i}>
						{i ? <>{" "}<span className="op">{expr.op.toUpperCase()}</span>{" "}</> : null}
						{nested ? <>(<ExprText expr={c} types={types} />)</> : <ExprText expr={c} types={types} />}
					</Fragment>
				);
			})}
		</>
	);
}
