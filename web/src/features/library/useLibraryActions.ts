import { useMemo } from "react";
import { plural } from "../../lib/format";
import { protectBody } from "../../lib/protection";
import { useApi, usePreviewCache } from "../../providers/ApiProvider";
import { useDialog } from "../../providers/DialogProvider";
import { useToast } from "../../providers/ToastProvider";
import type { LibraryRow, ProtectedRow, RemoveResult } from "../../types";
import { libKey } from "./librarySort";

type RemoveAction = "delete" | "delete_files" | "unmonitor";
const REMOVE_TEXT: Record<RemoveAction, [string, string]> = {
	delete: ["Delete", "Removed from Sonarr/Radarr and the files are deleted."],
	delete_files: ["Delete files for", "Files are deleted; the titles stay in Sonarr/Radarr."],
	unmonitor: ["Unmonitor", "Sonarr/Radarr stop monitoring; files stay on disk."],
};

export interface LibraryActions {
	/** Confirms, then applies. Resolves true when every title went through (and was removed from the library on delete). */
	remove(items: LibraryRow[], action: RemoveAction): Promise<boolean>;
	/** Resolves to the new protection id, or null when unprotected. */
	setProtected(d: LibraryRow, on: boolean, currentId: string | null): Promise<string | null>;
	protectMany(items: LibraryRow[], on: boolean): Promise<void>;
}

/** The library page's mutations. `onApplied` receives the rows to patch into the list once the server has confirmed. */
export function useLibraryActions(onApplied: (patch: { removed?: Set<string>; update?: (d: LibraryRow) => LibraryRow }) => void): LibraryActions {
	const api = useApi();
	const cache = usePreviewCache();
	const dialog = useDialog();
	const toast = useToast();
	return useMemo<LibraryActions>(() => {
		const setProtected: LibraryActions["setProtected"] = async (d, on, currentId) => {
			let id = currentId;
			if (on && !currentId) id = (await api.post<ProtectedRow>("/protected", protectBody({ ...d, seasonNumber: null }))).id;
			else if (!on && currentId) { await api.delete(`/protected/${currentId}`); id = null; }
			onApplied({ update: (r) => (libKey(r) === libKey(d) ? { ...r, protectedId: id } : r) });
			cache.invalidate();
			return id;
		};
		return {
			setProtected,
			async protectMany(items, on) {
				let n = 0;
				for (const d of items) {
					try { await setProtected(d, on, d.protectedId); n++; } catch (e) { toast.fail(e); break; }
				}
				if (n) toast.show(`${on ? "Protected" : "Unprotected"} ${plural(n, "title")}`);
			},
			async remove(items, action) {
				const [verb, text] = REMOVE_TEXT[action];
				const what = items.length === 1 ? `“${items[0]!.title}”` : plural(items.length, "title");
				if (!(await dialog.confirm({ title: `${verb} ${what}?`, text: `${text} Protected titles are skipped. This can't be undone.`, action: verb.replace(" for", ""), danger: true }))) return false;
				const res = await api.post<RemoveResult[]>("/library/remove", { action, items: items.map(({ instanceId, arrItemId }) => ({ instanceId, arrItemId })) });
				const ok = new Set(res.filter((r) => r.status === "done" || r.status === "gone").map(libKey));
				const bad = res.filter((r) => !ok.has(libKey(r)));
				if (action === "delete") onApplied({ removed: ok });
				else onApplied({ update: (d) => !ok.has(libKey(d)) ? d : action === "unmonitor" ? { ...d, monitored: false } : { ...d, hasFile: false, sizeOnDisk: 0, fileCount: 0 } });
				cache.invalidate();
				toast.show(bad.length ? `${ok.size} done, ${bad.length} not applied: ${bad[0]!.message}` : `${plural(ok.size, "title")} updated`, !!bad.length);
				return !bad.length;
			},
		};
	}, [api, cache, dialog, toast, onApplied]);
}
