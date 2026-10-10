import type { ReactNode } from "react";
import { Icon } from "../../components/ui/Icon";
import { Sk } from "../../components/ui/Skeleton";

/** A ghosted poster grid with a message laid over it (empty, clear, or failed). */
export function PosterState({ kind, title, text, action }: { kind: string; title?: string; text?: ReactNode; action?: ReactNode }) {
	return (
		<div className={`posters state ${kind}`}>
			<div className="grid" aria-hidden="true">
				{Array.from({ length: 12 }, (_, i) => <div key={i} className="ph" style={{ "--i": i } as React.CSSProperties} />)}
			</div>
			{title ? (
				<div className="over"><div>
					{kind.includes("clear") ? <span className="seal"><Icon name="check" /></span> : null}
					<div className="h">{title}</div>
					<p>{text}</p>
					{action}
				</div></div>
			) : null}
		</div>
	);
}

export const PosterSkeleton = () => (
	<div className="posters" aria-busy="true">
		<div className="scale"><Sk kind="line short" /><Sk kind="line tiny" /></div>
		<div className="grid">
			{Array.from({ length: 12 }, (_, i) => <div key={i}><Sk kind="art" /><Sk kind="line" /><Sk kind="line short" /></div>)}
		</div>
	</div>
);
