import type { ReactNode } from "react";
import { Art } from "./Art";
import { kindLabel, nameOf } from "../../lib/format";
import type { ItemRef } from "../../types";

export const Cert = ({ value }: { value?: string | null }) => (value ? <span className="cert">{value}</span> : null);

/** "Movie · PG-13" under a title. */
export const KindLine = ({ itemType, certification }: { itemType: string; certification?: string | null }) => (
	<small>{kindLabel(itemType)}{certification ? <> · <Cert value={certification} /></> : null}</small>
);

export interface SkipCardProps {
	item: ItemRef & { poster?: string | null };
	/** Renders the select checkbox and the pickable layout. */
	pick?: ReactNode;
	dimmed?: boolean;
	children: ReactNode;
}
/** Poster, optional checkbox and a body: the card used by the protected, missing and skipped lists. */
export function SkipCard({ item, pick, dimmed, children }: SkipCardProps) {
	return (
		<div className={pick ? "skip-card pickable" : "skip-card"} style={dimmed ? { opacity: 0.55 } : undefined}>
			<Art src={item.poster} title={item.title} imgClass="art" fallbackClass="art noart" lazy />
			{pick}
			<div className="body">{children}</div>
		</div>
	);
}
export const SkipTitle = ({ item, suffix, certification }: { item: ItemRef; suffix?: string; certification?: string | null }) => (
	<div className="t" title={nameOf(item)}>{nameOf(item)}{suffix}<KindLine itemType={item.itemType} certification={certification} /></div>
);
