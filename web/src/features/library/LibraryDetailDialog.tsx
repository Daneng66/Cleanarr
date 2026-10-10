import { useState } from "react";
import { Art } from "../../components/media/Art";
import { ExplainBody, ExplainSkeleton, Outcome, useExplain } from "../../components/media/Explain";
import { Cert } from "../../components/media/ItemBits";
import { OpenInArrButton } from "../../components/media/LinkButtons";
import { Button } from "../../components/ui/Button";
import { DialogFrame } from "../../components/ui/DialogFrame";
import { BadNotice } from "../../components/ui/Feedback";
import { StateBadge } from "../../components/ui/StateBadge";
import { Sk } from "../../components/ui/Skeleton";
import { useAsync } from "../../hooks/useAsync";
import { bytes, bytesParts, kindLabel, plural, seasonName, when } from "../../lib/format";
import { useApi } from "../../providers/ApiProvider";
import { SERVICES } from "../../lib/services";
import { useToast } from "../../providers/ToastProvider";
import type { LibraryRow, SeasonEpisodes } from "../../types";
import type { LibraryActions } from "./useLibraryActions";

/** Per-season episode files and size on disk, from Sonarr. */
function Seasons({ d }: { d: LibraryRow }) {
	const api = useApi();
	const { data, error } = useAsync(
		() => api.get<SeasonEpisodes[]>(`/series/${encodeURIComponent(d.instanceId)}/${d.arrItemId}/episodes`),
		[d.instanceId, d.arrItemId],
	);
	if (error || data?.length === 0) return null;
	if (!data) return <div className="seasons"><Sk kind="line short" /></div>;
	const eps = data.reduce((n, s) => n + s.episodes.length, 0);
	return (
		<section className="seasons" aria-label="Seasons on disk">
			<h3 className="sect">{`${plural(data.length, "season")} · ${plural(eps, "episode file")}`}</h3>
			<ul>
				{data.map((s) => (
					<li key={s.number}>
						<span className="nm">{seasonName(s.number)}</span>
						<span className="ct">{plural(s.episodes.length, "episode")}</span>
						<span className="sz">{bytes(s.size)}</span>
					</li>
				))}
			</ul>
		</section>
	);
}

export function LibraryDetailDialog({ d, actions, onClose }: { d: LibraryRow; actions: LibraryActions; onClose: () => void }) {
	const toast = useToast();
	const [protectedId, setProtectedId] = useState(d.protectedId);
	const { data: explain, error } = useExplain(d);
	const [n, u] = bytesParts(d.sizeOnDisk);
	const dd = (k: string, v: string | string[] | null | undefined) =>
		v == null || v === "" || (Array.isArray(v) && !v.length) ? null : <><dt>{k}</dt><dd>{Array.isArray(v) ? v.join(", ") : v}</dd></>;
	/** Closes unless the title is still there after an unmonitor. */
	const act = async (action: "unmonitor" | "delete_files" | "delete") => {
		const gone = await actions.remove([d], action);
		if (gone || action !== "unmonitor") onClose();
	};
	return (
		<DialogFrame title={`${d.title}${d.year ? ` (${d.year})` : ""}`} onClose={onClose} foot={
			<div className="foot-row">
				<OpenInArrButton item={d} className="small" />
				<Button icon={protectedId ? "unprotected" : "protected"} className="small" onAction={async () => {
					const id = await actions.setProtected(d, !protectedId, protectedId);
					setProtectedId(id);
					toast.show(`${id ? "Protected" : "Unprotected"} ${d.title}`);
				}}>{protectedId ? "Unprotect" : "Protect"}</Button>
				{d.monitored ? <Button icon="unmonitor" className="small" onAction={() => act("unmonitor")}>Unmonitor</Button> : null}
				{d.hasFile || d.fileCount ? <Button icon="trash" className="small" onAction={() => act("delete_files")}>Delete files</Button> : null}
				<Button icon="trash" className="small danger" onAction={() => act("delete")}>Delete</Button>
				<span className="grow" />
				<Button onClick={onClose}>Close</Button>
			</div>
		}>
			<div className="detail">
				<Art src={d.poster} title={d.title} imgClass="thumb" fallbackClass="thumb noart" as="div" />
				<div className="main">
					<div className="fig"><span className="n">{n}</span><span className="u">{u}</span>{protectedId ? <StateBadge state="protected" /> : null}</div>
					<dl className="basis">
						{dd("Type", kindLabel(d.itemType))}{dd("Service", SERVICES[d.service])}{dd("Status", d.status)}{dd("Monitored", d.monitored ? "Yes" : "No")}
						{dd("Files", d.itemType === "series" ? `${d.fileCount} episode files` : d.hasFile ? "1 file" : "No file")}
						{d.certification ? <><dt>Rated</dt><dd><Cert value={d.certification} /></dd></> : null}{dd("Rating", d.rating ? d.rating.toFixed(1) : null)}{dd("Quality profile", d.qualityProfile)}{dd("Genres", d.genres)}
						{dd("Tags", d.tags)}{dd("Added", d.added ? when(d.added) : null)}{dd("Path", d.path)}
					</dl>
					{d.itemType === "series" ? <Seasons d={d} /> : null}
				</div>
				<div className="x">
					<h3 className="sect">Against your active rules</h3>
					{error ? <BadNotice>{error.message}</BadNotice> : explain ? <><Outcome e={explain} manuallyProtected={!!protectedId} /><ExplainBody e={explain} facts={false} /></> : <ExplainSkeleton />}
				</div>
			</div>
		</DialogFrame>
	);
}
