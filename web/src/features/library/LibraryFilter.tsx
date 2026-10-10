import { Button } from "../../components/ui/Button";
import { TitleRegexTip } from "../../components/media/TitleRegexTip";
import { DEFAULT_LEAF, newCond, type CondNode } from "../../lib/expression";
import type { RuleTypeDef } from "../../types";
import { ConditionRow } from "../rules/ConditionRow";

/** The editable filter: the same conditions and scope as a rule. No conditions = the whole library. */
export interface FilterState {
	op: "and" | "or";
	conds: CondNode[];
	tags: string;
	titleRx: string;
}
export const emptyFilter: FilterState = { op: "and", conds: [], tags: "", titleRx: "" };

export function LibraryFilter({ value, onChange, onApply, types, requesters }: { value: FilterState; onChange: (f: FilterState) => void; onApply: () => Promise<unknown>; types: RuleTypeDef[]; requesters: string[] }) {
	const set = (patch: Partial<FilterState>) => onChange({ ...value, ...patch });
	return (
		<details className="panel lib-filter">
			<summary>Filter</summary>
			<div className="lib-filter-body">
				<div className="combine" hidden={value.conds.length < 2}>
					Match when
					<select aria-label="Combine conditions" value={value.op} onChange={(e) => set({ op: e.target.value as "and" | "or" })}>
						<option value="and">all</option><option value="or">any</option>
					</select>
					of these are true
				</div>
				<div>
					{value.conds.map((c, i) => (
						<ConditionRow key={c.id} node={c} types={types} requesters={requesters}
							onChange={(n) => set({ conds: value.conds.map((x, j) => (j === i ? n : x)) })}
							onRemove={() => set({ conds: value.conds.filter((_, j) => j !== i) })} />
					))}
				</div>
				<div className="row"><Button icon="plus" onClick={() => set({ conds: [...value.conds, newCond(DEFAULT_LEAF)] })}>Add condition</Button></div>
				<div className="cols">
					<div className="field"><div className="lbl">Exclude tags</div><input placeholder="e.g. keep" aria-label="Exclude tags" value={value.tags} onChange={(e) => set({ tags: e.target.value })} /></div>
					<div className="field">
						<div className="lbl-row"><div className="lbl">Exclude titles (regex)</div><TitleRegexTip /></div>
						<input placeholder="e.g. ^Star Wars" aria-label="Exclude title patterns" value={value.titleRx} onChange={(e) => set({ titleRx: e.target.value })} />
					</div>
				</div>
				<div className="row end"><Button icon="refresh" className="primary" onAction={onApply}>Apply filter</Button></div>
			</div>
		</details>
	);
}
