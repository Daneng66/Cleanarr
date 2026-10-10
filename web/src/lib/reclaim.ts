import type { Candidate, Config, ItemRef } from "../types";

const DAY = 86_400_000;
export const daysUntil = (ms: number) => Math.max(0, Math.ceil((ms - Date.now()) / DAY));

/** Stable 6-character barcode label per title, like an LTO cartridge's volser. */
export function volser(d: ItemRef): string {
	let x = 2166136261;
	for (const ch of `${d.instanceId}:${d.itemType}:${d.arrItemId}${d.seasonNumber != null ? `:${d.seasonNumber}` : ""}`) x = Math.imul(x ^ ch.charCodeAt(0), 16777619);
	return (x >>> 0).toString(36).toUpperCase().padStart(6, "0").slice(-6);
}

/** Not yet queued: when it would be, from the next scheduled run plus the queue wait. Null while dry-run or disabled, since neither ever queues anything. */
export function etaMs(cfg?: Config | null): number | null {
	return cfg && !cfg.dryRun && cfg.nextRunAt ? new Date(cfg.nextRunAt).getTime() + cfg.queueDelayDays * DAY : null;
}
export function etaText(cfg?: Config | null): string | null {
	const ms = etaMs(cfg);
	return ms == null ? null : `Removes in ~${daysUntil(ms)} d`;
}
/** Compact "Xd" / "Due" / "Retry" for the poster's corner badge. */
export function countdownBadge(c: Candidate, cfg?: Config | null): string | null {
	const q = c.queue;
	if (q) {
		if (q.status === "failed") return "Retry";
		const d = daysUntil(new Date(q.executeAfter).getTime());
		return d === 0 ? "Due" : `${d}d`;
	}
	const ms = etaMs(cfg);
	return ms == null ? null : `~${daysUntil(ms)}d`;
}
/** Reclaim time to sort by: the queue's own due time, or (not yet queued) the estimate, else last. */
export function soonestMs(c: Candidate, cfg?: Config | null): number {
	if (c.queue) return new Date(c.queue.executeAfter).getTime();
	return etaMs(cfg) ?? Infinity;
}
