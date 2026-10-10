import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Art } from "../../components/media/Art";
import { Button } from "../../components/ui/Button";
import { BadNotice, Empty, Notices } from "../../components/ui/Feedback";
import { Readout, ReadoutSkeleton } from "../../components/ui/Readout";
import { Segmented } from "../../components/ui/Segmented";
import { PageSkeleton } from "../../components/ui/Skeleton";
import { condToExpr, friendlyIssue, type CondNode } from "../../lib/expression";
import { bytes, kindLabel, plural, splitList } from "../../lib/format";
import { useAsync } from "../../hooks/useAsync";
import { useApi } from "../../providers/ApiProvider";
import { useCatalog } from "../../providers/CatalogProvider";
import { useDialog } from "../../providers/DialogProvider";
import type { Expr, LibraryRow, RuleTypeDef } from "../../types";
import { emptyFilter, LibraryFilter, type FilterState } from "./LibraryFilter";
import { LibraryDetailDialog } from "./LibraryDetailDialog";
import { hasFiles, libKey, SORTS, type SortKey } from "./librarySort";
import { useLibraryActions } from "./useLibraryActions";
import { AsyncView } from "../../components/ui/AsyncView";

const PAGE = 60;
type Svc = "all" | "radarr" | "sonarr";

export function LibraryPage() {
	const catalog = useCatalog();
	const state = useAsync(async () => {
		const [types, requesters] = await Promise.all([catalog.types(), catalog.requesters()]);
		return { types, requesters };
	}, []);
	return <AsyncView state={state} skeleton={<PageSkeleton />}>{(d) => <Library {...d} />}</AsyncView>;
}

function filterExpression(f: FilterState, types: RuleTypeDef[]): Expr | undefined {
	const items = f.conds.map((c: CondNode) => condToExpr(c, types));
	return !items.length ? undefined : items.length === 1 ? items[0] : { op: f.op, of: items };
}

