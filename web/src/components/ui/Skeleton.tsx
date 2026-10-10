export const Sk = ({ kind }: { kind: string }) => <span className={`sk ${kind}`} aria-hidden="true" />;

/** Generic page placeholder. */
export const PageSkeleton = () => (
	<div aria-busy="true">
		<div className="skeleton h" />
		<div className="skeleton" style={{ width: "60%" }} />
		<div className="skeleton" style={{ width: "40%" }} />
	</div>
);
