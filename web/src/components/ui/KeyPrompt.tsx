import { useState } from "react";
import { Button } from "./Button";
import { DialogFrame } from "./DialogFrame";

export function KeyPrompt({ onSubmit }: { onSubmit: (key: string) => void }) {
	const [key, setKey] = useState("");
	return (
		<DialogFrame title="Sign in" lede="This Cleanarr instance requires its API key (CLEANARR_API_KEY)."
			foot={<Button className="primary" onClick={() => onSubmit(key)}>Continue</Button>}>
			<div className="field">
				<label className="lbl">API key</label>
				<input type="password" placeholder="API key" autoComplete="current-password" autoFocus value={key}
					onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onSubmit(key)} />
			</div>
		</DialogFrame>
	);
}
