import { useCallback, useRef, useState } from "react";
import { useToast } from "../providers/ToastProvider";

/** Wraps an async action: reports `busy` while it runs and shows any error as a toast. Re-entry is ignored. */
export function useGuard() {
	const toast = useToast();
	const [busy, setBusy] = useState(false);
	const running = useRef(false);
	const run = useCallback(async (fn: () => Promise<unknown>) => {
		if (running.current) return;
		running.current = true;
		setBusy(true);
		try { await fn(); } catch (e) { toast.fail(e); } finally { running.current = false; setBusy(false); }
	}, [toast]);
	return [busy, run] as const;
}
