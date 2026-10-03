import type { Engine, Logger } from "./engine.js";
import { ConflictError } from "./engine.js";
import type { Store } from "../store.js";

export function createScheduler(deps: { store: Store; engine: Engine; log: Logger; tickMs?: number; now?: () => Date }) {
	const { store, engine, log } = deps;
	const now = deps.now ?? (() => new Date());
	let timer: NodeJS.Timeout | null = null;
	let running = false;

	/** Runs the cleanup if it is due. Safe to call repeatedly; overlapping runs are refused by the DB lease. */
	async function tick(): Promise<boolean> {
		if (running) return false;
		const cfg = store.config.get();
		if (!cfg.enabled || !cfg.nextRunAt || Date.parse(cfg.nextRunAt) > now().getTime()) return false;
		running = true;
		try {
			await engine.run({ trigger: "scheduled" });
			return true;
		} catch (e) {
			if (!(e instanceof ConflictError && e.code === "in_progress")) {
				log.error({ err: (e as Error).message }, "scheduled cleanup failed");
				// Back off a full interval so a persistent failure can't hot-loop.
				store.config.markRun(now());
			}
			return false;
		} finally {
			running = false;
		}
	}

	return {
		tick,
		start() {
			const orphans = store.logs.failOrphans();
			if (orphans) log.warn({ orphans }, "closed out run logs interrupted by a restart");
			timer = setInterval(() => void tick(), deps.tickMs ?? 60_000);
			timer.unref();
		},
		stop() {
			if (timer) clearInterval(timer);
			timer = null;
		},
	};
}
