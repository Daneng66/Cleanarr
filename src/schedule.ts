import type { ConfigRecord } from "./types.js";

type Sched = Pick<ConfigRecord, "intervalEvery" | "intervalUnit" | "runTime">;

/** The run after `from`: `every` units later (calendar-aware, month ends clamped) at `runTime` in server-local time. */
export function nextRun(from: Date, { intervalEvery, intervalUnit, runTime }: Sched): Date {
	const [hh = 0, mm = 0] = runTime.split(":").map(Number);
	const d = new Date(from);
	if (intervalUnit === "months") {
		const day = d.getDate();
		d.setDate(1);
		d.setMonth(d.getMonth() + intervalEvery);
		d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
	} else d.setDate(d.getDate() + intervalEvery * (intervalUnit === "weeks" ? 7 : 1));
	d.setHours(hh, mm, 0, 0);
	return d;
}

/** First run when nothing has run yet: the next occurrence of `runTime`, today if still ahead. */
export function firstRun(now: Date, runTime: string): Date {
	const [hh = 0, mm = 0] = runTime.split(":").map(Number);
	const d = new Date(now);
	d.setHours(hh, mm, 0, 0);
	if (d <= now) d.setDate(d.getDate() + 1);
	return d;
}
