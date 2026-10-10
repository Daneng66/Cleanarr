import { Button, IconButton } from "../../components/ui/Button";
import { DEFAULT_LEAF, newCond, newGroup, type GroupNode, type Node } from "../../lib/expression";
import type { RuleTypeDef } from "../../types";
import { ConditionRow } from "./ConditionRow";

export interface ConditionGroupProps {
	node: GroupNode;
	depth: number;
	types: RuleTypeDef[];
	requesters: string[];
	onChange: (n: GroupNode) => void;
	onRemove?: () => void;
}

/** A group of conditions and nested sub-groups joined by all (AND) / any (OR). */
export function ConditionGroup({ node, depth, types, requesters, onChange, onRemove }: ConditionGroupProps) {
	const setKid = (i: number, k: Node) => onChange({ ...node, kids: node.kids.map((x, j) => (j === i ? k : x)) });
	const removeKid = (i: number) => onChange({ ...node, kids: node.kids.filter((_, j) => j !== i) });
	const add = (k: Node) => onChange({ ...node, kids: [...node.kids, k] });
	// The top level always keeps at least one condition.
	const lastOne = !depth && node.kids.length === 1;
	return (
		<div className={depth ? "grp sub" : "grp"} data-op={node.op}>
			<div className="grp-head combine">
				Match when
				<select aria-label="Combine conditions" value={node.op} onChange={(e) => onChange({ ...node, op: e.target.value as "and" | "or" })}>
					<option value="and">all</option><option value="or">any</option>
				</select>
				of these are true
				<span className="grow" />
				{depth && onRemove ? <IconButton icon="x" label="Remove group" className="ghost rm" onClick={onRemove} /> : null}
			</div>
			<div className="grp-kids">
				{node.kids.map((k, i) => k.kind === "group"
					? <ConditionGroup key={k.id} node={k} depth={depth + 1} types={types} requesters={requesters} onChange={(g) => setKid(i, g)} onRemove={() => removeKid(i)} />
					: <ConditionRow key={k.id} node={k} types={types} requesters={requesters} onChange={(c) => setKid(i, c)} onRemove={() => removeKid(i)} removeDisabled={lastOne} />)}
			</div>
			<div className="grp-add">
				<Button icon="plus" className="small ghost" onClick={() => add(newCond(DEFAULT_LEAF))}>Add condition</Button>
				{depth < 3 ? <Button icon="plus" className="small ghost" onClick={() => add(newGroup({ op: "or", of: [DEFAULT_LEAF] }))}>Add group</Button> : null}
			</div>
		</div>
	);
}
