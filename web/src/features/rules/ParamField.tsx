import { useEffect, useRef } from "react";
import { fieldValue, unitOf, type ParamValue } from "../../lib/expression";
import type { FieldDef } from "../../types";

/** Dropdown of checkboxes; nothing ticked = any requester (optional). Saved names Seerr no longer lists are kept, so editing never silently drops them. */
function RequesterSelect({ field, value, requesters, onChange }: { field: FieldDef; value: string[]; requesters: string[]; onChange: (v: string[]) => void }) {
	const box = useRef<HTMLDetailsElement>(null);
	useEffect(() => {
		const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) box.current.open = false; };
		document.addEventListener("click", close);
		return () => document.removeEventListener("click", close);
	}, []);
	const has = (list: string[], n: string) => list.some((m) => m.toLowerCase() === n.toLowerCase());
	const names = [...requesters, ...value.filter((n) => !has(requesters, n))];
	return (
		<details ref={box} className="multi" aria-label={field.label}>
			<summary><span>{value.length ? value.join(", ") : field.placeholder || "Any requester"}</span></summary>
			<div className="menu">
				{names.map((n) => (
					<label key={n}>
						<input type="checkbox" value={n} checked={has(value, n)} onChange={(e) => onChange(e.target.checked ? [...value, n] : value.filter((v) => v.toLowerCase() !== n.toLowerCase()))} />{n}
					</label>
				))}
			</div>
		</details>
	);
}

export interface ParamFieldProps {
	field: FieldDef;
	value: ParamValue | undefined;
	requesters: string[];
	hidden: boolean;
	onChange: (v: ParamValue) => void;
}
/** One condition parameter, rendered as the control its kind calls for. */
export function ParamField({ field: f, value, requesters, hidden, onChange }: ParamFieldProps) {
	const v = fieldValue(f, value);
	const text = typeof v === "string" ? v : v.join(", ");
	const unit = f.kind === "number" ? unitOf(f.label) : null;
	let control;
	if (f.source === "requesters" && requesters.length) {
		control = <RequesterSelect field={f} value={Array.isArray(v) ? v : []} requesters={requesters} onChange={onChange} />;
	} else if (f.kind === "select") {
		control = <select aria-label={f.label} value={text} onChange={(e) => onChange(e.target.value)}>{f.options!.map((o) => <option key={o} value={o}>{o.replaceAll("_", " ")}</option>)}</select>;
	} else if (f.kind === "list") {
		control = <input aria-label={f.label} placeholder={f.placeholder || "comma separated"} value={text} onChange={(e) => onChange(e.target.value)} />;
	} else if (f.kind === "number") {
		control = <input aria-label={f.label} type="number" step="any" inputMode="decimal" placeholder={unit ? "" : f.label} value={text} onChange={(e) => onChange(e.target.value)} />;
	} else {
		control = <input aria-label={f.label} placeholder={f.label} value={text} onChange={(e) => onChange(e.target.value)} />;
	}
	return unit
		? <label className={`p unit ${f.kind}`} hidden={hidden}>{control}<span>{unit}</span></label>
		: <div className={`p ${f.kind}`} hidden={hidden}>{control}</div>;
}
