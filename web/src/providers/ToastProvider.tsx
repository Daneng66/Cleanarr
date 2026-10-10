import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon } from "../components/ui/Icon";

export interface Toaster {
	show(message: string, bad?: boolean): void;
	/** Shows an error's first line. */
	fail(error: unknown): void;
}
const Ctx = createContext<Toaster | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
	const [t, setT] = useState<{ msg: string; bad: boolean; visible: boolean }>({ msg: "", bad: false, visible: false });
	const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
	const show = useCallback((msg: string, bad = false) => {
		setT({ msg, bad, visible: true });
		clearTimeout(timer.current);
		timer.current = setTimeout(() => setT((x) => ({ ...x, visible: false })), 4000);
	}, []);
	useEffect(() => () => clearTimeout(timer.current), []);
	const value = useMemo<Toaster>(() => ({ show, fail: (e) => show((e instanceof Error ? e.message : String(e)).split("\n")[0]!, true) }), [show]);
	return (
		<Ctx.Provider value={value}>
			{children}
			<div id="toast" role="status" aria-live="polite" className={t.visible ? (t.bad ? "show bad" : "show") : t.bad ? "bad" : ""}>
				{t.msg ? <><Icon name={t.bad ? "fault" : "check"} />{t.msg}</> : null}
			</div>
		</Ctx.Provider>
	);
}
export function useToast(): Toaster {
	const v = useContext(Ctx);
	if (!v) throw new Error("ToastProvider missing");
	return v;
}
