import { useState } from "react";
import { AsyncView } from "../../components/ui/AsyncView";
import { Button, IconButton } from "../../components/ui/Button";
import { Empty } from "../../components/ui/Feedback";
import { PageHead, Panel, SectionTitle } from "../../components/ui/Layout";
import { StateBadge } from "../../components/ui/StateBadge";
import { useAsync } from "../../hooks/useAsync";
import { SERVICES } from "../../lib/services";
import { useApi, usePreviewCache } from "../../providers/ApiProvider";
import { useDialog } from "../../providers/DialogProvider";
import { useShell } from "../../providers/ShellProvider";
import { useToast } from "../../providers/ToastProvider";
import type { Instance, InstanceType } from "../../types";
import { useInstanceEditor } from "./useInstanceEditor";

export function InstancesPage() {
	const api = useApi();
	const state = useAsync(() => api.get<Instance[]>("/instances"), []);
	return <AsyncView state={state}>{(all) => <Instances all={all} />}</AsyncView>;
}

function Instances({ all }: { all: Instance[] }) {
	const edit = useInstanceEditor();
	const libs = all.filter((i) => i.type === "sonarr" || i.type === "radarr");
	const evidence = all.filter((i) => i.type === "plex" || i.type === "seerr");
	const add = (t: InstanceType, primary = false) => <Button key={t} icon="plus" className={primary ? "primary" : ""} onClick={() => edit(null, t)}>{`Add ${SERVICES[t]}`}</Button>;
	// Services this section can still take; keeps "Add Plex" reachable once Seerr exists (and vice versa).
	const more = (have: Instance[], types: InstanceType[]) => {
		const missing = types.filter((t) => !have.some((i) => i.type === t));
		return missing.length ? <div className="row" style={{ padding: "12px 16px", borderTop: "1px solid var(--line)" }}>{missing.map((t) => add(t))}</div> : null;
	};
	return (
		<div>
			<PageHead title="Instances" lede="Sonarr and Radarr hold your library. Plex supplies watch history and Seerr supplies requests; both are optional."
				actions={<Button icon="plus" className="primary" onClick={() => edit()}>Add instance</Button>} />
			<section>
				<SectionTitle title="Library" grow={false} />
				<Panel>
					{libs.length
						? <><ul className="instances">{libs.map((i) => <InstanceRow key={i.id} instance={i} />)}</ul>{more(libs, ["radarr", "sonarr"])}</>
						: <Empty title="No library connected" text="Add Sonarr or Radarr so Cleanarr can read what's on disk.">{add("radarr", true)}{add("sonarr", true)}</Empty>}
				</Panel>
			</section>
			<section>
				<SectionTitle title="Evidence" grow={false} />
				<Panel>
					{evidence.length
						? <><ul className="instances">{evidence.map((i) => <InstanceRow key={i.id} instance={i} />)}</ul>{more(evidence, ["plex", "seerr"])}</>
						: <Empty title="Optional" text="Add Plex for watch-history rules and Seerr for request rules.">{add("plex")}{add("seerr")}</Empty>}
				</Panel>
			</section>
		</div>
	);
}

function InstanceRow({ instance: i }: { instance: Instance }) {
	const api = useApi();
	const cache = usePreviewCache();
	const dialog = useDialog();
	const toast = useToast();
	const shell = useShell();
	const edit = useInstanceEditor();
	const [result, setResult] = useState<{ ok: boolean; error?: string } | null>(null);
	const remove = async () => {
		if (!(await dialog.confirm({ title: `Remove ${i.name}?`, text: "Cleanarr stops reading from it. Nothing in the service itself changes.", action: "Remove instance", danger: true }))) return;
		try { await api.delete(`/instances/${i.id}`); cache.invalidate(); shell.reload(); } catch (e) { toast.fail(e); }
	};
	return (
		<li>
			<span className="svc">{SERVICES[i.type] || i.type}</span>
			<div>
				<div className="nm">
					<span className={`led${result ? (result.ok ? " on" : " bad") : ""}`} title="Not tested yet" />{i.name}
					{i.enabled ? null : <span className="tag">Disabled</span>}
				</div>
				<div className="url">{i.url}</div>
				<div className="res" aria-live="polite">{result ? (result.ok ? <StateBadge state="success" label="Connected" /> : <StateBadge state="fault" label={result.error} />) : null}</div>
			</div>
			<div className="acts">
				<Button icon="plug" className="small" onAction={async () => setResult(await api.post(`/instances/${i.id}/test`))}>Test</Button>
				<Button icon="edit" className="small" onClick={() => edit(i)}>Edit</Button>
				<IconButton icon="trash" label={`Remove ${i.name}`} className="small ghost danger" onClick={remove} />
			</div>
		</li>
	);
}
