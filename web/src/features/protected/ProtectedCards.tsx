import { useState } from "react";
import { OpenInArrButton } from "../../components/media/LinkButtons";
import { SkipCard, SkipTitle } from "../../components/media/ItemBits";
import { ProtectToggle, type ToggleOps } from "../../components/media/ProtectButtons";
import { ActionTag } from "../../components/ui/Tags";
import { bytes, nameOf } from "../../lib/format";
import { parseKeptBy } from "../../lib/protection";
import type { ItemRef, RunDetail } from "../../types";

/** The reason a title is safe, as a labelled block: retention rule name first, its matching condition under it. */
export function KeptBy({ message }: { message: string }) {
	const x = parseKeptBy(message);
	return (
		<div className="kept">
			{x ? <><span className="k">Kept by</span><strong>{x.rule}</strong>{x.condition ? <span className="c">{x.condition}</span> : null}</> : <strong>{message}</strong>}
		</div>
	);
}

const Foot = ({ item, toggle, name, size, onToggle }: { item: ItemRef; toggle: ToggleOps; name: string; size?: number; onToggle: (on: boolean) => void }) => (
	<div className="foot">
		<div className="foot-left"><span className="row-acts"><OpenInArrButton item={item} /><ProtectToggle name={name} ops={toggle} onChange={onToggle} /></span></div>
		{size ? <span className="sz">{bytes(size)}</span> : null}
	</div>
);

export interface PickProps {
	checked: boolean;
	onChange: (on: boolean) => void;
}
const PickBox = ({ item, checked, onChange }: PickProps & { item: ItemRef }) => (
	<input type="checkbox" className="pick" aria-label={`Select ${nameOf(item)}`} checked={checked} onChange={(e) => onChange(e.target.checked)} />
);

/** A title kept out of cleanup by a retention rule (or a manual entry the preview reports the same way). */
export function RuleProtectedCard({ d, toggle, pick }: { d: RunDetail; toggle: ToggleOps; pick: PickProps }) {
	const [dim, setDim] = useState(false);
	const [ops] = useState(toggle); // decided once, when the card appears
	return (
		<SkipCard item={d} dimmed={dim} pick={<PickBox item={d} {...pick} />}>
			<div className="head"><SkipTitle item={d} certification={d.certification} /></div>
			<KeptBy message={d.message || ""} />
			{d.ruleName ? <div className="why would" title={`${d.ruleName}: ${d.reason}`}>Otherwise <ActionTag action={d.action} />{` ${d.ruleName}`}</div> : null}
			<Foot item={d} toggle={ops} name={nameOf(d)} size={d.sizeOnDisk} onToggle={(on) => setDim(!on)} />
		</SkipCard>
	);
}

/** A title protected by hand with no retention rule involved. */
export function ManualProtectedCard({ d, ignoreRetention, toggle, pick }: { d: ItemRef & { poster?: string | null; certification?: string | null; sizeOnDisk?: number }; ignoreRetention?: boolean; toggle: ToggleOps; pick: PickProps }) {
	const [dim, setDim] = useState(false);
	const [ops] = useState(toggle);
	return (
		<SkipCard item={d} dimmed={dim} pick={<PickBox item={d} {...pick} />}>
			<div className="head"><SkipTitle item={d} certification={d.certification} /></div>
			<KeptBy message={ignoreRetention ? "Retention rules ignored" : "Manually protected"} />
			<Foot item={d} toggle={ops} name={nameOf(d)} size={d.sizeOnDisk} onToggle={(on) => setDim(!on)} />
		</SkipCard>
	);
}
