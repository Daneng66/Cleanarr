import { Art } from "../../components/media/Art";
import { Cert } from "../../components/media/ItemBits";
import { useExplain } from "../../components/media/Explain";
import { OpenInArrButton, OpenInPlexButton } from "../../components/media/LinkButtons";
import { ProtectButton } from "../../components/media/ProtectButtons";
import type { ReactNode } from "react";
import { Button, IconButton } from "../../components/ui/Button";
import { Icon } from "../../components/ui/Icon";
import { Sk } from "../../components/ui/Skeleton";
import { StateBadge } from "../../components/ui/StateBadge";
import { ActionTag } from "../../components/ui/Tags";
import { DialogFrame } from "../../components/ui/DialogFrame";
import { ago, bytes, bytesParts, frees, kindLabel, nameOf, plural, seasonName } from "../../lib/format";
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
			{q.status === "failed" ? <StateBadge state="failed" label="Failed, retrying next run" />
				: q.status === "reclaimed" || q.status === "running" || q.status === "blocked" ? <StateBadge state={q.status} />
				: <StateBadge state="pending" label={`Queued · will be reclaimed ${new Date(q.executeAfter).getTime() <= Date.now() ? "on the next run" : ago(q.executeAfter)}`} />}
			{q.lastError ? <div className="help">{q.lastError}</div> : null}
		</div>
	);
}

/** What the action will do to this title, stated plainly. Series and seasons count their episode files from Sonarr. */
function ImpactBlock({ c, head }: { c: Candidate; head?: ReactNode }) {
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
	if (movie) return <div className={cls} role="status">{head}<p>{say()}</p></div>;
	if (eps.error) return <div className={cls} role="status">{head}<p>{say()}</p><div className="rows faint small">Couldn't count episodes in Sonarr right now.</div></div>;
	if (!eps.data) return <div className={cls} role="status">{head}<p>{say()}</p><div className="rows"><Sk kind="line short" /></div></div>;
	const seasons = eps.data;
	const k = seasons.reduce((t, s) => t + s.episodes.length, 0);
	return (
		<div className={cls} role="status">
			{head}
			<p>{say(k, seasons)}</p>
			{seasons.length > 1 && c.action !== "unmonitor" ? (
				<div className="rows">{seasons.map((s) => <div key={s.number}><span>{seasonName(s.number)}</span><span>{plural(s.episodes.length, "episode")}</span><span>{bytes(s.size)}</span></div>)}</div>
			) : ""}
		</div>
	);
}

/** The rule that flagged it, laid out like a verdict in the library details: name, action, badge, then one ticked row per satisfied condition. */
function MatchedRule({ c }: { c: Candidate }) {
	const rows = c.reasons?.length ? c.reasons : [{ text: plainReason(c.reason) }];
	return (
		<section className="matched" aria-label="Matched rule">
			<h3 className="sect">Matched rule</h3>
			<div className="verdict">
				<div className="row"><strong>{c.ruleName}</strong><ActionTag action={c.action} /><span className="grow" /><StateBadge state="matches" /></div>
				<ul className="tree">
					{rows.map((r, i) => <li key={i}><span className="st state yes" style={{ font: "inherit", whiteSpace: "normal" }}><Icon name="check" /><span>{r.text}</span></span></li>)}
				</ul>
			</div>
		</section>
	);
}

export interface TitleDetailProps {
	c: Candidate;
	cfg: Config;
	onProtectChange: () => void;
	/** Reclaims just this title; the caller owns confirmation and bookkeeping. */
	onReclaim: (c: Candidate) => Promise<void>;
}
export function TitleDetail({ c, cfg }: Pick<TitleDetailProps, "c" | "cfg">) {
	const [n, u] = bytesParts(c.sizeOnDisk);
	const { data: explain } = useExplain(c);
	// Sonarr folder names carry the TVDB id as "{tvdb-123}": show it as a link instead of in the path.
	const tvdbId = explain?.item.path?.match(/\{tvdb-(\d+)\}/)?.[1];
	const path = explain?.item.path?.replace(/\s*\{tvdb-\d+\}/g, "");
	return (
		<div className="detail">
			<Art src={c.poster} title={c.title} imgClass="thumb" fallbackClass="thumb noart" as="div" />
			<div className="main">
				<div className="fig"><span className="n">{n}</span><span className="u">{u}</span><ActionTag action={c.action} /></div>
				<dl className="basis props">
					<dt>Type</dt><dd>{kindLabel(c.itemType)}</dd>
					{c.seasonNumber != null ? <><dt>Season</dt><dd>{seasonName(c.seasonNumber)}</dd></> : null}
					{c.year ? <><dt>Year</dt><dd>{c.year}</dd></> : null}
					{c.certification ? <><dt>Rated</dt><dd><Cert value={c.certification} /></dd></> : null}
					{explain ? <><dt>Monitored</dt><dd>{explain.item.monitored ? "Yes" : "No"}</dd></> : null}
					{path ? <><dt className="path">Path</dt><dd className="path">{path}</dd></> : null}
				</dl>
				<div className="links">
					<OpenInArrButton item={c} className="small" />
					<OpenInPlexButton item={c} className="small" />
					{tvdbId ? <IconButton icon="tvdb" label="Open in TVDB" className="small" onClick={() => window.open(`https://www.thetvdb.com/?tab=series&id=${tvdbId}`, "_blank", "noopener")} /> : null}
				</div>
			</div>
			<div className="x">
				{cfg.dryRun ? <p className="mode"><b>Dry run.</b> Nothing is deleted; Cleanarr only records what it would do.</p> : null}
				<ImpactBlock c={c} head={<QueueStatus c={c} cfg={cfg} />} />
				<MatchedRule c={c} />
			</div>
		</div>
	);
}

/** The modal around <TitleDetail>; the footer holds only the two decisions. The links sit with the facts, and the header X closes. */
export function TitleDetailDialog({ c, cfg, onProtectChange, onReclaim }: TitleDetailProps) {
	const dialog = useDialog();
	const reclaimable = !(c.queue && c.queue.status === "reclaimed");
	const label = cfg.dryRun ? "Dry run now" : "Reclaim now";
	return (
		<DialogFrame title={nameOf(c)} onClose={dialog.close} foot={
			<div className="foot-row">
				<ProtectButton item={c} className="small" onChange={onProtectChange} />
				{reclaimable ? <Button icon="trash" className={`small${cfg.dryRun ? "" : " danger"}`} onAction={() => onReclaim(c)}>{label}</Button> : null}
			</div>
		}>
			<TitleDetail c={c} cfg={cfg} />
		</DialogFrame>
	);
}
