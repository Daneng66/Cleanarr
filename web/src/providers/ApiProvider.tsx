import { createContext, useContext, useMemo, useRef, type ReactNode } from "react";
import { createApiClient, localKeyStore, type ApiClient } from "../services/api";
import { PreviewCache } from "../services/previewCache";
import { useDialog, useDialogCancel } from "./DialogProvider";
import { KeyPrompt } from "../components/ui/KeyPrompt";

interface Services {
	api: ApiClient;
	preview: PreviewCache;
}
const Ctx = createContext<Services | null>(null);

function Lock({ children }: { children: ReactNode }) {
	useDialogCancel((e) => e.preventDefault()); // nothing works without the key, so Esc must not strand the page
	return <>{children}</>;
}

export function ApiProvider({ children }: { children: ReactNode }) {
	const dialog = useDialog();
	const prompt = useRef<Promise<void> | null>(null);
	const services = useMemo<Services>(() => {
		const askKey = () => (prompt.current ??= new Promise<void>((resolve) => {
			dialog.open(<Lock><KeyPrompt onSubmit={(key) => { localKeyStore.set(key); prompt.current = null; dialog.close(); resolve(); }} /></Lock>);
		}));
		const api = createApiClient(localKeyStore, askKey);
		return { api, preview: new PreviewCache(api) };
	}, [dialog]);
	return <Ctx.Provider value={services}>{children}</Ctx.Provider>;
}
function useServices() {
	const v = useContext(Ctx);
	if (!v) throw new Error("ApiProvider missing");
	return v;
}
export const useApi = () => useServices().api;
export const usePreviewCache = () => useServices().preview;
