import type { ReactNode } from "react";
import { bytesParts } from "../../lib/format";
import { Sk } from "./Skeleton";

/** The big figure with a headline. `n == null` makes it a plain page heading. */
export function Readout({ n, title, text, actions, extra }: { n: number | null; title: string; text: ReactNode; actions?: ReactNode; extra?: ReactNode }) {
	const [v, u] = n == null ? [] : bytesParts(n);
	const Head = n == null ? "h1" : "div";
	return (
		<div className="readout">
			{n == null ? null : <div className="fig"><span className="n">{v}</span><span className="u">{u}</span></div>}
			<div className="what"><Head className="h">{title}</Head><p>{text}</p>{extra}</div>
			{actions}
		</div>
	);
}

/** Same boxes as the real readout, so nothing jumps when data lands. */
export const ReadoutSkeleton = ({ actions }: { actions?: ReactNode }) => (
	<div className="readout">
		<div className="fig"><Sk kind="fig" /></div>
		<div className="what"><h1 className="h">Reading your library…</h1><p>Evaluating every title against your rules. Preview never changes anything.</p></div>
		{actions}
	</div>
);
