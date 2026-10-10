import type { ReactNode } from "react";
import { Button } from "./Button";
import { DialogFrame } from "./DialogFrame";

export interface ConfirmOptions {
	title: string;
	text?: ReactNode;
	action: string;
	danger?: boolean;
}

export function ConfirmDialog({ title, text, action, danger = false, onAnswer }: ConfirmOptions & { onAnswer: (yes: boolean) => void }) {
	return (
		<DialogFrame title={title} lede={text} foot={<>
			<Button onClick={() => onAnswer(false)}>Cancel</Button>
			<Button className={danger ? "danger solid" : "primary"} onClick={() => onAnswer(true)}>{action}</Button>
		</>} />
	);
}
