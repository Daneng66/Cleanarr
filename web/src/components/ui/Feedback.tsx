import type { ReactNode } from "react";
import { Icon } from "./Icon";

export const Notice = ({ children }: { children: ReactNode }) => (
	<div className="notice" role="note"><Icon name="unknown" /><div>{children}</div></div>
);
export const BadNotice = ({ children }: { children: ReactNode }) => (
	<div className="notice bad" role="alert"><Icon name="fault" /><div>{children}</div></div>
);
export const Notices = ({ items, style }: { items: string[]; style?: React.CSSProperties }) =>
	items.length ? <div className="notices" style={style}>{items.map((w, i) => <Notice key={i}>{w}</Notice>)}</div> : null;

export function Empty({ title, text, children }: { title: string; text?: ReactNode; children?: ReactNode }) {
	return (
		<div className="empty">
			<div className="h">{title}</div>
			{text ? <p>{text}</p> : null}
			{children ? <div className="row" style={{ justifyContent: "center" }}>{children}</div> : null}
		</div>
	);
}
