// Cleanarr UI. All DOM is built with textContent (never innerHTML) because titles/reasons come from external services.
const $ = (s) => document.querySelector(s);
const view = $("#view");
const dialog = $("#dialog");

function h(tag, attrs, ...kids) {
	const el = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs || {})) {
		if (v === false || v == null) continue;
		if (k === "class") el.className = v;
		else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
		else if (k in el && k !== "list") el[k] = v;
		else el.setAttribute(k, v === true ? "" : v);
	}
	for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
	return el;
}

// ── Icons: one 16px, 1.6-stroke set. State marks are the closed vocabulary used on every screen. ──
const ICONS = {
	loaded: [["rect", { x: 3, y: 3, width: 10, height: 10, rx: 1, fill: "currentColor", stroke: "none" }]],
	flagged: [["rect", { x: 2, y: 3, width: 8, height: 10, rx: 1, fill: "currentColor", stroke: "none" }], ["path", { d: "M12 5l3 3-3 3" }]],
	queued: [["rect", { x: 3, y: 3, width: 10, height: 10, rx: 1 }], ["rect", { x: 3, y: 8, width: 10, height: 5, fill: "currentColor", stroke: "none" }]],
	protected: [["path", { d: "M8 1.8l5.2 2v4.1c0 3.1-2.2 5.3-5.2 6.3-3-1-5.2-3.2-5.2-6.3V3.8z" }]],
	unknown: [["rect", { x: 3, y: 3, width: 10, height: 10, rx: 1, "stroke-dasharray": "2.2 2" }]],
	ejected: [["rect", { x: 3, y: 3, width: 10, height: 10, rx: 1 }], ["path", { d: "M3.5 12.5l9-9" }]],
	fault: [["path", { d: "M8 2l6.3 11.5H1.7z" }], ["path", { d: "M8 6.6v3.2M8 11.6v.1" }]],
	check: [["path", { d: "M3 8.5l3.2 3L13 4.5" }]],
	x: [["path", { d: "M4 4l8 8M12 4l-8 8" }]],
	refresh: [["path", { d: "M13.3 8.6A5.4 5.4 0 1 1 11.9 4" }], ["path", { d: "M13 2.2v3.2H9.8" }]],
	play: [["path", { d: "M5 3.3v9.4L12.4 8z" }]],
	up: [["path", { d: "M8 13V3.5M4 7.2L8 3.2l4 4" }]],
	down: [["path", { d: "M8 3v9.5M4 8.8l4 4 4-4" }]],
	edit: [["path", { d: "M10.6 2.6l2.8 2.8L6 12.8 2.6 13.4l.6-3.4z" }]],
	trash: [["path", { d: "M2.8 4.5h10.4M6.3 4.5V2.8h3.4v1.7M4.3 4.5l.7 8.7h6l.7-8.7" }]],
	plus: [["path", { d: "M8 3v10M3 8h10" }]],
	plug: [["path", { d: "M5.8 1.8v3M10.2 1.8v3M3.8 4.8h8.4v2.4a4.2 4.2 0 0 1-8.4 0zM8 11.4v2.8" }]],
	why: [["circle", { cx: 8, cy: 8, r: 6 }], ["path", { d: "M6.2 6.3a1.8 1.8 0 1 1 2.5 1.7c-.5.2-.7.6-.7 1.1v.3M8 11.2v.1" }]],
	code: [["path", { d: "M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5" }]],
	arrow: [["path", { d: "M3 8h10M9 4l4 4-4 4" }]],
};
function icon(name) {
	const NS = "http://www.w3.org/2000/svg";
	const s = document.createElementNS(NS, "svg");
	s.setAttribute("viewBox", "0 0 16 16"); s.setAttribute("class", "i"); s.setAttribute("aria-hidden", "true");
	for (const [tag, attrs] of ICONS[name]) { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); s.append(e); }
	return s;
}
const iconBtn = (name, label, onclick, cls = "") => h("button", { type: "button", class: `icon ${cls}`, "aria-label": label, title: label, onclick }, icon(name));

// mark, label, tone (tone defaults to the mark)
const STATES = {
	flagged: ["flagged", "Flagged"], matches: ["flagged", "Matches"],
	pending: ["queued", "Pending"], pending_approval: ["queued", "Awaiting approval"], retry_pending: ["queued", "Retry pending"], approved: ["queued", "Approved"], executing: ["queued", "Executing"], retry_executing: ["queued", "Retrying"], running: ["queued", "Running"],
	executed: ["ejected", "Executed"], removed: ["ejected", "Removed"], files_deleted: ["ejected", "Files deleted"], unmonitored: ["ejected", "Unmonitored"],
	completed: ["loaded", "Completed", "ok"], success: ["loaded", "Success", "ok"], protected: ["protected", "Protected"],
	rejected: ["loaded", "Rejected"], expired: ["loaded", "Expired"], skipped: ["loaded", "Skipped"], no_match: ["loaded", "No match"], out_of_scope: ["loaded", "Out of scope"],
	partial: ["unknown", "Partial"], unknown: ["unknown", "Unknown"],
	blocked: ["fault", "Blocked"], failed: ["fault", "Failed"], error: ["fault", "Error"],
};
function state(s, label) {
	const [mark, text, tone] = STATES[s] || ["loaded", String(s).replaceAll("_", " ")];
	return h("span", { class: `state ${tone || mark}` }, icon(mark), label ?? text);
}
const actionTag = (a) => h("span", { class: `tag ${a}` }, { delete: "Delete", unmonitor: "Unmonitor", delete_files: "Delete files", delete_season: "Delete season" }[a] || a);
const protectTag = () => h("span", { class: "tag protect" }, "Protect");

// ── API ────────────────────────────────────────────────────────────────────
const keyStore = { get: () => { try { return localStorage.getItem("cleanarr.key") || ""; } catch { return ""; } }, set: (v) => { try { localStorage.setItem("cleanarr.key", v); } catch {} } };
async function api(path, { method = "GET", body } = {}) {
	const res = await fetch(`/api${path}`, {
		method,
		headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(keyStore.get() ? { Authorization: `Bearer ${keyStore.get()}` } : {}) },
		body: body !== undefined ? JSON.stringify(body) : undefined,
	});
	if (res.status === 401) { await askKey(); return api(path, { method, body }); }
	if (res.status === 204) return null;
	const data = await res.json().catch(() => ({}));
	if (!res.ok) { const e = new Error(data.issues ? data.issues.join("\n") : data.error || res.statusText); e.code = data.code; throw e; }
	return data;
}
let keyPrompt = null;
function askKey() {
	return (keyPrompt ??= new Promise((resolve) => {
		const input = h("input", { type: "password", placeholder: "API key", autocomplete: "current-password", autofocus: true });
		const go = () => { keyStore.set(input.value); keyPrompt = null; dialog.close(); resolve(); };
		input.addEventListener("keydown", (e) => e.key === "Enter" && go());
		openDialog({ title: "Sign in", lede: "This Cleanarr instance requires its API key (CLEANARR_API_KEY).", body: [h("div", { class: "field" }, h("label", { class: "lbl" }, "API key"), input)], foot: [h("button", { type: "button", class: "primary", onclick: go }, "Continue")] });
	}));
}

// ── Feedback ───────────────────────────────────────────────────────────────
let toastTimer;
function toast(msg, bad = false) { const t = $("#toast"); t.replaceChildren(icon(bad ? "fault" : "check"), msg); t.className = bad ? "show bad" : "show"; clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 4000); }
const fail = (e) => toast(e.message.split("\n")[0], true);
async function guard(btn, fn) { btn.disabled = true; btn.classList.add("busy"); try { await fn(); } catch (e) { fail(e); } finally { btn.disabled = false; btn.classList.remove("busy"); } }
const notice = (...kids) => h("div", { class: "notice", role: "note" }, icon("unknown"), h("div", {}, ...kids));
const badNotice = (...kids) => h("div", { class: "notice bad", role: "alert" }, icon("fault"), h("div", {}, ...kids));
const empty = (title, text, ...actions) => h("div", { class: "empty" }, h("div", { class: "h" }, title), text ? h("p", {}, text) : null, actions.length ? h("div", { class: "row", style: "justify-content:center" }, ...actions) : null);

function openDialog({ kind = "", title, lede, body = [], foot = [], onClose }) {
	dialog.className = kind;
	const x = onClose ? iconBtn("x", "Close", onClose, "ghost dlg-close") : null;
	dialog.replaceChildren(h("div", { class: "dlg-head" }, h("h2", {}, title), lede ? h("p", { class: "lede" }, lede) : null, x), h("div", { class: "dlg-body" }, ...body), foot.length ? h("div", { class: "dlg-foot" }, ...foot) : null);
	if (!dialog.open) dialog.showModal();
}
const closeBtn = (label = "Close") => h("button", { type: "button", onclick: () => dialog.close() }, label);
/** In-page confirmation; resolves true only when the action button is pressed. */
function ask({ title, text, action, danger = false }) {
	return new Promise((resolve) => {
		let done = false;
		const finish = (v) => { if (done) return; done = true; if (dialog.open) dialog.close(); resolve(v); };
		openDialog({ title, lede: text, foot: [h("button", { type: "button", onclick: () => finish(false) }, "Cancel"), h("button", { type: "button", class: danger ? "danger solid" : "primary", onclick: () => finish(true) }, action)] });
		dialog.addEventListener("close", () => finish(false), { once: true });
	});
}

