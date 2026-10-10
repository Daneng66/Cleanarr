import { useEffect, useId, useRef, type ReactNode } from "react";
import { Icon } from "./Icon";

/** A "?" button that opens a small popover (tap or click; Esc or tapping outside closes it), positioned under the button. */
export function HelpTip({ label, children }: { label: string; children: ReactNode }) {
	const id = useId();
	const tip = useRef<HTMLDivElement>(null);
	const btn = useRef<HTMLButtonElement>(null);
	useEffect(() => {
		const t = tip.current!;
		const onToggle = (e: Event) => {
			if ((e as ToggleEvent).newState !== "open" || !btn.current) return;
			const r = btn.current.getBoundingClientRect(), w = Math.min(340, innerWidth - 24);
			t.style.width = `${w}px`;
			t.style.left = `${Math.max(12, Math.min(r.left, innerWidth - w - 12))}px`;
			// Below the button when it fits, otherwise above it.
			const th = t.offsetHeight, below = r.bottom + 6;
			t.style.top = `${below + th <= innerHeight - 12 ? below : Math.max(12, r.top - 6 - th)}px`;
		};
		t.addEventListener("toggle", onToggle);
		return () => t.removeEventListener("toggle", onToggle);
	}, []);
	return (
		<>
			<button ref={btn} type="button" className="icon small ghost tip-btn" aria-label={label} title={label} aria-describedby={id} popoverTarget={id}><Icon name="why" /></button>
			<div ref={tip} id={id} className="tip" popover="auto" role="tooltip">{children}</div>
		</>
	);
}
