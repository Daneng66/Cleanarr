import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useGuard } from "../../hooks/useGuard";
import { Icon, type IconName } from "./Icon";

type Native = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "type">;

export interface ButtonProps extends Native {
	/** Plain click handler. */
	onClick?: () => void;
	/** Async click handler: the button disables and shows busy while it runs, and errors become a toast. */
	onAction?: () => Promise<unknown>;
	icon?: IconName;
	children?: ReactNode;
}

const cx = (...c: Array<string | false | undefined>) => c.filter(Boolean).join(" ");

export function Button({ onClick, onAction, icon, className, disabled, children, ...rest }: ButtonProps) {
	const [busy, run] = useGuard();
	return (
		<button {...rest} type="button" className={cx(className, busy && "busy") || undefined} disabled={disabled || busy}
			onClick={() => (onAction ? run(onAction) : onClick?.())}>
			{icon ? <Icon name={icon} /> : null}{children}
		</button>
	);
}

/** Icon-only button; the label is both the accessible name and the tooltip. */
export function IconButton({ icon, label, className = "", ...rest }: Omit<ButtonProps, "children" | "aria-label" | "title"> & { icon: IconName; label: string }) {
	return <Button {...rest} className={`icon ${className}`.trim()} aria-label={label} title={label}><Icon name={icon} /></Button>;
}