// ── Format ─────────────────────────────────────────────────────────────────
const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];
function bytesParts(n) { if (!n) return ["0", "B"]; const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), 5); const v = n / 1024 ** i; return [v.toFixed(i < 2 ? 0 : v >= 100 ? 0 : 1), UNITS[i]]; }
const bytes = (n) => bytesParts(n).join(" ");
const when = (s) => (s ? new Date(s).toLocaleString() : "—");
function ago(s) {
	if (!s) return "—";
	const d = (new Date(s).getTime() - Date.now()) / 1000, a = Math.abs(d);
	const [v, u] = a < 60 ? [a, "s"] : a < 3600 ? [a / 60, "min"] : a < 86400 ? [a / 3600, "h"] : [a / 86400, "d"];
	const t = `${Math.round(v)} ${u}`;
	return d < 0 ? `${t} ago` : `in ${t}`;
}
const timeEl = (s) => h("time", { dateTime: s || "", title: when(s) }, ago(s));
const plural = (n, one, many = one + "s") => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const kindLabel = (k) => ({ movie: "Movie", series: "Series", season: "Season" }[k] || k);
// Season items carry their series' title; the season number tells them apart.
const nameOf = (x) => (x.seasonNumber != null ? `${x.title} · Season ${x.seasonNumber}` : x.title);
const frees = (x) => x.action !== "unmonitor";
const sum = (rows) => rows.filter(frees).reduce((n, r) => n + (r.sizeOnDisk || 0), 0);
const uid = () => `f${Math.random().toString(36).slice(2, 9)}`;

// ── Router ─────────────────────────────────────────────────────────────────
const routes = { dashboard: renderDashboard, rules: renderRules, approvals: renderApprovals, history: renderHistory, instances: renderInstances, settings: renderSettings };
const titles = { dashboard: "Dashboard", rules: "Rules", approvals: "Approvals", history: "History", instances: "Instances", settings: "Settings" };
let current = "dashboard", waiting = 0, routeSeq = 0;
function paintNav() {
	$("#nav").replaceChildren(...Object.entries(titles).map(([k, v]) => h("a", { href: `#/${k}`, class: k === current ? "active" : "", "aria-current": k === current ? "page" : null }, v, k === "approvals" && waiting ? h("span", { class: "count", "aria-label": `${waiting} waiting` }, waiting) : null)));
}
async function route() {
	const seq = ++routeSeq;
	current = location.hash.slice(2).split(/[/?]/)[0] || "dashboard";
	if (!routes[current]) current = "dashboard";
	document.title = `${titles[current]} · Cleanarr`;
	paintNav();
	view.replaceChildren(current === "dashboard" ? dashboardSkeleton() : h("div", { "aria-busy": "true" }, h("div", { class: "skeleton h" }), h("div", { class: "skeleton", style: "width:60%" }), h("div", { class: "skeleton", style: "width:40%" })));
	try { const el = await routes[current](); if (seq === routeSeq) view.replaceChildren(el); }
	catch (e) { if (seq === routeSeq) view.replaceChildren(h("div", { class: "panel" }, empty("Couldn't load this page", e.message, h("button", { type: "button", onclick: route }, icon("refresh"), "Try again")))); }
	refreshMode();
}
async function refreshMode() {
	try {
		const s = await api("/status");
		const m = $("#mode");
		const [cls, txt] = s.config.dryRun ? ["dry", "Dry run"] : s.config.requireApproval ? ["live", "Live · approval"] : ["auto", "Live · automatic"];
		m.className = `mode ${cls}`; m.querySelector(".txt").textContent = txt;
		const n = (s.approvals.pending || 0) + (s.approvals.retry_pending || 0);
		if (n !== waiting) { waiting = n; paintNav(); }
	} catch {}
}
window.addEventListener("hashchange", route);

// ── Dashboard ──────────────────────────────────────────────────────────────
let lastPreview = null; // { at, data } so returning to the dashboard doesn't re-read every service
async function renderDashboard() {
	const [s, instances, pending, rules] = await Promise.all([api("/status"), api("/instances"), api("/approvals?status=pending"), api("/rules")]);
	const libs = instances.filter((i) => i.type === "sonarr" || i.type === "radarr");
	const cleanupRules = rules.filter((r) => r.enabled && r.mode === "cleanup");
	const out = h("div");
	const notices = h("div", { class: "notices" });
	if (s.config.dryRun && libs.length) notices.append(notice("Dry run is on: runs only report what they would do, and nothing reaches the mailslot. ", h("a", { href: "#/settings" }, "Turn it off in Settings"), " once the preview looks right."));
	const main = h("div");
	const slot = mailslot(pending, s.config);
	const jump = pending.length ? h("button", { type: "button", class: "jump", onclick: () => slot.scrollIntoView({ behavior: "smooth", block: "start" }) }, h("span", { class: "lampdot" }), `${pending.length} waiting in the mailslot · ${bytes(sum(pending))}`, icon("down")) : null;
	out.append(notices, h("div", { class: "deck" }, main, slot));

	if (!libs.length) {
		main.append(readout(null, "Connect your library", "Add Sonarr or Radarr and Cleanarr shows what your rules would remove here."),
			posterState("empty", "No library connected", "Titles your rules would remove show up here as posters, largest first.", h("button", { type: "button", onclick: () => { location.hash = "#/instances"; editInstance(); } }, icon("plus"), "Add Sonarr or Radarr")));
		return out;
	}
	if (!cleanupRules.length) {
		main.append(readout(null, "No cleanup rules yet", "Write a rule and the preview shows exactly what it would pull, before anything changes."),
			posterState("empty", "Nothing to pull yet", "Rules decide which titles go, e.g. added over a year ago and not watched in 180 days.", h("button", { type: "button", onclick: () => { location.hash = "#/rules"; editRule(); } }, icon("plus"), "Write a rule")),
			lastRunPanel(s.lastRun));
		const lib = h("div", {}, libraryPanel(null)); main.prepend(lib);
		api("/preview", { method: "POST" }).then((p) => lib.replaceChildren(libraryPanel(p.library))).catch(() => lib.replaceChildren());
		return out;
	}

	const head = h("div"), strip = h("div"), drivers = h("div"), warn = h("div"), lib = h("div", {}, libraryPanel(null));
	main.append(lib, head, strip, warn, drivers, lastRunPanel(s.lastRun));
	const runBtn = h("button", { type: "button", class: "primary", onclick: (e) => guard(e.currentTarget, async () => {
		const text = s.config.dryRun ? "This is a dry run: Cleanarr records what it would do and changes nothing." : s.config.requireApproval ? "Matches go to the mailslot. Nothing is removed until you approve it." : "Automatic mode is on: matching items are removed immediately, without approval.";
		if (!(await ask({ title: "Run cleanup now?", text, action: s.config.dryRun ? "Run dry run" : s.config.requireApproval ? "Run and queue" : "Run and remove", danger: !s.config.dryRun && !s.config.requireApproval }))) return;
		const r = await api("/run", { method: "POST", body: {} });
		toast(`Run ${r.status}: ${r.itemsFlagged} flagged, ${r.itemsRemoved} removed`);
		lastPreview = null; route();
	}) }, icon("play"), "Run now");
	const refreshBtn = h("button", { type: "button", onclick: (e) => guard(e.currentTarget, () => load(true)) }, icon("refresh"), "Refresh");
	const acts = h("div", { class: "acts" }, refreshBtn, runBtn);

	async function load(force) {
		if (force || !lastPreview || Date.now() - lastPreview.at > 5 * 60_000) {
			if (!force) { head.replaceChildren(readoutSkeleton(acts)); strip.replaceChildren(posterSkeleton()); }
			lastPreview = { at: Date.now(), data: await api("/preview", { method: "POST" }) };
		}
		paint(lastPreview.data);
	}
	function paint(p) {
		const flagged = p.candidates, reclaim = sum(flagged), ruleCount = new Set(flagged.map((c) => c.ruleId)).size;
		const nw = (t) => h("span", { class: "nw" }, t);
		const facts = flagged.length
			? [nw(`${plural(flagged.length, "title")} flagged by ${plural(ruleCount, "rule")}`), " · ", nw(`${plural(p.evaluated, "title")} evaluated`)]
			: `${plural(p.evaluated, "title")} evaluated. Your rules match nothing right now.`;
		head.replaceChildren(readout(reclaim, "reclaimable by your rules", facts, acts, jump));
		const skippedLink = h("a", { href: "#", onclick: (e) => { e.preventDefault(); openDialog({ kind: "wide", title: plural(p.skipped.length, "skipped title"), lede: "Missing evidence never matches a cleanup rule, so these were left alone.", body: [detailTable(p.skipped, false)], foot: [closeBtn()] }); } }, "See why");
		warn.replaceChildren(...(p.warnings.length || p.skipped.length ? [h("div", { class: "notices", style: "margin-top:16px" }, ...p.warnings.map((w) => notice(w)), p.skipped.length ? notice(`${plural(p.skipped.length, "title")} skipped. `, skippedLink) : null)] : []));
		strip.replaceChildren(flagged.length ? posterGrid(flagged) : posterState("empty", "Shelf is clear", "No title matches a cleanup rule. Loosen a rule or check back after more is added.", h("a", { class: "btn", href: "#/rules" }, "Review rules")));
		drivers.replaceChildren(flagged.length ? driversPanel(flagged) : "");
		lib.replaceChildren(libraryPanel(p.library));
	}
	load(false).catch((e) => { lib.replaceChildren(); head.replaceChildren(readout(null, "Preview failed", e.message, acts)); strip.replaceChildren(posterState("empty", "Couldn't read the library", "Check that your instances are reachable, then refresh.", h("a", { class: "btn", href: "#/instances" }, "Check instances"))); });
	return out;
}

