import { useState } from "react";
import { Art } from "../../components/media/Art";
import { Cert } from "../../components/media/ItemBits";
import { ExplainPanel, WhyButton } from "../../components/media/Explain";
import { OpenInArrButton, OpenInPlexButton } from "../../components/media/LinkButtons";
import { ProtectButton } from "../../components/media/ProtectButtons";
import { Button } from "../../components/ui/Button";
import { Icon } from "../../components/ui/Icon";
import { Sk } from "../../components/ui/Skeleton";
import { StateBadge } from "../../components/ui/StateBadge";
import { ActionTag, actionLabel } from "../../components/ui/Tags";
import { DialogFrame } from "../../components/ui/DialogFrame";
import { ago, bytes, bytesParts, frees, nameOf, plural, seasonName } from "../../lib/format";
import { plainReason } from "../../lib/protection";
import { etaText } from "../../lib/reclaim";
import { useApi } from "../../providers/ApiProvider";
import { useDialog } from "../../providers/DialogProvider";
import { useAsync } from "../../hooks/useAsync";
import type { Candidate, Config, SeasonEpisodes } from "../../types";

/** When it's due, that a retry is pending and why it failed, or (not yet queued) an estimate of when it would be. */
function QueueStatus({ c, cfg }: { c: Candidate; cfg: Config }) {
	const q = c.queue;
	if (!q) {
		const eta = etaText(cfg);
		return eta ? <div className="queue-status"><StateBadge state="pending" label={eta} /></div> : null;
	}
	return (
		<div className="queue-status">
			{q.status === "failed" ? <StateBadge state="failed" label="Failed, retrying next run" /> : <StateBadge state="pending" label={`Queued · removes ${ago(q.executeAfter)}`} />}
			{q.lastError ? <div className="help">{q.lastError}</div> : null}
		</div>
	);
}

/** What the action will do to this title, stated plainly. Series and seasons count their episode files from Sonarr. */
function ImpactBlock({ c }: { c: Candidate }) {
	const api = useApi();
	const movie = c.itemType === "movie";
	const q = c.seasonNumber != null ? `?season=${c.seasonNumber}` : "";
	const eps = useAsync(
		() => (movie ? Promise.resolve([] as SeasonEpisodes[]) : api.get<SeasonEpisodes[]>(`/series/${encodeURIComponent(c.instanceId)}/${c.arrItemId}/episodes${q}`)),
		[c.instanceId, c.arrItemId, c.seasonNumber],
	);
	const say = (k?: number, seasons?: SeasonEpisodes[]) => {
		const files = k == null ? "its episode files" : plural(k, "episode file");
		const where = seasons?.length === 1 && c.seasonNumber == null ? ` in ${seasonName(seasons[0]!.number)}` : "";
		if (movie) return { delete: "Removes the movie from Radarr and deletes its file.", delete_files: "Deletes the file. The movie stays in Radarr.", unmonitor: "Radarr stops monitoring it. The file stays on disk.", delete_season: "" }[c.action];
		return {
			delete_season: `Deletes ${files} and stops monitoring ${seasonName(c.seasonNumber ?? 0)}. The rest of the show stays.`,
			delete: `Removes the series from Sonarr and deletes ${files}${where}.`,
			delete_files: `Deletes ${files}${where}. The series stays in Sonarr.`,
			unmonitor: `Sonarr stops monitoring it. ${k == null ? "Its episode files stay" : `${plural(k, "episode file")} stay`} on disk.`,
		}[c.action];
	};
	const cls = `impact ${frees(c) ? "destroys" : ""}`;
	if (movie) return <div className={cls} role="status"><p>{say()}</p></div>;
	if (eps.error) return <div className={cls} role="status"><p>{say()}</p><div className="rows faint small">Couldn't count episodes in Sonarr right now.</div></div>;
	if (!eps.data) return <div className={cls} role="status"><p>{say()}</p><div className="rows"><Sk kind="line short" /></div></div>;
	const seasons = eps.data;
	const k = seasons.reduce((t, s) => t + s.episodes.length, 0);
	return (
		<div className={cls} role="status">
			<p>{say(k, seasons)}</p>
			{seasons.length > 1 && c.action !== "unmonitor" ? (
				<div className="rows">{seasons.map((s) => <div key={s.number}><span>{seasonName(s.number)}</span><span>{plural(s.episodes.length, "episode")}</span><span>{bytes(s.size)}</span></div>)}</div>
			) : ""}
		</div>
	);
}

/** One ticked row per satisfied sub-condition the server sent with the candidate. */
function MatchedTree({ c }: { c: Candidate }) {
	const rows = c.reasons?.length ? c.reasons : [{ text: plainReason(c.reason) }];
	return (
		<dd>
			<ul className="tree flat">
				{rows.map((r, i) => <li key={i}><span className="st state yes" style={{ font: "inherit", whiteSpace: "normal" }}><Icon name="check" /><span>{r.text}</span></span></li>)}
			</ul>
		</dd>
	);
}

export interface TitleDetailProps {
	c: Candidate;
	cfg: Config;
	onProtectChange: () => void;
	/** Reclaims just this title; the caller owns confirmation and bookkeeping. */
	onReclaim: (c: Candidate) => Promise<void>;
}
export function TitleDetail({ c, cfg, onProtectChange, onReclaim }: TitleDetailProps) {
	const [why, setWhy] = useState(false);
	const [n, u] = bytesParts(c.sizeOnDisk);
	const reclaimable = !(c.queue && c.queue.status === "reclaimed");
	return (
		<div className="detail">
			<Art src={c.poster} title={c.title} imgClass="thumb" fallbackClass="thumb noart" as="div" />
			<div className="main">
				<div className="fig"><span className="n">{n}</span><span className="u">{u}</span><ActionTag action={c.action} /></div>
				<QueueStatus c={c} cfg={cfg} />
				<ImpactBlock c={c} />
				<dl className="basis">
					<dt>Rated</dt><dd>{c.certification ? <Cert value={c.certification} /> : <span className="faint">Not rated</span>}</dd>
					<dt>Rule</dt><dd>{c.ruleName}</dd>
					<dt>Matched</dt><MatchedTree c={c} />
				</dl>
				<div className="acts">
					<WhyButton item={c} open={why} onToggle={() => setWhy(!why)} />
					<OpenInArrButton item={c} className="small" />
					<OpenInPlexButton item={c} className="small" />
					<ProtectButton item={c} className="small" onChange={onProtectChange} />
					{reclaimable ? <Button icon="trash" className="small danger" onAction={() => onReclaim(c)}>{`${actionLabel(c.action) === c.action ? "Run" : actionLabel(c.action)} now`}</Button> : null}
				</div>
			</div>
			{why ? <div className="x"><ExplainPanel item={c} /></div> : null}
		</div>
	);
}

/** The modal around <TitleDetail>. */
export function TitleDetailDialog(props: TitleDetailProps) {
	const dialog = useDialog();
	return (
		<DialogFrame title={nameOf(props.c)} onClose={dialog.close} foot={<Button onClick={dialog.close}>Close</Button>}>
			<TitleDetail {...props} />
		</DialogFrame>
	);
}
