import type { ApiClient } from "./api";
import type { Candidate, Preview } from "../types";

const TTL = 5 * 60_000;

/** One shared preview so the dashboard and its sub-pages don't each re-read every service. */
export class PreviewCache {
	private entry: { at: number; data: Preview } | null = null;
	private inflight: Promise<Preview> | null = null;
	private listeners = new Set<() => void>();
	constructor(private api: ApiClient) {}

	/** Cached value if fresh, else null. */
	peek(): Preview | null {
		return this.entry && Date.now() - this.entry.at <= TTL ? this.entry.data : null;
	}
	get(force = false): Promise<Preview> {
		const hit = force ? null : this.peek();
		if (hit) return Promise.resolve(hit);
		return (this.inflight ??= this.api.post<Preview>("/preview").then(
			(data) => { this.entry = { at: Date.now(), data }; this.inflight = null; this.emit(); return data; },
			(e) => { this.inflight = null; throw e; },
		));
	}
	/** Last value read, however old; what a mounted view keeps showing while a refresh runs. */
	latest = (): Preview | null => this.entry?.data ?? null;
	/** Marks the value stale: the next `get()` re-reads, but mounted views keep their data. */
	invalidate() {
		if (this.entry) this.entry = { ...this.entry, at: 0 };
	}
	/** Drop one reclaimed candidate without re-reading every service. */
	remove(c: Candidate) {
		if (!this.entry) return;
		this.entry = { ...this.entry, data: { ...this.entry.data, candidates: this.entry.data.candidates.filter((x) => x !== c) } };
		this.emit();
	}
	subscribe = (fn: () => void) => {
		this.listeners.add(fn);
		return () => { this.listeners.delete(fn); };
	};
	private emit() {
		this.listeners.forEach((fn) => fn());
	}
}
