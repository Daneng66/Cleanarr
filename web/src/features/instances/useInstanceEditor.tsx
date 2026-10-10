import { useCallback } from "react";
import { useDialog } from "../../providers/DialogProvider";
import type { Instance, InstanceType } from "../../types";
import { InstanceEditor } from "./InstanceEditor";

export function useInstanceEditor() {
	const dialog = useDialog();
	return useCallback((instance?: Instance | null, preset?: InstanceType) => dialog.open(<InstanceEditor instance={instance} preset={preset} />), [dialog]);
}