function readout(n, title, text, acts, extra) {
	const fig = n == null ? null : h("div", { class: "fig" }, h("span", { class: "n" }, bytesParts(n)[0]), h("span", { class: "u" }, bytesParts(n)[1]));
	return h("div", { class: "readout" }, fig, h("div", { class: "what" }, h(n == null ? "h1" : "div", { class: "h" }, title), h("p", {}, text), extra || null), acts || null);
}
// ── Loading skeletons: same boxes as the real dashboard, so nothing jumps when data lands. ──
const sk = (cls) => h("span", { class: `sk ${cls}`, "aria-hidden": "true" });
function readoutSkeleton(acts) {
	return h("div", { class: "readout" }, h("div", { class: "fig" }, sk("fig")),
		h("div", { class: "what" }, h("h1", { class: "h" }, "Reading your library…"), h("p", {}, "Evaluating every title against your rules. Preview never changes anything.")), acts || null);
}
function posterSkeleton() {
	return h("div", { class: "posters", "aria-busy": "true" },
		h("div", { class: "scale" }, sk("line short"), sk("line tiny")),
		h("div", { class: "grid" }, Array.from({ length: 12 }, () => h("div", {}, sk("art"), sk("line"), sk("line short")))));
}
function dashboardSkeleton() {
	return h("div", { "aria-busy": "true" }, h("div", { class: "deck" },
		h("div", {}, libraryPanel(null), readoutSkeleton(), posterSkeleton()),
		h("aside", { class: "panel" }, h("div", { class: "panel-head" }, sk("line short")), h("div", { class: "panel-body" }, sk("block")))));
}
function posterState(kind, title, text, action) {
	return h("div", { class: `posters state ${kind}` },
		h("div", { class: "grid", "aria-hidden": "true" }, Array.from({ length: 12 }, () => h("div", { class: "ph" }))),
		title ? h("div", { class: "over" }, h("div", {}, h("div", { class: "h" }, title), h("p", {}, text), action || null)) : null);
}
// Stable 6-character barcode label per title, like an LTO cartridge's volser.
function volser(d) { let x = 2166136261; for (const ch of `${d.instanceId}:${d.itemType}:${d.arrItemId}${d.seasonNumber != null ? `:${d.seasonNumber}` : ""}`) x = Math.imul(x ^ ch.charCodeAt(0), 16777619); return (x >>> 0).toString(36).toUpperCase().padStart(6, "0").slice(-6); }
const vol = (d) => h("span", { class: "vol", title: "Cartridge label" }, volser(d));
const PAGE_POSTERS = 48;
function posterGrid(flagged) {
	const sorted = [...flagged].sort((a, b) => b.sizeOnDisk - a.sizeOnDisk);
	const grid = h("div", { class: "grid", role: "list", "aria-label": "Flagged titles, largest first" });
	const more = h("button", { type: "button", class: "more", onclick: () => paint(sorted.length) });
	const paint = (n) => {
		grid.replaceChildren(...sorted.slice(0, n).map(posterCard));
		more.hidden = n >= sorted.length;
		more.textContent = `Show all ${sorted.length}`;
	};
	paint(PAGE_POSTERS);
	const total = sum(flagged);
	return h("div", { class: "posters" },
		h("div", { class: "scale" }, h("span", {}, `${plural(flagged.length, "title")} · largest first`), h("span", {}, `${bytes(total)} frees space`)),
		grid, more);
}
function posterCard(c) {
	const art = c.poster
		? h("img", { src: c.poster, alt: "", loading: "lazy", decoding: "async", onerror: (e) => e.target.replaceWith(h("span", { class: "noart" }, c.title)) })
		: h("span", { class: "noart" }, c.title);
	return h("div", { role: "listitem" }, h("button", { type: "button", class: `poster ${frees(c) ? "" : "keep"}`, "aria-label": `${nameOf(c)}, ${bytes(c.sizeOnDisk)}, ${c.ruleName}`, onclick: () => openDialog({ kind: "wide", title: nameOf(c), body: [titleDetail(c)], foot: [closeBtn()], onClose: () => dialog.close() }) },
		h("span", { class: "art" }, art, c.seasonNumber != null ? h("span", { class: "badge" }, `S${c.seasonNumber}`) : null, h("span", { class: "size" }, bytes(c.sizeOnDisk))),
		h("span", { class: "cap" }, h("span", { class: "t" }, c.title), h("span", { class: "m" }, c.ruleName))));
}
function titleDetail(c) {
	const why = h("div", { class: "x", hidden: true });
	const [n, u] = bytesParts(c.sizeOnDisk);
	const art = c.poster ? h("img", { src: c.poster, alt: "", class: "thumb", onerror: (e) => e.target.replaceWith(h("div", { class: "thumb noart" }, c.title)) }) : h("div", { class: "thumb noart" }, c.title);
	return h("div", { class: "detail" }, art,
		h("div", { class: "main" },
			h("div", { class: "fig" }, h("span", { class: "n" }, n), h("span", { class: "u" }, u), actionTag(c.action)),
			impactBlock(c),
			h("dl", { class: "basis" },
				h("dt", {}, "Rated"), h("dd", {}, c.certification ? h("span", { class: "cert" }, c.certification) : h("span", { class: "faint" }, "Not rated")),
				h("dt", {}, "Rule"), h("dd", {}, c.ruleName), h("dt", {}, "Matched"), h("dd", {}, plainReason(c.reason))),
			h("div", { class: "acts" }, whyButton(c, why))),
		why);
}
// Evaluation reasons for AND/OR rules arrive wrapped in one pair of brackets; drop it for reading.
function plainReason(r) {
	if (!r.startsWith("(") || !r.endsWith(")")) return r;
	let depth = 0;
	for (let i = 0; i < r.length - 1; i++) { depth += r[i] === "(" ? 1 : r[i] === ")" ? -1 : 0; if (depth === 0) return r; }
	return r.slice(1, -1);
}
/** What the action will do to this title, stated plainly. Series and seasons count their episode files from Sonarr. */
function impactBlock(c) {
	const destroys = frees(c);
	const el = h("div", { class: `impact ${destroys ? "destroys" : ""}`, role: "status" });
	const files = (k) => (k == null ? "its episode files" : plural(k, "episode file"));
	const say = (k, seasons) => {
		const where = seasons?.length === 1 && c.seasonNumber == null ? ` in ${seasonName(seasons[0].number)}` : "";
		if (c.itemType === "movie") return { delete: "Removes the movie from Radarr and deletes its file.", delete_files: "Deletes the file. The movie stays in Radarr.", unmonitor: "Radarr stops monitoring it. The file stays on disk." }[c.action];
		return {
			delete_season: `Deletes ${files(k)} and stops monitoring ${seasonName(c.seasonNumber)}. The rest of the show stays.`,
			delete: `Removes the series from Sonarr and deletes ${files(k)}${where}.`,
			delete_files: `Deletes ${files(k)}${where}. The series stays in Sonarr.`,
			unmonitor: `Sonarr stops monitoring it. ${k == null ? "Its episode files stay" : `${plural(k, "episode file")} stay`} on disk.`,
		}[c.action];
	};
	if (c.itemType === "movie") return el.append(h("p", {}, say())), el;
	el.append(h("p", {}, say()), h("div", { class: "rows" }, sk("line short")));
	const q = c.seasonNumber != null ? `?season=${c.seasonNumber}` : "";
	api(`/series/${encodeURIComponent(c.instanceId)}/${c.arrItemId}/episodes${q}`).then((seasons) => {
		const k = seasons.reduce((t, s) => t + s.episodes.length, 0);
		const rows = seasons.length > 1 && c.action !== "unmonitor"
			? h("div", { class: "rows" }, seasons.map((s) => h("div", {}, h("span", {}, seasonName(s.number)), h("span", {}, plural(s.episodes.length, "episode")), h("span", {}, bytes(s.size)))))
			: "";
		el.replaceChildren(h("p", {}, say(k, seasons)), rows);
	}).catch(() => el.replaceChildren(h("p", {}, say()), h("div", { class: "rows faint small" }, "Couldn't count episodes in Sonarr right now.")));
	return el;
}
const seasonName = (n) => (n === 0 ? "Specials" : `Season ${n}`);
function driversPanel(flagged) {
	const by = new Map();
	for (const c of flagged) { const r = by.get(c.ruleId) || { name: c.ruleName, action: c.action, n: 0, b: 0 }; r.n++; if (frees(c)) r.b += c.sizeOnDisk; by.set(c.ruleId, r); }
	const rows = [...by.values()].sort((a, b) => b.b - a.b), max = rows[0]?.b || 1;
	return h("section", { style: "margin-top:28px" }, h("div", { class: "section-title" }, h("h2", { class: "grow" }, "What's driving it"), h("a", { href: "#/rules", class: "small" }, "Edit rules")),
		h("div", { class: "panel" }, h("ul", { class: "drivers" }, rows.map((r) => h("li", {},
			h("div", { class: "nm" }, h("strong", {}, r.name), actionTag(r.action)),
			h("div", { class: "bar", "aria-hidden": "true" }, h("span", { style: `width:${r.b ? Math.max((r.b / max) * 100, 1) : 0}%` })),
			h("div", { class: "v" }, bytes(r.b), h("small", {}, plural(r.n, "title"))))))));
}
/** Library totals; `null` renders the same panel with placeholder values while the preview loads. */
function libraryPanel(l) {
	const stat = (label, value, sub) => h("div", {}, h("div", { class: "k" }, label), l ? h("div", { class: "n" }, value) : sk("val"), l ? h("small", {}, sub) : sk("line short"));
	return h("section", { style: "margin-bottom:28px", "aria-busy": l ? null : "true" }, h("div", { class: "section-title" }, h("h2", { class: "grow" }, "Library")),
		h("div", { class: "panel stats" },
			stat("Total size", l && bytes(l.totalBytes), l && plural(l.movies + l.series, "title")),
			stat("Movies", l?.movies.toLocaleString(), l && bytes(l.movieBytes)),
			stat("Series", l?.series.toLocaleString(), l && `${plural(l.files, "episode")} · ${bytes(l.seriesBytes)}`),
			stat("Missing files", l?.missing.toLocaleString(), "no file on disk")));
}
function lastRunPanel(r) {
	if (!r) return h("section", { style: "margin-top:28px" }, h("div", { class: "panel lastrun" }, state("loaded", "No runs yet"), h("span", {}, "Run now, or turn on the schedule in ", h("a", { href: "#/settings" }, "Settings"), ".")));
	return h("section", { style: "margin-top:28px" }, h("div", { class: "section-title" }, h("h2", { class: "grow" }, "Last run"), h("a", { href: "#/history", class: "small" }, "All runs")),
		h("div", { class: "panel" }, h("div", { class: "lastrun" }, state(r.status), h("span", { class: "tag" }, r.isDryRun ? "Dry run" : "Live"), timeEl(r.startedAt), h("span", {}, `${r.itemsEvaluated} evaluated · ${r.itemsFlagged} flagged · ${r.itemsRemoved} removed · ${r.itemsSkipped} skipped`), r.warnings.length ? h("a", { href: "#/history" }, plural(r.warnings.length, "warning")) : null)));
}

