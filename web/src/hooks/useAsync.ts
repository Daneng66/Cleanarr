import { useCallback, useEffect, useRef, useState } from "react";

export interface AsyncState<T> {
	data?: T;
	error?: Error;
	loading: boolean;
	reload: () => void;
}

/** Runs `fn` on mount and whenever `deps` change; ignores results from superseded runs. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> {
	const [state, setState] = useState<{ data?: T; error?: Error; loading: boolean }>({ loading: true });
	const [tick, setTick] = useState(0);
	const seq = useRef(0);
	useEffect(() => {
		const id = ++seq.current;
		setState((s) => ({ data: s.data, loading: true }));
		fn().then(
			(data) => { if (id === seq.current) setState({ data, loading: false }); },
			(error) => { if (id === seq.current) setState({ error, loading: false }); },
		);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [...deps, tick]);
	const reload = useCallback(() => setTick((t) => t + 1), []);
	return { ...state, reload };
}
