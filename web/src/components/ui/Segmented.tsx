import { useId } from "react";

export interface SegmentedProps<V extends string> {
	label: string;
	options: ReadonlyArray<readonly [V, string]>;
	value: V;
	onChange: (v: V) => void;
	disabled?: boolean;
	className?: string;
}

/** Segmented single choice built on native radios, so keyboard and screen readers get radio semantics. */
export function Segmented<V extends string>({ label, options, value, onChange, disabled, className = "" }: SegmentedProps<V>) {
	const name = useId();
	return (
		<div className={`seg ${className}`.trim()} role="radiogroup" aria-label={label}>
			{options.map(([v, l]) => (
				<label key={v}>
					<input type="radio" name={name} value={v} checked={v === value} disabled={disabled} onChange={() => onChange(v)} />
					<span>{l}</span>
				</label>
			))}
		</div>
	);
}