function mailslot(pending, config) {
	const has = pending.length > 0;
	const list = h("ul", { class: "queue" });
	const decide = (a, action, li) => async (e) => {
		const btn = e.currentTarget;
		if (action === "approve" && !(await ask({ title: `Remove “${nameOf(a)}” now?`, text: `${bytes(a.sizeOnDisk)} · ${a.ruleName}. Cleanarr re-checks it against live data first and blocks the removal if anything changed.`, action: "Approve and remove", danger: true }))) return;
		await guard(btn, async () => {
			const r = await api("/approvals/bulk", { method: "POST", body: { ids: [a.id], action } });
			const bad = r.results.find((x) => !x.ok);
			if (bad) throw new Error(bad.error);
			toast(action === "approve" ? `Approved ${nameOf(a)}` : `Rejected ${nameOf(a)}`);
			li.classList.add("leaving"); lastPreview = null; setTimeout(route, 200);
		});
	};
	for (const a of pending.slice(0, 6)) {
		const li = h("li");
		li.append(h("div", { class: "t", title: nameOf(a) }, nameOf(a), a.year ? ` (${a.year})` : ""), h("div", { class: "m" }, vol(a), ` ${bytes(a.sizeOnDisk)} · ${a.ruleName}`),
			h("div", { class: "a" }, iconBtn("x", `Reject ${nameOf(a)}`, decide(a, "reject", li)), iconBtn("check", `Approve ${nameOf(a)}`, decide(a, "approve", li), "danger")));
		list.append(li);
	}
	const body = has ? list
		: config.dryRun ? empty("Nothing queued in dry run", "With dry run off and approval on, every match waits here for your decision.")
		: !config.requireApproval ? empty("Automatic mode", "Matches are removed without waiting here.", h("a", { class: "btn", href: "#/settings" }, "Require approval"))
		: empty("Nothing waiting", "New matches arrive after the next run.");
	return h("aside", { class: `mailslot ${has ? "has" : ""}`, "aria-label": "Approval mailslot" },
		h("div", { class: "panel" }, h("div", { class: "panel-head" }, h("span", { class: "lamp" }), h("h2", {}, "Mailslot"), has ? h("span", { class: "sum" }, `${pending.length} · ${bytes(sum(pending))}`) : null),
			body,
			has ? h("div", { class: "foot" }, h("a", { class: "btn", href: "#/approvals" }, pending.length > 6 ? `Review all ${pending.length}` : "Open the queue", icon("arrow"))) : null));
}

function detailTable(rows, withWhy) {
	if (!rows.length) return empty("Nothing to show");
	const body = h("tbody");
	for (const d of rows) {
		const x = h("div", { class: "x" }), xr = h("tr", { class: "xrow", hidden: true }, h("td", { colSpan: withWhy ? 6 : 5 }, x));
		body.append(h("tr", {}, h("td", {}, nameOf(d), h("div", { class: "sub" }, kindLabel(d.itemType), " · ", vol(d))), h("td", {}, d.ruleName, h("div", { class: "sub" }, actionTag(d.action))), h("td", { class: "small" }, d.reason), h("td", { class: "num mono" }, bytes(d.sizeOnDisk)),
			h("td", {}, state(d.outcome), d.message ? h("div", { class: "sub" }, d.message) : null), withWhy ? h("td", { class: "num" }, whyButton(d, x, xr, "small")) : null), xr);
	}
	return h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Title"), h("th", {}, "Rule"), h("th", {}, "Reason"), h("th", { class: "num" }, "Size"), h("th", {}, "Result"), withWhy ? h("th", {}) : null)), body));
}
/** "Why?" expands the per-rule, per-condition evaluation in place under the item (read-only, so no modal). */
function whyButton(d, slot, wrap = slot, cls = "", iconOnly = false) {
	const btn = h("button", { type: "button", class: cls, "aria-expanded": "false", "aria-label": `Why is ${nameOf(d)} flagged?`, onclick: () => guard(btn, async () => {
		const open = btn.getAttribute("aria-expanded") === "true";
		btn.setAttribute("aria-expanded", String(!open));
		if (open) { wrap.hidden = true; slot.replaceChildren(); return; }
		wrap.hidden = false; slot.replaceChildren(h("div", { class: "skeleton", style: "width:50%" }));
		try { slot.replaceChildren(explainBody(await api("/explain", { method: "POST", body: { instanceId: d.instanceId, arrItemId: d.arrItemId, seasonNumber: d.seasonNumber ?? null } }))); }
		catch (e) { slot.replaceChildren(badNotice(e.message)); }
	}) }, icon("why"), iconOnly ? null : "Why?");
	return btn;
}
function explainBody(e) {
	const mark = { true: ["check", "st state yes"], false: ["x", "st state loaded"], unknown: ["unknown", "st state unknown"] };
	const tree = (n) => { const [ic, cls] = mark[n.state] || mark.unknown; return h("li", {}, h("span", { class: cls, style: "font:inherit;white-space:normal" }, icon(ic), n.type ? h("span", { class: n.state === "true" ? "" : "muted" }, n.reason) : h("span", { class: "op" }, n.op.toUpperCase())), n.children ? h("ul", {}, n.children.map(tree)) : null); };
	const verdict = (r) => !r.inScope ? state("out_of_scope") : r.state === "true" ? (r.mode === "retention" ? state("protected", "Protects it") : state("matches")) : r.state === "false" ? state("no_match") : state("unknown");
	return h("div", { class: "explain" },
		h("div", { class: "itemfacts" }, h("span", {}, e.item.seasonNumber != null ? `Season ${e.item.seasonNumber}` : kindLabel(e.item.kind)), h("span", {}, h("b", {}, bytes(e.item.sizeOnDisk))), h("span", {}, e.item.monitored ? "Monitored" : "Unmonitored"), e.item.path ? h("span", { class: "mono" }, e.item.path) : null),
		e.warnings.length ? h("div", { class: "notices" }, e.warnings.map((w) => notice(w))) : null,
		e.rules.map((r) => h("div", { class: "verdict" }, h("div", { class: "row" }, h("strong", {}, r.name), r.mode === "retention" ? protectTag() : actionTag(r.action), h("span", { class: "grow" }), verdict(r)), r.excludedBy ? h("div", { class: "help" }, r.excludedBy) : null, r.tree ? h("ul", { class: "tree" }, tree(r.tree)) : null)));
}

