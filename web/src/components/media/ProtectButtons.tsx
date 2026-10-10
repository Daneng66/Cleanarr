import { useState } from "react";
import { Button, IconButton } from "../ui/Button";
import { nameOf } from "../../lib/format";
import { protectBody } from "../../lib/protection";
import { useApi } from "../../providers/ApiProvider";
import { useToast } from "../../providers/ToastProvider";
import type { ItemRef, ProtectedRow } from "../../types";

/** Toggle that manually protects/unprotects the item; shows the action it will take. */
export function ProtectButton({ item, className = "ghost small", onChange }: { item: ItemRef; className?: string; onChange?: () => void }) {
	const api = useApi();
	const toast = useToast();
	const [id, setId] = useState<string | null>(null);
	const label = id ? "Unprotect" : "Protect";
	return (
		<Button icon={id ? "unprotected" : "protected"} className={className} title={`${label} ${nameOf(item)}`} aria-pressed={!!id}
			onAction={async () => {
				let next: string | null = null;
				if (id) await api.delete(`/protected/${id}`);
				else next = (await api.post<ProtectedRow>("/protected", protectBody(item))).id;
				setId(next);
				onChange?.();
				toast.show(`${next ? "Protected" : "Unprotected"} ${nameOf(item)}`);
			}}>
			{label}
		</Button>
	);
}

export interface ToggleOps {
	off(): Promise<unknown>;
	on(): Promise<unknown>;
}
/** Icon button that flips between Unprotect and Protect using the supplied operations. */
export function ProtectToggle({ name, ops, start = true, onChange }: { name: string; ops: ToggleOps; start?: boolean; onChange?: (on: boolean) => void }) {
	const toast = useToast();
	const [on, setOn] = useState(start);
	const title = `${on ? "Unprotect" : "Protect"} ${name}`;
	return <IconButton icon={on ? "unprotected" : "protected"} label={title} aria-pressed={on} className="ghost small"
		onAction={async () => {
			await (on ? ops.off() : ops.on());
			setOn(!on);
			onChange?.(!on);
			toast.show(`${!on ? "Protected" : "Unprotected"} ${name}`);
		}} />;
}
