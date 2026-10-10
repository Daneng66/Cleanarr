import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { ConfirmDialog, type ConfirmOptions } from "../components/ui/ConfirmDialog";

export interface OpenOptions {
	/** CSS class on the dialog: "wide", "sheet", … */
	kind?: string;
	/** Runs once, whenever the dialog next closes. */
	onClosed?: () => void;
}
export interface DialogService {
	open(content: ReactNode, opts?: OpenOptions): void;
	close(): void;
	/** In-page confirmation; resolves true only when the action button is pressed. */
	confirm(opts: ConfirmOptions): Promise<boolean>;
}
type CancelHandler = (e: Event) => void;
interface Host {
	ref: RefObject<HTMLDialogElement | null>;
	slot: { content: ReactNode; kind: string } | null;
	cancel: RefObject<CancelHandler | null>;
	onClose(): void;
}
const ServiceCtx = createContext<DialogService | null>(null);
const HostCtx = createContext<Host | null>(null);

/** Owns the dialog state. Mount <DialogHost/> below every other provider so dialog content can use them. */
export function DialogProvider({ children }: { children: ReactNode }) {
	const ref = useRef<HTMLDialogElement>(null);
	const [slot, setSlot] = useState<Host["slot"]>(null);
	const closed = useRef<Array<() => void>>([]);
	const cancel = useRef<CancelHandler | null>(null);

	const service = useMemo<DialogService>(() => {
		const open: DialogService["open"] = (content, opts = {}) => {
			if (opts.onClosed) closed.current.push(opts.onClosed);
			setSlot({ content, kind: opts.kind ?? "" });
		};
		const close = () => ref.current?.close();
		return {
			open, close,
			confirm: (o) => new Promise<boolean>((resolve) => {
				let answer = false;
				open(<ConfirmDialog {...o} onAnswer={(a) => { answer = a; close(); }} />, { onClosed: () => resolve(answer) });
			}),
		};
	}, []);

	const onClose = useCallback(() => {
		setSlot(null);
		const fns = closed.current;
		closed.current = [];
		fns.forEach((f) => f());
	}, []);

	const host = useMemo<Host>(() => ({ ref, slot, cancel, onClose }), [slot, onClose]);
	return (
		<ServiceCtx.Provider value={service}>
			<HostCtx.Provider value={host}>{children}</HostCtx.Provider>
		</ServiceCtx.Provider>
	);
}

export function DialogHost() {
	const h = useContext(HostCtx);
	if (!h) throw new Error("DialogProvider missing");
	const { ref, slot, cancel, onClose } = h;
	useLayoutEffect(() => {
		const d = ref.current;
		if (slot && d && !d.open) d.showModal();
	}, [slot, ref]);
	return (
		<dialog ref={ref} id="dialog" className={slot?.kind ?? ""} onClose={onClose} onCancel={(e) => cancel.current?.(e.nativeEvent)}>
			{slot?.content}
		</dialog>
	);
}

export function useDialog(): DialogService {
	const v = useContext(ServiceCtx);
	if (!v) throw new Error("DialogProvider missing");
	return v;
}
/** Lets dialog content intercept Esc (call `e.preventDefault()` to keep it open). */
export function useDialogCancel(handler: CancelHandler) {
	const h = useContext(HostCtx);
	const latest = useRef(handler);
	latest.current = handler;
	const cancel = h?.cancel;
	useEffect(() => {
		if (!cancel) return;
		const fn: CancelHandler = (e) => latest.current(e);
		cancel.current = fn;
		return () => { if (cancel.current === fn) cancel.current = null; };
	}, [cancel]);
}