// ── Rules ──────────────────────────────────────────────────────────────────
let ruleTypes = [];
async function renderRules() {
	const [rules, types, templates, instances] = await Promise.all([api("/rules"), api("/rule-types"), api("/rule-templates"), api("/instances")]);
	ruleTypes = types;
	const out = h("div", {}, h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Rules"), h("p", { class: "lede" }, "Evaluated top to bottom. The first matching cleanup rule decides what happens; protect rules always win.")), h("button", { type: "button", class: "primary", onclick: () => editRule() }, icon("plus"), "New rule")));
	if (!rules.length) return out.append(h("div", { class: "panel" }, empty("No rules yet", "Start from a template below or write your own. The dashboard previews exactly what a rule would match before anything changes.")), templatesSection(templates, instances, true)), out;
	const move = async (i, d) => { const ids = rules.map((r) => r.id); [ids[i], ids[i + d]] = [ids[i + d], ids[i]]; try { await api("/rules/reorder", { method: "PUT", body: { ids } }); lastPreview = null; route(); } catch (e) { fail(e); } };
	const toggle = async (r, e, li) => { const on = e.target.checked; try { await api(`/rules/${r.id}`, { method: "PUT", body: { enabled: on } }); li.classList.toggle("off", !on); lastPreview = null; } catch (x) { e.target.checked = !on; fail(x); } };
	const remove = async (r) => { if (!(await ask({ title: `Delete “${r.name}”?`, text: "The rule is removed. Its history stays in the audit trail.", action: "Delete rule", danger: true }))) return; try { await api(`/rules/${r.id}`, { method: "DELETE" }); lastPreview = null; route(); } catch (e) { fail(e); } };
	const row = (r, i) => {
		const li = h("li", { class: r.enabled ? "" : "off" });
		const up = iconBtn("up", "Move up", () => move(i, -1), "ghost"), down = iconBtn("down", "Move down", () => move(i, 1), "ghost");
		up.disabled = i === 0; down.disabled = i === rules.length - 1;
		li.append(h("div", { class: "slotno", title: `Priority ${i + 1}` }, String(i + 1).padStart(2, "0")),
			h("input", { type: "checkbox", class: "toggle", checked: r.enabled, "aria-label": `${r.name} enabled`, onchange: (e) => toggle(r, e, li) }),
			h("div", { class: "body" }, h("div", { class: "nm" }, h("strong", {}, r.name), r.mode === "retention" ? protectTag() : actionTag(r.action)), h("div", { class: "expr" }, humanExpr(r.expression))),
			h("div", { class: "acts" }, up, down, iconBtn("edit", `Edit ${r.name}`, () => editRule(r), "ghost"), iconBtn("trash", `Delete ${r.name}`, () => remove(r), "ghost danger")));
		return li;
	};
	out.append(h("div", { class: "panel" }, h("ul", { class: "rules" }, rules.map(row))), templatesSection(templates, instances));
	return out;
}
function templatesSection(templates, instances, open) {
	const has = (t) => instances.some((i) => i.enabled && i.type === t);
	const needs = (n) => [n.watch && ["Plex", "plex"], n.seerr && ["Seerr", "seerr"]].filter(Boolean);
	const row = (t) => {
		const missing = needs(t.needs).filter(([, k]) => !has(k)).map(([l]) => l);
		return h("li", {},
			h("div", { class: "body" }, h("div", { class: "nm" }, h("strong", {}, t.title), t.mode === "retention" ? protectTag() : actionTag(t.action)),
				h("p", { class: "desc" }, t.description),
				h("div", { class: "expr" }, humanExpr(t.expression)),
				missing.length ? h("div", { class: "need" }, state("unknown", `Needs ${missing.join(" and ")} connected`)) : null),
			h("div", { class: "acts" }, h("button", { type: "button", onclick: () => editRule(null, t) }, "Use template")));
	};
	return h("section", { style: "margin-top:32px" }, h("div", { class: "section-title" }, h("h2", {}, "Templates"), h("span", { class: "faint small" }, "Common scenarios. Nothing is saved until you review and create the rule.")),
		h("div", { class: "panel" }, h("ul", { class: "rules templates" }, templates.map(row))));
}
const typeDef = (t) => ruleTypes.find((x) => x.type === t);
function paramText(type, params) {
	const def = typeDef(type);
	const fmt = (v) => (Array.isArray(v) ? v.join(", ") : String(v).replaceAll("_", " ").replace(/ in days$/, " in"));
	if (!def) return Object.values(params).map(fmt).join(" ");
	return def.fields.filter((f) => params[f.name] != null).map((f) => f.kind === "number" ? (/\(GB\)/.test(f.label) ? `${params[f.name]} GB` : /^\w+s$/.test(f.label) ? `${params[f.name]} ${f.label.toLowerCase()}` : `${f.label.replace(/\s*\(.*\)/, "").toLowerCase()} ${params[f.name]}`) : fmt(params[f.name])).join(" ");
}
function humanExpr(e) {
	if (e.type) return [h("b", {}, typeDef(e.type)?.label || e.type), " ", paramText(e.type, e.params)];
	if (e.op === "not") return [h("span", { class: "op" }, "NOT"), " ", humanExpr(e.of)];
	return e.of.flatMap((c, i) => [i ? [" ", h("span", { class: "op" }, e.op.toUpperCase()), " "] : null, c.op && c.op !== "not" ? ["(", humanExpr(c), ")"] : humanExpr(c)]);
}
const isFlat = (e) => { const leaf = (n) => n.type || (n.op === "not" && n.of.type); return leaf(e) || ((e.op === "and" || e.op === "or") && e.of.every(leaf)); };

// Seerr users, loaded when the rule editor opens; empty when Seerr isn't connected (fields fall back to free text).
let requesters = [];
function paramInput(f, value) {
	// A rule saved with several names keeps the free-text box so none are lost.
	if (f.source === "requesters" && requesters.length && !(Array.isArray(value) && value.length > 1)) {
		const cur = Array.isArray(value) ? value[0] : undefined;
		// Keep a saved name Seerr no longer lists, so editing a rule never silently drops it.
		const names = cur && !requesters.some((n) => n.toLowerCase() === cur.toLowerCase()) ? [...requesters, cur] : requesters;
		return h("select", { "data-f": f.name, "data-kind": "requester" },
			f.optional ? h("option", { value: "" }, "Any requester") : null,
			names.map((n) => h("option", { value: n, selected: !!cur && n.toLowerCase() === cur.toLowerCase() }, n)));
	}
	if (f.kind === "select") return h("select", { "data-f": f.name }, f.options.map((o) => h("option", { value: o, selected: o === value }, o.replaceAll("_", " "))));
	if (f.kind === "list") return h("input", { "data-f": f.name, "data-kind": "list", placeholder: f.placeholder || "comma separated", value: Array.isArray(value) ? value.join(", ") : "" });
	if (f.kind === "number") return h("input", { "data-f": f.name, "data-kind": "number", type: "number", step: "any", inputMode: "decimal", value: value ?? "" });
	return h("input", { "data-f": f.name, value: value ?? "" });
}
function readParams(el, fields) {
	const p = {};
	for (const f of fields) {
		const i = el.querySelector(`[data-f="${f.name}"]`); if (!i || i.closest("[hidden]")) continue;
		if (i.dataset.kind === "requester") { if (i.value) p[f.name] = [i.value]; continue; }
		const v = i.value.trim();
		if (f.kind === "number") { if (v !== "") p[f.name] = Number(v); } else if (f.kind === "list") { const l = v.split(",").map((s) => s.trim()).filter(Boolean); if (l.length) p[f.name] = l; } else if (v !== "") p[f.name] = v;
	}
	return p;
}
// "Days" → "days", "Size (GB)" → "GB", "Plays" → "plays": shown inside the number box so the row reads as a sentence.
const unitOf = (label) => /\((GB|MB)\)/.exec(label)?.[1] || (/\(0.10\)/.test(label) ? "/ 10" : null) || (/^[A-Z][a-z]+s$/.test(label) ? label.toLowerCase() : null);
function condRow(list, c, onChange) {
	const row = h("div", { class: "cond" });
	const neg = h("button", { type: "button", class: "neg", "aria-pressed": String(!!c.negate), title: "Match items where this condition is NOT true", onclick: () => neg.setAttribute("aria-pressed", String(neg.getAttribute("aria-pressed") !== "true")) }, "Not");
	const sel = h("select", { "aria-label": "Condition" }, [...new Set(ruleTypes.map((t) => t.group))].map((g) => h("optgroup", { label: g }, ruleTypes.filter((t) => t.group === g).map((t) => h("option", { value: t.type, selected: t.type === c.type }, t.label)))));
	const params = h("div", { class: "params" });
	const hint = h("div", { class: "hint" });
	const paint = (type, values) => {
		const def = typeDef(type); hint.textContent = def.description;
		params.replaceChildren(...def.fields.map((f) => {
			const i = paramInput(f, values?.[f.name]);
			i.setAttribute("aria-label", f.label);
			const unit = f.kind === "number" ? unitOf(f.label) : null;
			if (f.kind !== "select" && !i.placeholder) i.placeholder = unit ? "" : f.label;
			const wrap = unit ? h("label", { class: `p unit ${f.kind}` }, i, h("span", {}, unit)) : h("div", { class: `p ${f.kind}` }, i);
			wrap.dataset.hideFor = (f.hideFor || []).join(" ");
			return wrap;
		}));
		syncFields();
	};
	// Hide fields the chosen operator doesn't use (e.g. ratings for "suitable for kids").
	const syncFields = () => {
		const op = params.querySelector('[data-f="operator"]')?.value;
		for (const w of params.children) w.hidden = !!op && w.dataset.hideFor.split(" ").includes(op);
	};
	params.addEventListener("change", (e) => e.target.matches('[data-f="operator"]') && syncFields());
	paint(c.type, c.params);
	sel.addEventListener("change", () => paint(sel.value, {}));
	row.append(neg, sel, params, iconBtn("x", "Remove condition", () => { row.remove(); onChange?.(); }, "ghost rm"), hint);
	row.read = () => ({ negate: neg.getAttribute("aria-pressed") === "true", type: sel.value, params: readParams(params, typeDef(sel.value).fields) });
	list.append(row);
	onChange?.();
}
/** A "?" button that opens a small popover (tap or click; Esc or tapping outside closes it), positioned under the button. */
function helpTip(label, ...content) {
	const tip = h("div", { class: "tip", popover: "auto", id: uid(), role: "tooltip" }, ...content);
	const btn = h("button", { type: "button", class: "icon small ghost tip-btn", "aria-label": label, title: label, "aria-describedby": tip.id }, icon("why"));
	btn.popoverTargetElement = tip;
	tip.addEventListener("toggle", (e) => {
		if (e.newState !== "open") return;
		const r = btn.getBoundingClientRect(), w = Math.min(340, innerWidth - 24);
		tip.style.width = `${w}px`;
		tip.style.left = `${Math.max(12, Math.min(r.left, innerWidth - w - 12))}px`;
		// Below the button when it fits, otherwise above it.
		const th = tip.offsetHeight, below = r.bottom + 6;
		tip.style.top = `${below + th <= innerHeight - 12 ? below : Math.max(12, r.top - 6 - th)}px`;
	});
	return [btn, tip];
}
const TITLE_EXAMPLES = [["^Star Wars", "Starts with Star Wars"], ["Harry Potter", "Contains Harry Potter anywhere"], ["^The Office$", "Exactly The Office, nothing more"], ["Lord of the Rings|Hobbit", "Either one: | means or"], ["Christmas|Holiday", "Keeps seasonal favourites"]];
/** Segmented single choice built on native radios, so keyboard and screen readers get radio semantics. */
function segmented(label, options, value) {
	const name = uid();
	const inputs = options.map(([v]) => h("input", { type: "radio", name, value: v, checked: v === value }));
	const el = h("div", { class: "seg", role: "radiogroup", "aria-label": label }, options.map(([, l], i) => h("label", {}, inputs[i], h("span", {}, l))));
	el.value = () => inputs.find((i) => i.checked)?.value;
	return el;
}
/** "expression: $(size).sizeGb: Too small…" → "Size on disk › Size (GB): Too small…" */
const friendlyIssue = (line) => line.replace(/^expression[.\w]*: /, "").replace(/^body: /, "").replace(/\$\((\w+)\)\.?(\w*)/, (_, t, f) => { const def = typeDef(t); return [def?.label || t, def?.fields.find((x) => x.name === f)?.label || f].filter(Boolean).join(" › "); });
const DEFAULT_LEAF = { type: "age", params: { operator: "older_than", days: 365 } };
async function editRule(rule, tpl) {
	try { [ruleTypes, requesters] = await Promise.all([ruleTypes.length ? ruleTypes : api("/rule-types"), api("/requesters").catch(() => [])]); } catch (e) { return fail(e); }
	const src = rule || (tpl && { name: tpl.title, mode: tpl.mode, action: tpl.action, expression: tpl.expression, serviceFilter: tpl.serviceFilter });
	const exprIn = src?.expression;
	const field = (label, input, help) => { input.id ||= uid(); return h("div", { class: "field" }, h("label", { class: "lbl", htmlFor: input.id }, label), input, help ? h("div", { class: "help" }, help) : null); };
	const fieldset = (label, control, help) => h("fieldset", { class: "field" }, h("legend", { class: "lbl" }, label), control, help || null);

	const nameErr = h("div", { class: "field-error", id: uid(), hidden: true });
	const name = h("input", { value: src?.name || "", placeholder: "e.g. Old and unwatched", autofocus: true, "aria-describedby": nameErr.id, maxLength: 100 });
	const nameField = field("Name", name); nameField.append(nameErr);
	const mode = segmented("Rule type", [["cleanup", "Cleanup"], ["retention", "Protect"]], src?.mode || "cleanup");
	const modeHelp = h("div", { class: "help" });
	const action = h("select", {}, [["delete", "Delete: remove from library and delete files"], ["delete_files", "Delete files, keep in library"], ["delete_season", "Delete season: one season's files, then unmonitor it (Sonarr)"], ["unmonitor", "Unmonitor only (frees no space)"]].map(([v, l]) => h("option", { value: v, selected: v === (src?.action || "delete") }, l)));
	const actionField = field("Action", action);
	const syncMode = () => { const protect = mode.value() === "retention"; actionField.hidden = protect; modeHelp.textContent = protect ? "Matching items are never touched by any cleanup rule." : "Matching items are flagged for the action below. The first matching cleanup rule wins."; };
	mode.addEventListener("change", syncMode); syncMode();

	// Conditions: a flat builder, or JSON for nested expressions.
	const combo = h("select", { "aria-label": "Combine conditions" }, [["and", "all"], ["or", "any"]].map(([v, l]) => h("option", { value: v }, l)));
	const comboRow = h("div", { class: "combine" }, "Match when", combo, "of these are true");
	const conds = h("div");
	const syncConds = () => { const n = conds.children.length; comboRow.hidden = n < 2; [...conds.children].forEach((r) => (r.querySelector(".rm").disabled = n === 1)); };
	const loadBuilder = (expr) => {
		combo.value = expr?.op === "or" ? "or" : "and";
		const leaves = !expr ? [DEFAULT_LEAF] : expr.type || expr.op === "not" ? [expr] : expr.of;
		conds.replaceChildren();
		for (const l of leaves) condRow(conds, l.op === "not" ? { ...l.of, negate: true } : l, syncConds);
	};
	const json = h("textarea", { rows: 14, "aria-label": "Expression JSON", value: JSON.stringify(exprIn || DEFAULT_LEAF, null, 2) });
	const jsonErr = h("div", { class: "field-error", hidden: true });
	let jsonMode = !!exprIn && !isFlat(exprIn);
	if (!jsonMode) loadBuilder(exprIn);
	const builder = h("div", {}, comboRow, conds, h("button", { type: "button", onclick: () => condRow(conds, DEFAULT_LEAF, syncConds) }, icon("plus"), "Add condition"));
	const jsonBox = h("div", {}, h("p", { class: "help", style: "margin-top:0" }, "For nested logic: {op: \"and\" | \"or\" | \"not\", of: …} groups around {type, params} conditions."), json, jsonErr);
	const builderExpr = () => {
		const items = [...conds.children].map((r) => r.read()).map((c) => { const leaf = { type: c.type, params: c.params }; return c.negate ? { op: "not", of: leaf } : leaf; });
		return items.length === 1 ? items[0] : { op: combo.value, of: items };
	};
	const buildExpr = () => (jsonMode ? JSON.parse(json.value) : builderExpr());
	const toggle = h("button", { type: "button", class: "small ghost" });
	const paintToggle = () => { builder.hidden = jsonMode; jsonBox.hidden = !jsonMode; toggle.replaceChildren(icon("code"), jsonMode ? "Use builder" : "Edit as JSON"); };
	toggle.addEventListener("click", () => {
		if (!jsonMode) { json.value = JSON.stringify(builderExpr(), null, 2); jsonErr.hidden = true; jsonMode = true; return paintToggle(); }
		// Back to the builder only when the JSON can be represented there; never drop the user's edits.
		let expr; try { expr = JSON.parse(json.value); } catch (x) { jsonErr.textContent = `Fix the JSON first: ${x.message}`; jsonErr.hidden = false; return; }
		if (!isFlat(expr)) { jsonErr.textContent = "This expression nests groups, which the builder can't show. Keep editing it as JSON."; jsonErr.hidden = false; return; }
		jsonErr.hidden = true; loadBuilder(expr); jsonMode = false; paintToggle();
	});
	paintToggle();

	const services = segmented("Services", [["all", "All"], ["radarr", "Radarr"], ["sonarr", "Sonarr"]], src?.serviceFilter?.length === 1 ? src.serviceFilter[0] : "all");
	const tags = h("input", { value: (src?.excludeTags || []).join(", "), placeholder: "e.g. keep" });
	const titleRx = h("input", { value: (src?.excludeTitles || []).join(", "), placeholder: "e.g. ^Star Wars" });
	titleRx.id = uid();
	const titlesField = h("div", { class: "field" }, h("div", { class: "lbl-row" }, h("label", { class: "lbl", htmlFor: titleRx.id }, "Never touch titles"),
		helpTip("Title pattern examples", h("div", { class: "tip-h" }, "Pattern examples"), h("dl", {}, TITLE_EXAMPLES.map(([p, d]) => [h("dt", {}, h("code", {}, p)), h("dd", {}, d)])),
			h("p", {}, "Matching ignores case and checks the title only, not the year. Separate patterns with commas, so a pattern can't contain one."))),
		titleRx, h("div", { class: "help" }, "Regular expressions, comma separated."));
	const list = (i) => { const l = i.value.split(",").map((s) => s.trim()).filter(Boolean); return l.length ? l : null; };

	const errors = h("div", { class: "notice bad form-errors", role: "alert", tabIndex: -1, hidden: true });
	const showErrors = (lines) => { errors.replaceChildren(icon("fault"), h("div", {}, h("strong", {}, "The rule wasn't saved"), h("ul", {}, lines.map((l) => h("li", {}, l))))); errors.hidden = false; errors.scrollIntoView({ block: "nearest" }); errors.focus(); };
	const snapshot = () => { let e; try { e = JSON.stringify(buildExpr()); } catch { e = json.value; } return JSON.stringify([name.value, mode.value(), action.value, e, services.value(), tags.value, titleRx.value]); };

	const save = h("button", { type: "button", class: "primary" }, rule ? "Save rule" : "Create rule");
	async function submit() {
		errors.hidden = true; nameErr.hidden = true; name.removeAttribute("aria-invalid");
		if (!name.value.trim()) { nameErr.textContent = "Give the rule a name."; nameErr.hidden = false; name.setAttribute("aria-invalid", "true"); return name.focus(); }
		let expression;
		try { expression = buildExpr(); } catch (x) { if (jsonMode) { jsonErr.textContent = `Invalid JSON: ${x.message}`; jsonErr.hidden = false; return json.focus(); } return showErrors([x.message]); }
		const svc = services.value();
		const body = { name: name.value.trim(), mode: mode.value(), action: action.value, expression, serviceFilter: svc === "all" ? null : [svc], excludeTags: list(tags), excludeTitles: list(titleRx) };
		save.disabled = true; save.classList.add("busy");
		try {
			await api(rule ? `/rules/${rule.id}` : "/rules", { method: rule ? "PUT" : "POST", body });
			lastPreview = null; closing = true; dialog.close(); toast(rule ? "Rule saved" : "Rule created");
			if (current === "rules") route(); else location.hash = "#/rules";
		} catch (x) { showErrors(x.message.split("\n").map(friendlyIssue)); }
		finally { save.disabled = false; save.classList.remove("busy"); }
	}
	save.addEventListener("click", submit);
	name.addEventListener("keydown", (e) => e.key === "Enter" && submit());

	// Closing with unsaved edits asks first, in the footer, instead of silently discarding them.
	let closing = false;
	const cancelBtn = h("button", { type: "button", onclick: () => requestClose() }, "Cancel");
	const foot = h("div", { class: "foot-row" }, cancelBtn, save);
	const confirmRow = h("div", { class: "foot-row confirm", hidden: true }, h("span", { class: "grow" }, "Discard your changes?"), h("button", { type: "button", onclick: () => { confirmRow.hidden = true; foot.hidden = false; save.focus(); } }, "Keep editing"), h("button", { type: "button", class: "danger solid", onclick: () => { closing = true; dialog.close(); } }, "Discard"));
	function requestClose() {
		if (closing || snapshot() === initial) { closing = true; return dialog.close(); }
		foot.hidden = true; confirmRow.hidden = false; confirmRow.querySelector("button").focus();
	}
	const section = (t, extra) => h("div", { class: "form-section" }, t, h("span", { class: "grow" }), extra || null);
	openDialog({ kind: "sheet", title: rule ? "Edit rule" : tpl ? `New rule: ${tpl.title}` : "New rule", lede: tpl ? `${tpl.description} Adjust the numbers to taste, then preview on the dashboard.` : "Nothing changes until a run. Preview on the dashboard before trusting a new rule.", onClose: () => requestClose(), body: [
		errors,
		section("Rule"), nameField, fieldset("Type", mode, modeHelp), actionField,
		section("Conditions", toggle), builder, jsonBox,
		section("Scope"), fieldset("Services", services, h("div", { class: "help" }, "Which library this rule looks at.")), field("Never touch tags", tags, "Sonarr/Radarr tag labels, comma separated."), titlesField,
	], foot: [foot, confirmRow] });
	const initial = snapshot();
	const ac = new AbortController();
	dialog.addEventListener("cancel", (e) => { if (!closing) { e.preventDefault(); requestClose(); } }, { signal: ac.signal });
	dialog.addEventListener("close", () => ac.abort(), { signal: ac.signal });
	name.focus();
}

// ── Approvals ──────────────────────────────────────────────────────────────
const APPROVAL_TABS = [["pending", "Pending"], ["retry_pending", "Retry pending"], ["executed", "Executed"], ["blocked", "Blocked"], ["rejected", "Rejected"], ["expired", "Expired"]];
async function renderApprovals() {
	const status = new URLSearchParams(location.hash.split("?")[1] || "").get("status") || "pending";
	const [rows, s] = await Promise.all([api(`/approvals?status=${encodeURIComponent(status)}`), api("/status")]);
	const actionable = status === "pending" || status === "retry_pending";
	const out = h("div", {}, h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Approvals"), h("p", { class: "lede" }, "Nothing is removed until you approve it, and each item is re-checked against live data right before removal."))));
	out.append(h("nav", { class: "tabs", "aria-label": "Approval status" }, APPROVAL_TABS.map(([k, l]) => h("a", { href: `#/approvals?status=${k}`, class: k === status ? "active" : "", "aria-current": k === status ? "page" : null }, l, s.approvals[k] ? h("span", { class: k === "pending" || k === "retry_pending" ? "count" : "faint" }, s.approvals[k]) : null))));
	if (!rows.length) {
		const label = APPROVAL_TABS.find(([k]) => k === status)?.[1].toLowerCase() || status;
		const msg = status === "pending" ? (s.config.dryRun ? ["Nothing waiting", "Dry run is on, so runs don't queue anything. Turn it off in Settings once the preview looks right."] : ["Nothing waiting", "New matches land here after the next run."]) : [`No ${label} approvals`, null];
		return out.appendChild(h("div", { class: "panel" }, empty(...msg))), out;
	}
	const picked = new Set(), lis = [];
	const bar = h("div", { class: "bulkbar", hidden: true, role: "region", "aria-label": "Selection" });
	const act = (action, ids) => async (e) => {
		const btn = e.currentTarget, chosenIds = ids || [...picked];
		const chosen = rows.filter((a) => chosenIds.includes(a.id));
		if (action === "approve" && !(await ask({ title: chosen.length === 1 ? `Remove “${nameOf(chosen[0])}” now?` : `Remove ${chosen.length} items now?`, text: `${bytes(sum(chosen))} will be reclaimed. Each item is re-checked against live data first and blocked if anything changed.`, action: chosen.length === 1 ? "Approve and remove" : `Approve ${chosen.length}`, danger: true }))) return;
		await guard(btn, async () => {
			const r = await api("/approvals/bulk", { method: "POST", body: { ids: chosenIds, action } });
			const bad = r.results.filter((x) => !x.ok);
			toast(bad.length ? `${bad.length} failed: ${bad[0].error}` : `${action === "approve" ? "Approved" : "Rejected"} ${plural(chosenIds.length, "item")}`, bad.length > 0);
			lis.filter(({ a }) => chosenIds.includes(a.id)).forEach(({ li }) => li.classList.add("leaving"));
			lastPreview = null; setTimeout(route, 200);
		});
	};
	const all = actionable ? h("input", { type: "checkbox", "aria-label": "Select all", onchange: (e) => { for (const { a, box } of lis) { box.checked = e.target.checked; e.target.checked ? picked.add(a.id) : picked.delete(a.id); } paintBar(); } }) : null;
	function paintBar() {
		lis.forEach(({ li, a }) => li.classList.toggle("sel", picked.has(a.id)));
		if (all) { all.checked = picked.size === rows.length; all.indeterminate = picked.size > 0 && picked.size < rows.length; }
		bar.hidden = !picked.size;
		bar.replaceChildren(h("span", { class: "sum" }, `${picked.size} selected · ${bytes(sum(rows.filter((a) => picked.has(a.id))))}`), h("button", { type: "button", onclick: act("reject") }, icon("x"), "Reject"), h("button", { type: "button", class: "go", onclick: act("approve") }, icon("check"), "Approve"));
	}
	const list = h("ul", { class: "approvals" }, h("li", { class: "head" }, h("span", {}, all ? h("label", { class: "hit" }, all) : null), h("span", { class: "t" }, "Title"), h("span", { class: "why" }, "Rule and reason"), h("span", { class: "sz" }, "Size"), h("span", { class: "st" }, "Status"), h("span", { class: "a" })));
	for (const a of rows) {
		const box = actionable ? h("input", { type: "checkbox", "aria-label": `Select ${nameOf(a)}`, onchange: (e) => { e.target.checked ? picked.add(a.id) : picked.delete(a.id); paintBar(); } }) : null;
		const x = h("div", { class: "x", hidden: true });
		const meta = a.lastError || (actionable ? `Expires ${ago(a.expiresAt)}` : a.executedAt || a.reviewedAt ? ago(a.executedAt || a.reviewedAt) : null);
		const li = h("li", {},
			h("span", {}, box ? h("label", { class: "hit" }, box) : null),
			h("div", { class: "t" }, nameOf(a), a.year ? ` (${a.year})` : "", h("small", {}, vol(a), " · ", kindLabel(a.itemType), " · ", actionTag(a.action), h("span", { class: "sz-inline" }, ` · ${bytes(a.sizeOnDisk)}`)), h("small", { class: "why-inline" }, `${a.ruleName}: ${a.reason}`)),
			h("div", { class: "why" }, h("b", {}, a.ruleName), h("small", {}, a.reason)),
			h("div", { class: "sz" }, bytes(a.sizeOnDisk)),
			h("div", { class: "st" }, state(a.status), meta ? h("div", { class: "help", style: "margin-top:4px" }, meta) : null),
			h("div", { class: "a" }, whyButton(a, x, x, "icon ghost", true), actionable ? [iconBtn("x", `Reject ${nameOf(a)}`, act("reject", [a.id])), iconBtn("check", `Approve ${nameOf(a)}`, act("approve", [a.id]), "danger")] : null));
		li.append(x);
		lis.push({ li, a, box });
		list.append(li);
	}
	out.append(h("div", { class: "panel" }, list), bar);
	return out;
}

// ── History ────────────────────────────────────────────────────────────────
async function renderHistory() {
	const [runs, audit] = await Promise.all([api("/logs?limit=30"), api("/audit?limit=100")]);
	const out = h("div", {}, h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "History"), h("p", { class: "lede" }, "Every run, and an append-only record of every selection, approval, block and removal."))));
	const details = (r) => (e) => guard(e.currentTarget, async () => {
		const full = await api(`/logs/${r.id}`);
		openDialog({ kind: "wide", title: `Run ${when(full.startedAt)}`, lede: `${full.isDryRun ? "Dry run" : "Live"} · ${full.trigger} · ${full.itemsFlagged} flagged · ${full.itemsRemoved} removed`, body: [
			full.warnings.length || full.error ? h("div", { class: "notices" }, full.warnings.map((w) => notice(w)), full.error ? badNotice(full.error) : null) : null, detailTable(full.details, false)], foot: [closeBtn()] });
	});
	const auditState = (o) => ({ success: "success", blocked: "blocked", failed: "failed" }[o] || "loaded");
	out.append(h("section", {}, h("div", { class: "section-title" }, h("h2", {}, "Runs")), runs.length ? h("div", { class: "panel table-wrap" }, h("table", {},
		h("thead", {}, h("tr", {}, h("th", {}, "Started"), h("th", {}, "Trigger"), h("th", {}, "Mode"), h("th", {}, "Status"), h("th", { class: "num" }, "Flagged"), h("th", { class: "num" }, "Removed"), h("th", { class: "num" }, "Reclaimed"), h("th", {}))),
		h("tbody", {}, runs.map((r) => h("tr", {}, h("td", {}, timeEl(r.startedAt)), h("td", {}, r.trigger), h("td", {}, h("span", { class: "tag" }, r.isDryRun ? "Dry run" : "Live")), h("td", {}, state(r.status)), h("td", { class: "num mono" }, r.itemsFlagged), h("td", { class: "num mono" }, r.itemsRemoved), h("td", { class: "num mono" }, bytes(r.bytesReclaimed)),
			h("td", { class: "num" }, h("button", { type: "button", class: "small", onclick: details(r) }, "Details"))))))) : h("div", { class: "panel" }, empty("No runs yet", "Run cleanup from the dashboard, or turn on the schedule in Settings."))));
	out.append(h("section", {}, h("div", { class: "section-title" }, h("h2", {}, "Audit trail")), audit.length ? h("div", { class: "panel table-wrap" }, h("table", {},
		h("thead", {}, h("tr", {}, h("th", {}, "When"), h("th", {}, "Event"), h("th", {}, "Item"), h("th", {}, "Actor"), h("th", {}, "Detail"))),
		h("tbody", {}, audit.map((e) => h("tr", {}, h("td", { class: "small" }, timeEl(e.created_at)), h("td", {}, state(auditState(e.outcome), e.event_type.replaceAll("_", " "))), h("td", {}, e.title, h("div", { class: "sub" }, `${e.rule_name || "—"} · ${e.action}`)), h("td", { class: "small" }, `${e.actor} (${e.trigger})`), h("td", { class: "small" }, e.reason)))))) : h("div", { class: "panel" }, empty("No activity yet", "Selections, approvals and removals are recorded here."))));
	return out;
}

