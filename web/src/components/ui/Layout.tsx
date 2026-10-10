import type { ReactNode } from "react";

export const SectionTitle = ({ title, grow = true, children }: { title: string; grow?: boolean; children?: ReactNode }) => (
	<div className="section-title"><h2 className={grow ? "grow" : undefined}>{title}</h2>{children}</div>
);

export const PageHead = ({ title, lede, actions, back }: { title: string; lede?: ReactNode; actions?: ReactNode; back?: boolean }) => (
	<div className="page-head">
		<div>
			{back ? <a href="#/dashboard" className="small back">← Dashboard</a> : null}
			<h1>{title}</h1>
			{lede ? <p className="lede">{lede}</p> : null}
		</div>
		{actions}
	</div>
);

export const Panel = ({ children, className = "", style }: { children: ReactNode; className?: string; style?: React.CSSProperties }) => (
	<div className={`panel ${className}`.trim()} style={style}>{children}</div>
);

export interface StatProps {
	label: string;
	value: ReactNode;
	sub?: ReactNode;
	/** A link or button shown beside the sub-line. */
	more?: ReactNode;
}
export const Stat = ({ label, value, sub, more }: StatProps) => (
	<div>
		<div className="k">{label}</div>
		<div className="n">{value}</div>
		{more ? <div className="subrow"><small>{sub}</small>{more}</div> : <small>{sub}</small>}
	</div>
);
export const StatsPanel = ({ children, style }: { children: ReactNode; style?: React.CSSProperties }) => (
	<div className="panel stats" style={style}>{children}</div>
);

export const Field = ({ label, htmlFor, help, children }: { label: ReactNode; htmlFor?: string; help?: ReactNode; children: ReactNode }) => (
	<div className="field">
		<label className="lbl" htmlFor={htmlFor}>{label}</label>
		{children}
		{help ? <div className="help">{help}</div> : null}
	</div>
);

export const Switch = ({ checked, onChange, label, help }: { checked: boolean; onChange: (v: boolean) => void; label: string; help: string }) => (
	<label className="switch">
		<input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
		<div><div className="t">{label}</div><div className="d">{help}</div></div>
	</label>
);
