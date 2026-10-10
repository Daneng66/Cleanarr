import type { ReactNode } from "react";
import type { AsyncState } from "../../hooks/useAsync";
import { Empty } from "./Feedback";
import { Button } from "./Button";
import { Panel } from "./Layout";
import { PageSkeleton } from "./Skeleton";

/** Renders `children(data)` once loaded; a skeleton before, and a retry panel on failure. */
export function AsyncView<T>({ state, skeleton, children }: { state: AsyncState<T>; skeleton?: ReactNode; children: (data: T) => ReactNode }) {
	if (state.error) {
		return <Panel><Empty title="Couldn't load this page" text={state.error.message}><Button icon="refresh" onClick={state.reload}>Try again</Button></Empty></Panel>;
	}
	if (state.data === undefined) return <>{skeleton ?? <PageSkeleton />}</>;
	return <>{children(state.data)}</>;
}
