import { useEffect, useId, useRef } from "react";
import { Icon, type IconName } from "./Icon";

/** A kebab button that opens a small action menu (Esc or tapping outside closes it), positioned under the button, right-aligned. */
export function Menu({ label, items }: { label: string; items: Array<MenuItem | "-"> }) {
	const id = useId();
	const pop = useRef<HTMLDivElement>(null);
	const btn = useRef<HTMLButtonElement>(null);
	useEffect(() => {
		const m = pop.current!;
		const onToggle = (e: Event) => {
			if ((e as ToggleEvent).newState !== "open" || !btn.current) return;
			const r = btn.current.getBoundingClientRect(), w = m.offsetWidth, h = m.offsetHeight;
			m.style.left = `${Math.max(12, Math.min(r.right - w, innerWidth - w - 12))}px`;
			m.style.top = `${r.bottom + 6 + h <= innerHeight - 12 ? r.bottom + 6 : Math.max(12, r.top - 6 - h)}px`;
		};
		m.addEventListener("toggle", onToggle);
		return () => m.removeEventListener("toggle", onToggle);
	}, []);
	return (
		<>
			<button ref={btn} type="button" className="icon ghost" aria-label={label} title={label} aria-haspopup="menu" popoverTarget={id}><Icon name="more" /></button>
			<div ref={pop} id={id} className="menu" popover="auto" role="menu">
				{items.map((it, i) => it === "-"
					? <hr key={i} />
					: <button key={it.label} type="button" role="menuitem" className={it.danger ? "danger" : undefined} disabled={it.disabled}
						onClick={() => { pop.current?.hidePopover(); it.onSelect(); }}><Icon name={it.icon} />{it.label}</button>)}
			</div>
		</>
	);
}

export interface MenuItem { label: string; icon: IconName; onSelect: () => void; danger?: boolean; disabled?: boolean }
