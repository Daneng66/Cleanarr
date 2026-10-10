import { useCallback } from "react";
import { useApi } from "../../providers/ApiProvider";
import { useCatalog } from "../../providers/CatalogProvider";
import { useDialog } from "../../providers/DialogProvider";
import { useToast } from "../../providers/ToastProvider";
import type { Instance, RuleRecord, RuleTemplate } from "../../types";
import { RuleEditor } from "./RuleEditor";

/** Returns a function that loads what the editor needs, then opens it as a side sheet. */
export function useRuleEditor() {
	const api = useApi();
	const catalog = useCatalog();
	const dialog = useDialog();
	const toast = useToast();
	return useCallback(async (rule?: RuleRecord | null, template?: RuleTemplate | null) => {
		try {
			const [types, requesters, instances] = await Promise.all([catalog.types(), catalog.requesters(), api.get<Instance[]>("/instances").catch(() => [] as Instance[])]);
			dialog.open(<RuleEditor rule={rule} template={template} types={types} requesters={requesters} instances={instances} />, { kind: "sheet" });
		} catch (e) { toast.fail(e); }
	}, [api, catalog, dialog, toast]);
}
