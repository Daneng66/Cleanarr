/** What components depend on: a JSON HTTP client for the Cleanarr API. Swap the implementation in tests. */
export interface ApiClient {
	get<T = unknown>(path: string): Promise<T>;
	post<T = unknown>(path: string, body?: unknown): Promise<T>;
	put<T = unknown>(path: string, body?: unknown): Promise<T>;
	delete(path: string): Promise<void>;
}

export class ApiError extends Error {
	constructor(message: string, readonly code?: string) {
		super(message);
	}
}

export interface KeyStore {
	get(): string;
	set(value: string): void;
}
export const localKeyStore: KeyStore = {
	get: () => { try { return localStorage.getItem("cleanarr.key") || ""; } catch { return ""; } },
	set: (v) => { try { localStorage.setItem("cleanarr.key", v); } catch { /* storage blocked: the key lasts for this session only */ } },
};

/** `onUnauthorized` must obtain a new key (storing it) before resolving; the request is then retried. */
export function createApiClient(keys: KeyStore, onUnauthorized: () => Promise<void>): ApiClient {
	async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
		const key = keys.get();
		const res = await fetch(`/api${path}`, {
			method,
			headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(key ? { Authorization: `Bearer ${key}` } : {}) },
			body: body !== undefined ? JSON.stringify(body) : undefined,
		});
		if (res.status === 401) { await onUnauthorized(); return request<T>(method, path, body); }
		if (res.status === 204) return null as T;
		const data = await res.json().catch(() => ({}));
		if (!res.ok) throw new ApiError(data.issues ? data.issues.join("\n") : data.error || res.statusText, data.code);
		return data as T;
	}
	return {
		get: (p) => request("GET", p),
		post: (p, b) => request("POST", p, b),
		put: (p, b) => request("PUT", p, b),
		delete: async (p) => { await request("DELETE", p); },
	};
}