function Library({ types, requesters }: { types: RuleTypeDef[]; requesters: string[] }) {
	const api = useApi();
	const dialog = useDialog();
	const [filter, setFilter] = useState<FilterState>(emptyFilter);
	const [rows, setRows] = useState<LibraryRow[]>([]);
	const [warnings, setWarnings] = useState<string[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [loaded, setLoaded] = useState(false);
	const [loading, setLoading] = useState(true);
	const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
	const [shown, setShown] = useState(PAGE);
	const [search, setSearch] = useState("");
	const [sort, setSort] = useState<SortKey>("title");
	const [svc, setSvc] = useState<Svc>("all");

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const r = await api.post<{ items: LibraryRow[]; warnings: string[] }>("/library", {
				expression: filterExpression(filter, types), excludeTags: splitList(filter.tags), excludeTitles: splitList(filter.titleRx),
			});
			setRows(r.items); setSelected(new Set()); setShown(PAGE); setWarnings(r.warnings); setError(null); setLoaded(true);
		} catch (e) {
			setError((e as Error).message.split("\n").map(friendlyIssue(types)).join(" · "));
		} finally { setLoading(false); }
	}, [api, filter, types]);
	useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

	const onApplied = useCallback((p: { removed?: Set<string>; update?: (d: LibraryRow) => LibraryRow }) => {
		if (p.removed) {
			setRows((rs) => rs.filter((d) => !p.removed!.has(libKey(d))));
			setSelected((s) => new Set([...s].filter((k) => !p.removed!.has(k))));
		}
		if (p.update) setRows((rs) => rs.map(p.update!));
	}, []);
	const actions = useLibraryActions(onApplied);

	const visible = useMemo(() => {
		const q = search.trim().toLowerCase();
		return rows.filter((d) => (svc === "all" || d.service === svc) && (!q || d.title.toLowerCase().includes(q))).sort(SORTS[sort][1]);
	}, [rows, search, svc, sort]);

	const more = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const el = more.current;
		if (!el) return;
		// new observer per page so a sentinel still in view keeps loading
		const io = new IntersectionObserver((e) => { if (e[0]?.isIntersecting) setShown((n) => n + PAGE); }, { rootMargin: "400px" });
		io.observe(el);
		return () => io.disconnect();
	}, [shown, visible.length]);

	const open = (d: LibraryRow) => dialog.open(<LibraryDetailDialog d={d} actions={actions} onClose={dialog.close} />, { kind: "wide" });
	const pickedRows = rows.filter((d) => selected.has(libKey(d)));
	const toggle = (d: LibraryRow, on: boolean) => setSelected((s) => { const n = new Set(s); on ? n.add(libKey(d)) : n.delete(libKey(d)); return n; });
	const total = visible.reduce((n, d) => n + d.sizeOnDisk, 0);
	const prot = visible.filter((d) => d.protectedId).length, noFile = visible.filter((d) => !hasFiles(d)).length;
	const allPicked = visible.length > 0 && visible.every((d) => selected.has(libKey(d)));

	return (
		<div>
			<Notices items={warnings} />
			{error ? null : loaded ? (
				<Readout n={total} title="on disk in your library" text={<>
					{plural(visible.length, "title")} · {plural(visible.filter((d) => d.itemType === "movie").length, "movie")} · {plural(visible.filter((d) => d.itemType === "series").length, "series")}
					{prot ? ` · ${prot} protected` : null}{noFile ? ` · ${noFile} with no file` : null}
				</>} />
			) : <ReadoutSkeleton />}
			<div className="row lib-tools">
				<Segmented label="Services" value={svc} onChange={(v) => { setSvc(v); setShown(PAGE); }} options={[["all", "All"], ["radarr", "Radarr"], ["sonarr", "Sonarr"]]} />
				<input type="search" placeholder="Search titles" aria-label="Search titles" value={search} onChange={(e) => { setSearch(e.target.value); setShown(PAGE); }} />
				<select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
					{(Object.keys(SORTS) as SortKey[]).map((k) => <option key={k} value={k}>{`Sort: ${SORTS[k][0]}`}</option>)}
				</select>
				<span className="grow" />
			</div>
			<LibraryFilter value={filter} onChange={setFilter} onApply={load} types={types} requesters={requesters} />
			<div className="lib-bar" hidden={!pickedRows.length}>
				<strong>{`${plural(pickedRows.length, "title")} selected · ${bytes(pickedRows.reduce((n, d) => n + d.sizeOnDisk, 0))}`}</strong>
				<span className="grow" />
				<Button icon="protected" className="small" onAction={() => actions.protectMany(pickedRows, true)}>Protect</Button>
				<Button icon="unprotected" className="small" onAction={() => actions.protectMany(pickedRows, false)}>Unprotect</Button>
				<Button icon="unmonitor" className="small" onAction={() => actions.remove(pickedRows, "unmonitor")}>Unmonitor</Button>
				<Button icon="trash" className="small" onAction={() => actions.remove(pickedRows, "delete_files")}>Delete files</Button>
				<Button icon="trash" className="small danger solid" onAction={() => actions.remove(pickedRows, "delete")}>Delete</Button>
				<Button className="small ghost" onClick={() => setSelected(new Set())}>Clear</Button>
			</div>
			{error ? <BadNotice>{error}</BadNotice>
				: loading && !loaded ? <div aria-busy="true"><div className="skeleton h" /><div className="skeleton" style={{ width: "60%" }} /></div>
				: visible.length ? (
					<div>
						<label className="row" style={{ margin: "8px 0 12px" }}>
							<input type="checkbox" aria-label="Select all matching" checked={allPicked} onChange={(e) => setSelected(new Set(e.target.checked ? visible.map(libKey) : []))} />Select all matching
						</label>
						<div className="posters">
							<div className="grid" role="list" aria-label="Library titles">
								{visible.slice(0, shown).map((d) => <LibraryCard key={libKey(d)} d={d} checked={selected.has(libKey(d))} onCheck={(on) => toggle(d, on)} onOpen={() => open(d)} />)}
							</div>
							{shown < visible.length ? <div ref={more} className="more" aria-hidden="true" /> : null}
						</div>
					</div>
				) : <Empty title="No titles match" text="Loosen the filter or search." />}
		</div>
	);
}

function LibraryCard({ d, checked, onCheck, onOpen }: { d: LibraryRow; checked: boolean; onCheck: (on: boolean) => void; onOpen: () => void }) {
	return (
		<div role="listitem" className="lib-poster">
			<button type="button" className={`poster ${hasFiles(d) ? "" : "keep"}`} aria-label={`${d.title}, ${bytes(d.sizeOnDisk)}`} onClick={onOpen}>
				<span className="art">
					<Art src={d.poster} title={d.title} fallbackClass="noart" lazy />
					{d.protectedId ? <span className="badge">Protected</span> : null}
					<span className="size">{d.sizeOnDisk ? bytes(d.sizeOnDisk) : "No file"}</span>
				</span>
				<span className="cap"><span className="t">{d.title}</span><span className="m">{[d.year, kindLabel(d.itemType), d.monitored ? null : "Unmonitored"].filter(Boolean).join(" · ")}</span></span>
			</button>
			<input type="checkbox" className="pickbox" checked={checked} aria-label={`Select ${d.title}`} onChange={(e) => onCheck(e.target.checked)} />
		</div>
	);
}
