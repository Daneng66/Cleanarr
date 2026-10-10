import type { ReactNode } from "react";
import { IconButton } from "./Button";

export interface DialogFrameProps {
	title: string;
	lede?: ReactNode;
	/** Shows a close button in the header. */
	onClose?: () => void;
	children?: ReactNode;
	foot?: ReactNode;
}

/** The head / body / foot layout shared by every dialog. */
export function DialogFrame({ title, lede, onClose, children, foot }: DialogFrameProps) {
	return (
		<>
			<div className="dlg-head">
				<h2>{title}</h2>
				{lede ? <p className="lede">{lede}</p> : null}
				{onClose ? <IconButton icon="x" label="Close" className="ghost dlg-close" onClick={onClose} /> : null}
			</div>
			{children ? <div className="dlg-body">{children}</div> : null}
			{foot ? <div className="dlg-foot">{foot}</div> : null}
		</>
	);
}
