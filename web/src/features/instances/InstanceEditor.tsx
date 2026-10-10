import { useId, useState } from "react";
import { Button } from "../../components/ui/Button";
import { DialogFrame } from "../../components/ui/DialogFrame";
import { Field, Switch } from "../../components/ui/Layout";
import { StateBadge } from "../../components/ui/StateBadge";
import { SERVICES } from "../../lib/services";
import { useApi, usePreviewCache } from "../../providers/ApiProvider";
import { useDialog } from "../../providers/DialogProvider";
import { useShell } from "../../providers/ShellProvider";
import { useToast } from "../../providers/ToastProvider";
import type { Instance, InstanceType } from "../../types";

const HINTS: Record<string, string> = {
	plex: "Use the server owner's token so history for every user is visible. Plex listens on port 32400 by default.",
	seerr: "Overseerr, Jellyseerr or Seerr API key (Settings → General).",
	sonarr: "Sonarr → Settings → General → API Key.",
	radarr: "Radarr → Settings → General → API Key.",
};
interface TestResult { ok: boolean; error?: string }

export function InstanceEditor({ instance, preset }: { instance?: Instance | null; preset?: InstanceType }) {
	const api = useApi();
	const cache = usePreviewCache();
	const dialog = useDialog();
	const toast = useToast();
	const shell = useShell();
	const uid = useId();
	const [type, setType] = useState<string>(instance?.type || preset || "sonarr");
	const [name, setName] = useState(instance?.name || (preset ? SERVICES[preset]! : "Sonarr"));
	const [url, setUrl] = useState(instance?.url || "");
	const [key, setKey] = useState("");
	const [enabled, setEnabled] = useState(instance ? instance.enabled : true);
	const [result, setResult] = useState<TestResult | null>(null);

	const changeType = (t: string) => {
		setType(t);
		// Keep an untouched default name in step with the service.
		if (!instance && (!name || Object.values(SERVICES).includes(name))) setName(SERVICES[t]!);
	};

	const test = async () => {
		if (!key && !instance) throw new Error("Enter an API key first");
		setResult(key ? await api.post<TestResult>("/instances/test", { type, url, apiKey: key }) : await api.post<TestResult>(`/instances/${instance!.id}/test`));
	};
	const save = async () => {
		const body = { name, url, enabled, ...(key ? { apiKey: key } : {}) };
		if (instance) await api.put(`/instances/${instance.id}`, body); else await api.post("/instances", { ...body, type });
		cache.invalidate();
		dialog.close();
		toast.show(instance ? "Instance saved" : "Instance added");
		shell.navigate("instances");
	};

	return (
		<DialogFrame title={instance ? `Edit ${instance.name}` : "Add instance"}
			foot={<><Button onClick={dialog.close}>Cancel</Button><Button icon="plug" onAction={test}>Test connection</Button><Button className="primary" onAction={save}>{instance ? "Save" : "Add instance"}</Button></>}>
			<div className="cols">
				<Field label="Service" htmlFor={`${uid}-t`}>
					<select id={`${uid}-t`} value={type} disabled={!!instance} onChange={(e) => changeType(e.target.value)}>
						{Object.entries(SERVICES).map(([t, l]) => <option key={t} value={t}>{l}</option>)}
					</select>
				</Field>
				<Field label="Name" htmlFor={`${uid}-n`}><input id={`${uid}-n`} value={name} onChange={(e) => setName(e.target.value)} /></Field>
			</div>
			<Field label="URL" htmlFor={`${uid}-u`}>
				<input id={`${uid}-u`} value={url} placeholder="http://host:port" inputMode="url" autoComplete="off" onChange={(e) => setUrl(e.target.value)} />
			</Field>
			<Field label={type === "plex" ? "X-Plex-Token" : "API key"} htmlFor={`${uid}-k`} help={HINTS[type]}>
				<input id={`${uid}-k`} type="password" value={key} autoComplete="off" placeholder={instance ? "Leave blank to keep the current key" : "API key"} onChange={(e) => setKey(e.target.value)} />
			</Field>
			<Switch checked={enabled} onChange={setEnabled} label="Enabled" help="Disabled instances are skipped on every run." />
			<div aria-live="polite" style={{ minHeight: 20 }}>
				{result ? (result.ok ? <StateBadge state="success" label="Connected" /> : <StateBadge state="fault" label={result.error} />) : null}
			</div>
		</DialogFrame>
	);
}