// ── Instances ──────────────────────────────────────────────────────────────
const SERVICES = { sonarr: "Sonarr", radarr: "Radarr", plex: "Plex", seerr: "Seerr" };
async function renderInstances() {
	const all = await api("/instances");
	const out = h("div", {}, h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Instances"), h("p", { class: "lede" }, "Sonarr and Radarr hold your library. Plex supplies watch history and Seerr supplies requests; both are optional.")), h("button", { type: "button", class: "primary", onclick: () => editInstance() }, icon("plus"), "Add instance")));
	const test = (i, led, res) => (e) => guard(e.currentTarget, async () => { const r = await api(`/instances/${i.id}/test`, { method: "POST" }); led.className = `led ${r.ok ? "on" : "bad"}`; res.replaceChildren(r.ok ? state("success", "Connected") : state("fault", r.error)); });
	const remove = async (i) => { if (!(await ask({ title: `Remove ${i.name}?`, text: "Cleanarr stops reading from it. Nothing in the service itself changes.", action: "Remove instance", danger: true }))) return; try { await api(`/instances/${i.id}`, { method: "DELETE" }); lastPreview = null; route(); } catch (e) { fail(e); } };
	const row = (i) => {
		const led = h("span", { class: "led", title: "Not tested yet" }), res = h("div", { class: "res", "aria-live": "polite" });
		return h("li", {}, h("span", { class: "svc" }, SERVICES[i.type] || i.type),
			h("div", {}, h("div", { class: "nm" }, led, i.name, i.enabled ? null : h("span", { class: "tag" }, "Disabled")), h("div", { class: "url" }, i.url), res),
			h("div", { class: "acts" }, h("button", { type: "button", class: "small", onclick: test(i, led, res) }, icon("plug"), "Test"), h("button", { type: "button", class: "small", onclick: () => editInstance(i) }, icon("edit"), "Edit"), iconBtn("trash", `Remove ${i.name}`, () => remove(i), "small ghost danger")));
	};
	const libs = all.filter((i) => i.type === "sonarr" || i.type === "radarr"), evidence = all.filter((i) => i.type === "plex" || i.type === "seerr");
	const add = (t, primary) => h("button", { type: "button", class: primary ? "primary" : "", onclick: () => editInstance(null, t) }, icon("plus"), `Add ${SERVICES[t]}`);
	// Services this section can still take; keeps "Add Plex" reachable once Seerr exists (and vice versa).
	const more = (have, types) => { const missing = types.filter((t) => !have.some((i) => i.type === t)); return missing.length ? h("div", { class: "row", style: "padding:12px 16px;border-top:1px solid var(--line)" }, missing.map((t) => add(t))) : null; };
	out.append(h("section", {}, h("div", { class: "section-title" }, h("h2", {}, "Library")), h("div", { class: "panel" }, libs.length ? [h("ul", { class: "instances" }, libs.map(row)), more(libs, ["radarr", "sonarr"])] : empty("No library connected", "Add Sonarr or Radarr so Cleanarr can read what's on disk.", add("radarr", true), add("sonarr", true)))));
	out.append(h("section", {}, h("div", { class: "section-title" }, h("h2", {}, "Evidence")), h("div", { class: "panel" }, evidence.length ? [h("ul", { class: "instances" }, evidence.map(row)), more(evidence, ["plex", "seerr"])] : empty("Optional", "Add Plex for watch-history rules and Seerr for request rules.", add("plex"), add("seerr")))));
	return out;
}
function editInstance(inst, preset) {
	const name = h("input", { id: uid(), value: inst?.name || "" });
	const type = h("select", { id: uid(), disabled: !!inst }, Object.entries(SERVICES).map(([t, l]) => h("option", { value: t, selected: t === (inst?.type || preset) }, l)));
	const url = h("input", { id: uid(), value: inst?.url || "", placeholder: "http://host:port", inputMode: "url", autocomplete: "off" });
	const key = h("input", { id: uid(), type: "password", placeholder: inst ? "Leave blank to keep the current key" : "API key", autocomplete: "off" });
	const keyLabel = h("label", { class: "lbl", htmlFor: key.id }, "API key");
	const hint = h("div", { class: "help" });
	const res = h("div", { "aria-live": "polite", style: "min-height:20px" });
	const paintType = () => {
		keyLabel.textContent = type.value === "plex" ? "X-Plex-Token" : "API key";
		hint.textContent = { plex: "Use the server owner's token so history for every user is visible. Plex listens on port 32400 by default.", seerr: "Overseerr, Jellyseerr or Seerr API key (Settings → General).", sonarr: "Sonarr → Settings → General → API Key.", radarr: "Radarr → Settings → General → API Key." }[type.value];
		if (!inst && (!name.value || Object.values(SERVICES).includes(name.value))) name.value = SERVICES[type.value];
	};
	type.addEventListener("change", paintType); paintType();
	const enabled = h("input", { type: "checkbox", checked: inst ? inst.enabled : true });
	const test = h("button", { type: "button", onclick: (e) => guard(e.currentTarget, async () => {
		if (!key.value && !inst) throw new Error("Enter an API key first");
		const r = key.value ? await api("/instances/test", { method: "POST", body: { type: type.value, url: url.value, apiKey: key.value } }) : await api(`/instances/${inst.id}/test`, { method: "POST" });
		res.replaceChildren(r.ok ? state("success", "Connected") : state("fault", r.error));
	}) }, icon("plug"), "Test connection");
	const save = h("button", { type: "button", class: "primary", onclick: (e) => guard(e.currentTarget, async () => {
		const body = { name: name.value, url: url.value, enabled: enabled.checked, ...(key.value ? { apiKey: key.value } : {}) };
		await api(inst ? `/instances/${inst.id}` : "/instances", { method: inst ? "PUT" : "POST", body: inst ? body : { ...body, type: type.value } });
		lastPreview = null; dialog.close(); toast(inst ? "Instance saved" : "Instance added"); if (current === "instances") route(); else location.hash = "#/instances";
	}) }, inst ? "Save" : "Add instance");
	const f = (label, input) => h("div", { class: "field" }, h("label", { class: "lbl", htmlFor: input.id }, label), input);
	openDialog({ title: inst ? `Edit ${inst.name}` : "Add instance", body: [
		h("div", { class: "cols" }, f("Service", type), f("Name", name)), f("URL", url), h("div", { class: "field" }, keyLabel, key, hint),
		h("label", { class: "switch" }, enabled, h("div", {}, h("div", { class: "t" }, "Enabled"), h("div", { class: "d" }, "Disabled instances are skipped on every run."))), res,
	], foot: [closeBtn("Cancel"), test, save] });
}

// ── Settings ───────────────────────────────────────────────────────────────
async function renderSettings() {
	const c = await api("/config");
	const num = (v, min = 1) => h("input", { id: uid(), type: "number", min, inputMode: "numeric", value: v ?? "" });
	const interval = num(c.intervalHours), max = num(c.maxRemovalsPerRun), expiry = num(c.approvalExpiryDays);
	const rej = h("select", { id: uid() }, [["0", "Off: rejected items can be proposed again next run"], ["30", "30 days"], ["90", "90 days"], ["365", "1 year"], ["forever", "Forever"]].map(([v, l]) => h("option", { value: v, selected: v === (c.rejectionMemoryDays === null ? "forever" : String(c.rejectionMemoryDays)) }, l)));
	const sw = (checked, label, help) => { const i = h("input", { type: "checkbox", checked }); return [i, h("label", { class: "switch" }, i, h("div", {}, h("div", { class: "t" }, label), h("div", { class: "d" }, help)))]; };
	const [dry, dryF] = sw(c.dryRun, "Dry run", "Report what would be removed without changing anything or queueing approvals. Keep this on until the preview looks right.");
	const [appr, apprF] = sw(c.requireApproval, "Require approval", "Matches wait in the mailslot for your decision instead of being removed automatically.");
	const [on, onF] = sw(c.enabled, "Run on a schedule", "Run cleanup automatically at the interval below.");
	const f = (label, input, help) => h("div", { class: "field" }, h("label", { class: "lbl", htmlFor: input.id }, label), input, help ? h("div", { class: "help" }, help) : null);
	const save = h("button", { type: "button", class: "primary", onclick: (e) => guard(e.currentTarget, async () => {
		const goingLive = !dry.checked && c.dryRun, droppingApproval = !appr.checked && c.requireApproval && !dry.checked;
		if (goingLive && !(await ask({ title: "Turn off dry run?", text: appr.checked ? "Runs will queue real removals for your approval." : "Approval is off too: runs will remove matching items immediately.", action: "Turn off dry run", danger: !appr.checked }))) return;
		if (droppingApproval && !goingLive && !(await ask({ title: "Remove without approval?", text: "Matching items will be removed on every run without waiting for you.", action: "Turn off approval", danger: true }))) return;
		Object.assign(c, await api("/config", { method: "PUT", body: { dryRun: dry.checked, requireApproval: appr.checked, enabled: on.checked, intervalHours: Number(interval.value), maxRemovalsPerRun: Number(max.value), approvalExpiryDays: Number(expiry.value), rejectionMemoryDays: rej.value === "forever" ? null : Number(rej.value) } }));
		lastPreview = null; toast("Settings saved"); refreshMode();
	}) }, "Save settings");
	const panel = (title, ...kids) => h("section", {}, h("div", { class: "panel" }, h("div", { class: "panel-head" }, h("h2", {}, title)), h("div", { class: "panel-body" }, ...kids)));
	return h("div", { style: "max-width:760px" }, h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Settings"), h("p", { class: "lede" }, "How cautious Cleanarr is, and when it runs."))),
		panel("Safety", dryF, apprF),
		panel("Schedule", onF, h("div", { style: "margin-top:12px" }, f("Run every (hours)", interval))),
		panel("Limits", h("div", { class: "cols" }, f("Max removals per run", max, "Caps both removals and new approvals."), f("Approvals expire after (days)", expiry)), f("Rejection memory", rej, "How long a rejected item stays out of the mailslot.")),
		h("div", { class: "row end", style: "margin-top:20px" }, save));
}

route();
