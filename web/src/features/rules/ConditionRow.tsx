import { IconButton } from "../../components/ui/Button";
import type { CondNode, ParamValue } from "../../lib/expression";
import type { RuleTypeDef } from "../../types";
import { ParamField } from "./ParamField";

export interface ConditionRowProps {
	node: CondNode;
	types: RuleTypeDef[];
	requesters: string[];
	onChange: (n: CondNode) => void;
	onRemove: () => void;
	removeDisabled?: boolean;
}

/** One condition: optional NOT, the rule type, and that type's parameters. */
export function ConditionRow({ node, types, requesters, onChange, onRemove, removeDisabled }: ConditionRowProps) {
	const def = types.find((t) => t.type === node.type);
	const groups = [...new Set(types.map((t) => t.group))];
	// Hide fields the chosen operator doesn't use (e.g. ratings for "suitable for kids").
	const operator = def?.fields.some((f) => f.name === "operator") ? (node.params.operator as string | undefined) ?? def.fields.find((f) => f.name === "operator")!.options?.[0] : undefined;
	const set = (name: string, v: ParamValue) => onChange({ ...node, params: { ...node.params, [name]: v } });
	const solo = !def?.fields.some((f) => !f.hideFor?.includes(operator ?? ""));
	return (
		<div className={`cond${solo ? " solo" : ""}`}>
			<button type="button" className="neg" aria-pressed={node.negate} title="Match items where this condition is NOT true" onClick={() => onChange({ ...node, negate: !node.negate })}>Not</button>
			<select aria-label="Condition" value={node.type} onChange={(e) => onChange({ ...node, type: e.target.value, params: {} })}>
				{groups.map((g) => (
					<optgroup key={g} label={g}>{types.filter((t) => t.group === g).map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}</optgroup>
				))}
			</select>
			{!solo && (
				<div className="params">
					{def?.fields.map((f) => (
						<ParamField key={`${node.type}:${f.name}`} field={f} value={node.params[f.name]} requesters={requesters}
							hidden={!!operator && !!f.hideFor?.includes(operator)} onChange={(v) => set(f.name, v)} />
					))}
				</div>
			)}
			<IconButton icon="x" label="Remove condition" className="ghost rm" onClick={onRemove} disabled={removeDisabled} />
			<div className="hint">{def?.description}</div>
		</div>
	);
}
