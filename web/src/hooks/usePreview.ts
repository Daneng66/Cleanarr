import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { usePreviewCache } from "../providers/ApiProvider";
import type { Preview } from "../types";

export interface PreviewState {
	/** Undefined until the first read finishes (or while a stale value is being replaced on mount). */
	data: Preview | undefined;
	error: Error | undefined;
	/** Re-reads every service, keeping the current data on screen meanwhile. */
	refresh(): Promise<void>;
}

export function usePreview(): PreviewState {
	const cache = usePreviewCache();
	const latest = useSyncExternalStore(cache.subscribe, cache.latest);
	const [ready, setReady] = useState(() => !!cache.peek());
	const [error, setError] = useState<Error>();
	useEffect(() => {
		let live = true;
		cache.get().then(() => live && setReady(true), (e) => live && setError(e));
		return () => { live = false; };
	}, [cache]);
	const refresh = useCallback(async () => { await cache.get(true); setError(undefined); setReady(true); }, [cache]);
	return { data: ready ? latest ?? undefined : undefined, error, refresh };
}
