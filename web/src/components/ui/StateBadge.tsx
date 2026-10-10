import { Icon, type IconName } from "./Icon";

// mark, label, tone (tone defaults to the mark)
const STATES: Record<string, [IconName, string, string?]> = {
	flagged: ["flagged", "Flagged"], matches: ["flagged", "Matches"],
	pending: ["queued", "Queued"], running: ["queued", "Running"],
	reclaimed: ["ejected", "Reclaimed"], removed: ["ejected", "Removed"], files_deleted: ["ejected", "Files deleted"], unmonitored: ["ejected", "Unmonitored"],
	completed: ["loaded", "Completed", "ok"], success: ["loaded", "Success", "ok"], protected: ["protected", "Protected"],
	skipped: ["loaded", "Skipped"], no_match: ["loaded", "No match"], out_of_scope: ["loaded", "Out of scope"],
	partial: ["unknown", "Partial"], unknown: ["unknown", "Unknown"],
	blocked: ["fault", "Blocked"], failed: ["fault", "Failed"], error: ["fault", "Error"], fault: ["fault", "Fault"],
};

export function StateBadge({ state, label }: { state: string; label?: string }) {
	const [mark, text, tone] = STATES[state] || ["loaded", state.replaceAll("_", " ")];
	return <span className={`state ${tone || mark}`}><Icon name={mark} />{label ?? text}</span>;
}
