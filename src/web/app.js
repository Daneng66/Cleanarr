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
	for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
	return el;
}

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
function askKey() {
	return new Promise((resolve) => {
		const input = h("input", { type: "password", placeholder: "API key", autofocus: true });
		dialog.replaceChildren(h("h1", {}, "Sign in"), h("p", { class: "sub" }, "This Cleanarr instance requires its API key (CLEANARR_API_KEY)."), h("div", { class: "field" }, input),
			h("div", { class: "row end" }, h("button", { class: "primary", onclick: () => { keyStore.set(input.value); dialog.close(); resolve(); } }, "Continue")));
		input.addEventListener("keydown", (e) => e.key === "Enter" && (keyStore.set(input.value), dialog.close(), resolve()));
		if (!dialog.open) dialog.showModal();
	});
}
let toastTimer;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 3500); }
const fail = (e) => toast(e.message.split("\n")[0]);
async function guard(btn, fn) { btn.disabled = true; try { await fn(); } catch (e) { fail(e); } finally { btn.disabled = false; } }

// ── Format ─────────────────────────────────────────────────────────────────
const bytes = (n) => { if (!n) return "0 B"; const u = ["B", "KB", "MB", "GB", "TB"]; const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), 4); return `${(n / 1024 ** i).toFixed(i > 1 ? 1 : 0)} ${u[i]}`; };
const when = (s) => (s ? new Date(s).toLocaleString() : "—");
const pill = (text, cls = "") => h("span", { class: `pill ${cls}` }, text);
const statusPill = (s) => pill(s.replace("_", " "), { executed: "ok", completed: "ok", pending: "warn", pending_approval: "warn", partial: "warn", retry_pending: "warn", blocked: "bad", failed: "bad", error: "bad", removed: "ok" }[s] || "");

// ── Router ─────────────────────────────────────────────────────────────────
const routes = { dashboard: renderDashboard, rules: renderRules, approvals: renderApprovals, history: renderHistory, instances: renderInstances, settings: renderSettings };
const titles = { dashboard: "Dashboard", rules: "Rules", approvals: "Approvals", history: "History", instances: "Instances", settings: "Settings" };
async function route() {
	const name = location.hash.slice(2).split("/")[0] || "dashboard";
	const fn = routes[name] || renderDashboard;
	$("#nav").replaceChildren(...Object.entries(titles).map(([k, v]) => h("a", { href: `#/${k}`, class: k === name ? "active" : "" }, v)));
	view.replaceChildren(h("p", { class: "muted" }, "Loading…"));
	try { view.replaceChildren(await fn()); } catch (e) { view.replaceChildren(h("div", { class: "card" }, "Could not load: " + e.message)); }
	refreshMode();
}
async function refreshMode() { try { const s = await api("/status"); const m = $("#mode"); m.textContent = s.config.dryRun ? "Dry run" : s.config.requireApproval ? "Live · approval" : "Live · automatic"; m.className = "pill " + (s.config.dryRun ? "warn" : "ok"); } catch {} }
window.addEventListener("hashchange", route);

// ── Dashboard ──────────────────────────────────────────────────────────────
async function renderDashboard() {
	const [s, instances] = await Promise.all([api("/status"), api("/instances")]);
	const out = h("div");
	const results = h("div");
	const stat = (n, l) => h("div", { class: "card stat" }, h("div", { class: "n" }, n), h("div", { class: "l" }, l));
	const arrCount = instances.filter((i) => i.type !== "tautulli").length;
	out.append(h("h1", {}, "Dashboard"), h("p", { class: "sub" }, "Rule-based cleanup for Sonarr and Radarr."));
	if (!arrCount) out.append(h("div", { class: "warnbox" }, "Add a Sonarr or Radarr instance to get started. ", h("a", { href: "#/instances" }, "Go to Instances")));
	if (s.config.dryRun) out.append(h("div", { class: "warnbox" }, "Dry-run mode is on: runs only report what they would do. Turn it off in Settings when you're happy with the preview."));
	out.append(h("div", { class: "grid" },
		stat(String(s.approvals.pending || 0), "Awaiting approval"),
		stat(String(s.totals.removed), "Items removed (all time)"),
		stat(bytes(s.totals.bytes), "Space reclaimed (all time)"),
		stat(s.config.enabled ? when(s.config.nextRunAt) : "Off", "Next scheduled run")));
	const previewBtn = h("button", { class: "primary", onclick: (e) => guard(e.target, async () => { const p = await api("/preview", { method: "POST" }); results.replaceChildren(previewCard(p)); }) }, "Preview now");
	const runBtn = h("button", { onclick: (e) => guard(e.target, async () => {
		const msg = s.config.dryRun ? "Run a dry run now?" : s.config.requireApproval ? "Run now? Matches will be queued for your approval." : "Run now? Matching items will be removed immediately.";
		if (!confirm(msg)) return;
		const r = await api("/run", { method: "POST", body: {} });
		toast(`Run ${r.status}: ${r.itemsFlagged} flagged, ${r.itemsRemoved} removed`);
		results.replaceChildren(runCard(r));
	}) }, "Run now");
	out.append(h("div", { class: "row" }, previewBtn, runBtn, h("span", { class: "muted small" }, "Preview never changes anything.")), results);
	if (s.lastRun) out.append(h("h2", {}, "Last run"), h("div", { class: "card" }, h("div", { class: "row" }, statusPill(s.lastRun.status), pill(s.lastRun.isDryRun ? "dry run" : "live"), h("span", { class: "muted" }, when(s.lastRun.startedAt)), h("span", { class: "spacer" }), h("a", { href: "#/history" }, "All runs")),
		h("p", {}, `${s.lastRun.itemsEvaluated} evaluated · ${s.lastRun.itemsFlagged} flagged · ${s.lastRun.itemsRemoved} removed · ${s.lastRun.itemsSkipped} skipped`), ...s.lastRun.warnings.map((w) => h("div", { class: "warnbox" }, w))));
	return out;
}
function previewCard(p) {
	return h("div", { class: "card", style: "margin-top:16px" }, h("h1", {}, `Preview: ${p.candidates.length} item(s), ${bytes(p.totalBytes)}`), h("p", { class: "sub" }, `${p.evaluated} items evaluated`),
		...p.warnings.map((w) => h("div", { class: "warnbox" }, w)), detailTable(p.candidates, true), p.skipped.length ? h("details", {}, h("summary", { class: "muted" }, `${p.skipped.length} skipped`), detailTable(p.skipped, true)) : null);
}
function runCard(r) {
	return h("div", { class: "card", style: "margin-top:16px" }, h("div", { class: "row" }, statusPill(r.status), pill(r.isDryRun ? "dry run" : "live")), ...r.warnings.map((w) => h("div", { class: "warnbox" }, w)), r.error ? h("div", { class: "warnbox" }, r.error) : null, detailTable(r.details || [], true));
}
function detailTable(rows, withWhy) {
	if (!rows.length) return h("div", { class: "empty" }, "Nothing to show.");
	return h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Title"), h("th", {}, "Rule"), h("th", {}, "Reason"), h("th", { class: "num" }, "Size"), h("th", {}, "Result"), withWhy ? h("th") : null)),
		h("tbody", {}, rows.map((d) => h("tr", {}, h("td", {}, d.title, h("div", { class: "muted small" }, d.itemType)), h("td", {}, d.ruleName, h("div", { class: "muted small" }, d.action)), h("td", { class: "small" }, d.reason), h("td", { class: "num" }, bytes(d.sizeOnDisk)),
			h("td", {}, statusPill(d.outcome), d.message ? h("div", { class: "muted small" }, d.message) : null), withWhy ? h("td", {}, h("button", { class: "small", onclick: () => showExplain(d) }, "Why?")) : null)))));
}
async function showExplain(d) {
	try {
		const e = await api("/explain", { method: "POST", body: { instanceId: d.instanceId, arrItemId: d.arrItemId } });
		const tree = (n) => h("li", {}, h("span", { class: `state-${n.state}` }, `${n.state === "true" ? "✓" : n.state === "false" ? "✗" : "?"} `), n.type ? n.reason : n.op.toUpperCase(), n.children ? h("ul", { class: "tree" }, n.children.map(tree)) : null);
		dialog.replaceChildren(h("h1", {}, e.item.title), h("p", { class: "sub" }, `${e.item.kind} · ${bytes(e.item.sizeOnDisk)} · ${e.item.monitored ? "monitored" : "unmonitored"} · ${e.item.path || ""}`), ...e.warnings.map((w) => h("div", { class: "warnbox" }, w)),
			...e.rules.map((r) => h("div", { class: "card" }, h("div", { class: "row" }, h("strong", {}, r.name), pill(r.mode), r.inScope ? statusPill(r.state === "true" ? "matches" : r.state === "false" ? "no match" : "unknown") : pill("out of scope"), r.excludedBy ? h("span", { class: "muted small" }, r.excludedBy) : null), r.tree ? h("ul", { class: "tree" }, tree(r.tree)) : null)),
			h("div", { class: "row end" }, h("button", { onclick: () => dialog.close() }, "Close")));
		dialog.showModal();
	} catch (err) { fail(err); }
}

// ── Rules ──────────────────────────────────────────────────────────────────
let ruleTypes = [];
async function renderRules() {
	const [rules, types] = await Promise.all([api("/rules"), api("/rule-types")]);
	ruleTypes = types;
	const out = h("div", {}, h("div", { class: "row" }, h("div", {}, h("h1", {}, "Rules"), h("p", { class: "sub" }, "Evaluated in order. The first matching cleanup rule wins; retention rules always protect.")), h("span", { class: "spacer" }), h("button", { class: "primary", onclick: () => editRule() }, "New rule")));
	if (!rules.length) return out.appendChild(h("div", { class: "card empty" }, "No rules yet. Create one to see what Cleanarr would remove.")), out;
	const move = async (i, d) => { const ids = rules.map((r) => r.id); [ids[i], ids[i + d]] = [ids[i + d], ids[i]]; try { await api("/rules/reorder", { method: "PUT", body: { ids } }); route(); } catch (e) { fail(e); } };
	const toggle = async (r, e) => { try { await api(`/rules/${r.id}`, { method: "PUT", body: { enabled: e.target.checked } }); } catch (x) { e.target.checked = !e.target.checked; fail(x); } };
	const remove = async (r) => { if (!confirm(`Delete rule "${r.name}"?`)) return; try { await api(`/rules/${r.id}`, { method: "DELETE" }); route(); } catch (e) { fail(e); } };
	const row = (r, i) => h("tr", {},
		h("td", {}, h("input", { type: "checkbox", checked: r.enabled, onchange: (e) => toggle(r, e) })),
		h("td", {}, h("strong", {}, r.name)),
		h("td", {}, r.mode === "retention" ? pill("protect", "ok") : pill(r.action)),
		h("td", { class: "small" }, describeExpr(r.expression)),
		h("td", { class: "num" },
			h("button", { class: "small", disabled: i === 0, onclick: () => move(i, -1), title: "Move up" }, "↑"), " ",
			h("button", { class: "small", disabled: i === rules.length - 1, onclick: () => move(i, 1), title: "Move down" }, "↓"), " ",
			h("button", { class: "small", onclick: () => editRule(r) }, "Edit"), " ",
			h("button", { class: "small danger", onclick: () => remove(r) }, "Delete")));
	const head = h("thead", {}, h("tr", {}, h("th", {}, "On"), h("th", {}, "Name"), h("th", {}, "Type"), h("th", {}, "Condition"), h("th")));
	out.append(h("div", { class: "card table-wrap" }, h("table", {}, head, h("tbody", {}, rules.map(row)))));
	return out;
}
const typeLabel = (t) => ruleTypes.find((x) => x.type === t)?.label || t;
function describeExpr(e) {
	if (e.type) return `${typeLabel(e.type)} ${Object.entries(e.params).map(([k, v]) => `${k}=${Array.isArray(v) ? v.join("/") : v}`).join(", ")}`;
	if (e.op === "not") return `NOT (${describeExpr(e.of)})`;
	return e.of.map((c) => (c.op && c.op !== "not" ? `(${describeExpr(c)})` : describeExpr(c))).join(e.op === "and" ? " AND " : " OR ");
}
const isFlat = (e) => { const leaf = (n) => n.type || (n.op === "not" && n.of.type); return leaf(e) || ((e.op === "and" || e.op === "or") && e.of.every(leaf)); };

function paramInput(f, value) {
	if (f.kind === "select") return h("select", { "data-f": f.name }, f.options.map((o) => h("option", { value: o, selected: o === value }, o.replaceAll("_", " "))));
	if (f.kind === "list") return h("input", { "data-f": f.name, "data-kind": "list", placeholder: f.placeholder || "comma separated", value: Array.isArray(value) ? value.join(", ") : "" });
	if (f.kind === "number") return h("input", { "data-f": f.name, "data-kind": "number", type: "number", step: "any", value: value ?? "" });
	return h("input", { "data-f": f.name, value: value ?? "" });
}
function readParams(el, fields) {
	const p = {};
	for (const f of fields) {
		const i = el.querySelector(`[data-f="${f.name}"]`); if (!i) continue;
		const v = i.value.trim();
		if (f.kind === "number") { if (v !== "") p[f.name] = Number(v); } else if (f.kind === "list") { const l = v.split(",").map((s) => s.trim()).filter(Boolean); if (l.length) p[f.name] = l; } else if (v !== "") p[f.name] = v;
	}
	return p;
}
function condRow(list, c) {
	const row = h("div", { class: "cond" });
	const neg = h("input", { type: "checkbox", checked: c.negate, title: "Negate this condition" });
	const sel = h("select", {}, [...new Set(ruleTypes.map((t) => t.group))].map((g) => h("optgroup", { label: g }, ruleTypes.filter((t) => t.group === g).map((t) => h("option", { value: t.type, selected: t.type === c.type }, t.label)))));
	const params = h("div", { class: "params" });
	const hint = h("div", { class: "muted small" });
	const paint = (type, values) => { const def = ruleTypes.find((t) => t.type === type); hint.textContent = def.description; params.replaceChildren(...def.fields.map((f) => h("div", {}, h("label", {}, f.label), paramInput(f, values?.[f.name])))); };
	paint(c.type, c.params);
	sel.addEventListener("change", () => paint(sel.value, {}));
	row.append(h("label", { class: "check" }, neg, "NOT"), sel, h("div", {}, params, hint), h("button", { class: "small danger", type: "button", onclick: () => { row.remove(); } }, "✕"));
	row.read = () => ({ negate: neg.checked, type: sel.value, params: readParams(params, ruleTypes.find((t) => t.type === sel.value).fields) });
	list.append(row);
}
function editRule(rule) {
	const exprIn = rule?.expression;
	const flat = !exprIn || isFlat(exprIn);
	const op = exprIn?.op === "or" ? "or" : "and";
	const leaves = !exprIn ? [{ type: "age", params: { operator: "older_than", days: 365 } }] : exprIn.type || exprIn.op === "not" ? [exprIn] : exprIn.of || [];
	const name = h("input", { value: rule?.name || "" });
	const mode = h("select", {}, [["cleanup", "Cleanup: flag matching items"], ["retention", "Retention: protect matching items"]].map(([v, l]) => h("option", { value: v, selected: v === (rule?.mode || "cleanup") }, l)));
	const action = h("select", {}, [["delete", "Delete (remove from library and delete files)"], ["unmonitor", "Unmonitor only"], ["delete_files", "Delete files, keep in library"]].map(([v, l]) => h("option", { value: v, selected: v === (rule?.action || "delete") }, l)));
	const combo = h("select", {}, [["and", "ALL conditions match"], ["or", "ANY condition matches"]].map(([v, l]) => h("option", { value: v, selected: v === op }, l)));
	const conds = h("div");
	for (const l of leaves) condRow(conds, l.op === "not" ? { ...l.of, negate: true } : l);
	const json = h("textarea", { rows: 10, value: JSON.stringify(exprIn || { type: "age", params: { operator: "older_than", days: 365 } }, null, 2) });
	let jsonMode = !flat;
	const builder = h("div", {}, h("div", { class: "row" }, combo), conds, h("div", { style: "margin-top:8px" }, h("button", { type: "button", onclick: () => condRow(conds, { type: "age", params: { operator: "older_than", days: 365 } }) }, "+ Add condition")));
	const jsonBox = h("div", {}, h("p", { class: "muted small" }, "Advanced: nested {op: \"and\"|\"or\"|\"not\", of: …} and {type, params} nodes."), json);
	builder.hidden = jsonMode; jsonBox.hidden = !jsonMode;
	const toggle = h("button", { type: "button", class: "small", onclick: () => { if (!jsonMode) json.value = JSON.stringify(buildExpr(), null, 2); jsonMode = !jsonMode; builder.hidden = jsonMode; jsonBox.hidden = !jsonMode; toggle.textContent = jsonMode ? "Use builder" : "Edit as JSON"; } }, jsonMode ? "Use builder" : "Edit as JSON");
	const buildExpr = () => {
		if (jsonMode) return JSON.parse(json.value);
		const items = [...conds.children].map((r) => r.read()).map((c) => { const leaf = { type: c.type, params: c.params }; return c.negate ? { op: "not", of: leaf } : leaf; });
		return items.length === 1 ? items[0] : { op: combo.value, of: items };
	};
	const svc = h("input", { value: (rule?.serviceFilter || []).join(", "), placeholder: "sonarr, radarr (blank = all)" });
	const tags = h("input", { value: (rule?.excludeTags || []).join(", "), placeholder: "tag labels to never touch" });
	const titles = h("input", { value: (rule?.excludeTitles || []).join(", "), placeholder: "regex patterns, e.g. ^Star Wars" });
	const list = (i) => { const l = i.value.split(",").map((s) => s.trim()).filter(Boolean); return l.length ? l : null; };
	const save = h("button", { class: "primary", onclick: (e) => guard(e.target, async () => {
		let expression; try { expression = buildExpr(); } catch (x) { throw new Error("Invalid JSON: " + x.message); }
		const body = { name: name.value.trim(), mode: mode.value, action: action.value, expression, serviceFilter: list(svc), excludeTags: list(tags), excludeTitles: list(titles) };
		await api(rule ? `/rules/${rule.id}` : "/rules", { method: rule ? "PUT" : "POST", body });
		dialog.close(); route();
	}) }, "Save");
	dialog.replaceChildren(h("h1", {}, rule ? "Edit rule" : "New rule"),
		h("div", { class: "field" }, h("label", {}, "Name"), name), h("div", { class: "row" }, h("div", { class: "field", style: "flex:1" }, h("label", {}, "Type"), mode), h("div", { class: "field", style: "flex:1" }, h("label", {}, "Action"), action)),
		h("div", { class: "row" }, h("strong", {}, "Conditions"), h("span", { class: "spacer" }), toggle), builder, jsonBox,
		h("h2", {}, "Scope"), h("div", { class: "field" }, h("label", {}, "Services"), svc), h("div", { class: "field" }, h("label", {}, "Exclude tags"), tags), h("div", { class: "field" }, h("label", {}, "Exclude titles (regex)"), titles),
		h("div", { class: "row end" }, h("button", { onclick: () => dialog.close() }, "Cancel"), save));
	dialog.showModal();
}

// ── Approvals ──────────────────────────────────────────────────────────────
async function renderApprovals() {
	const status = new URLSearchParams(location.hash.split("?")[1] || "").get("status") || "pending";
	const rows = await api(`/approvals?status=${status}`);
	const out = h("div", {}, h("h1", {}, "Approvals"), h("p", { class: "sub" }, "Nothing is removed until you approve it. Each approval is re-checked against live data right before execution."));
	out.append(h("div", { class: "row", style: "margin-bottom:12px" }, ...["pending", "retry_pending", "executed", "blocked", "rejected", "expired"].map((s) => h("a", { href: `#/approvals?status=${s}`, class: "pill " + (s === status ? "ok" : "") }, s.replace("_", " ")))));
	if (!rows.length) return out.appendChild(h("div", { class: "card empty" }, `No ${status.replace("_", " ")} approvals.`)), out;
	const boxes = [];
	const act = (action, ids) => async (e) => guard(e.target, async () => {
		if (action === "approve" && !confirm(`Approve ${ids().length} item(s)? They will be removed now.`)) return;
		const r = await api("/approvals/bulk", { method: "POST", body: { ids: ids(), action } });
		const bad = r.results.filter((x) => !x.ok).length; toast(bad ? `${bad} failed: ${r.results.find((x) => !x.ok).error}` : "Done"); route();
	});
	const selected = () => boxes.filter((b) => b.checked).map((b) => b.value);
	if (status === "pending" || status === "retry_pending") out.append(h("div", { class: "row", style: "margin-bottom:8px" }, h("button", { class: "primary", onclick: act("approve", selected) }, "Approve selected"), h("button", { onclick: act("reject", selected) }, "Reject selected")));
	out.append(h("div", { class: "card table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, h("input", { type: "checkbox", onchange: (e) => boxes.forEach((b) => (b.checked = e.target.checked)) })), h("th", {}, "Title"), h("th", {}, "Rule / reason"), h("th", { class: "num" }, "Size"), h("th", {}, "Status"), h("th", {}, "Expires"))),
		h("tbody", {}, rows.map((a) => { const b = h("input", { type: "checkbox", value: a.id, disabled: !["pending", "retry_pending"].includes(a.status) }); boxes.push(b);
			return h("tr", {}, h("td", {}, b), h("td", {}, a.title, a.year ? ` (${a.year})` : "", h("div", { class: "muted small" }, a.action)), h("td", { class: "small" }, h("strong", {}, a.ruleName), h("div", {}, a.reason)), h("td", { class: "num" }, bytes(a.sizeOnDisk)), h("td", {}, statusPill(a.status), a.lastError ? h("div", { class: "muted small" }, a.lastError) : null), h("td", { class: "small muted" }, when(a.expiresAt))); })))));
	return out;
}

// ── History ────────────────────────────────────────────────────────────────
async function renderHistory() {
	const [runs, audit] = await Promise.all([api("/logs?limit=30"), api("/audit?limit=100")]);
	const out = h("div", {}, h("h1", {}, "History"));
	out.append(h("h2", {}, "Runs"), runs.length ? h("div", { class: "card table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Started"), h("th", {}, "Trigger"), h("th", {}, "Mode"), h("th", {}, "Status"), h("th", { class: "num" }, "Flagged"), h("th", { class: "num" }, "Removed"), h("th", { class: "num" }, "Reclaimed"), h("th"))),
		h("tbody", {}, runs.map((r) => h("tr", {}, h("td", {}, when(r.startedAt)), h("td", {}, r.trigger), h("td", {}, r.isDryRun ? "dry run" : "live"), h("td", {}, statusPill(r.status)), h("td", { class: "num" }, r.itemsFlagged), h("td", { class: "num" }, r.itemsRemoved), h("td", { class: "num" }, bytes(r.bytesReclaimed)),
			h("td", {}, h("button", { class: "small", onclick: async () => { try { const full = await api(`/logs/${r.id}`); dialog.replaceChildren(h("h1", {}, `Run ${when(full.startedAt)}`), ...full.warnings.map((w) => h("div", { class: "warnbox" }, w)), full.error ? h("div", { class: "warnbox" }, full.error) : null, detailTable(full.details, false), h("div", { class: "row end" }, h("button", { onclick: () => dialog.close() }, "Close"))); dialog.showModal(); } catch (e) { fail(e); } } }, "Details"))))))) : h("div", { class: "card empty" }, "No runs yet."));
	out.append(h("h2", {}, "Audit trail"), h("p", { class: "sub" }, "Append-only record of every selection, approval, block and removal."), audit.length ? h("div", { class: "card table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "When"), h("th", {}, "Event"), h("th", {}, "Item"), h("th", {}, "Actor"), h("th", {}, "Detail"))),
		h("tbody", {}, audit.map((e) => h("tr", {}, h("td", { class: "small muted" }, when(e.created_at)), h("td", {}, pill(e.event_type.replaceAll("_", " "), { success: "ok", blocked: "bad", failed: "bad" }[e.outcome] || "")), h("td", {}, e.title, h("div", { class: "muted small" }, `${e.rule_name || ""} · ${e.action}`)), h("td", { class: "small" }, `${e.actor} (${e.trigger})`), h("td", { class: "small" }, e.reason)))))) : h("div", { class: "card empty" }, "No activity yet."));
	return out;
}

// ── Instances ──────────────────────────────────────────────────────────────
async function renderInstances() {
	const list = await api("/instances");
	const out = h("div", {}, h("div", { class: "row" }, h("div", {}, h("h1", {}, "Instances"), h("p", { class: "sub" }, "Sonarr and Radarr hold your library. Plex (or Tautulli) provides watch history and Seerr provides requests; both are optional.")), h("span", { class: "spacer" }), h("button", { class: "primary", onclick: () => editInstance() }, "Add instance")));
	if (!list.length) return out.appendChild(h("div", { class: "card empty" }, "No instances yet.")), out;
	const test = (i) => (e) => guard(e.target, async () => { const r = await api(`/instances/${i.id}/test`, { method: "POST" }); toast(r.ok ? `${i.name}: connected` : `${i.name}: ${r.error}`); });
	const remove = async (i) => { if (!confirm(`Remove ${i.name}?`)) return; try { await api(`/instances/${i.id}`, { method: "DELETE" }); route(); } catch (e) { fail(e); } };
	const row = (i) => h("tr", {},
		h("td", {}, h("strong", {}, i.name)), h("td", {}, i.type), h("td", { class: "small" }, i.url), h("td", {}, i.enabled ? "Yes" : "No"),
		h("td", { class: "num" },
			h("button", { class: "small", onclick: test(i) }, "Test"), " ",
			h("button", { class: "small", onclick: () => editInstance(i) }, "Edit"), " ",
			h("button", { class: "small danger", onclick: () => remove(i) }, "Remove")));
	const head = h("thead", {}, h("tr", {}, h("th", {}, "Name"), h("th", {}, "Type"), h("th", {}, "URL"), h("th", {}, "Enabled"), h("th")));
	out.append(h("div", { class: "card table-wrap" }, h("table", {}, head, h("tbody", {}, list.map(row)))));
	return out;
}
function editInstance(inst) {
	const name = h("input", { value: inst?.name || "" });
	const type = h("select", { disabled: !!inst }, ["sonarr", "radarr", "plex", "seerr", "tautulli"].map((t) => h("option", { value: t, selected: t === inst?.type }, t)));
	const keyLabel = h("label", {}, "API key");
	const hint = h("div", { class: "muted small" });
	const paintType = () => { keyLabel.textContent = type.value === "plex" ? "X-Plex-Token" : "API key"; hint.textContent = type.value === "plex" ? "Use the server owner's token so history for all users is visible. Default URL port is 32400." : type.value === "seerr" ? "Overseerr / Jellyseerr / Seerr API key (Settings → General)." : ""; };
	type.addEventListener("change", paintType); paintType();
	const url = h("input", { value: inst?.url || "", placeholder: "http://host:port" });
	const key = h("input", { type: "password", placeholder: inst ? "leave blank to keep the current key" : "API key", autocomplete: "off" });
	const enabled = h("input", { type: "checkbox", checked: inst ? inst.enabled : true });
	const test = h("button", { onclick: (e) => guard(e.target, async () => { if (!key.value && !inst) throw new Error("Enter an API key first"); const r = key.value ? await api("/instances/test", { method: "POST", body: { type: type.value, url: url.value, apiKey: key.value } }) : await api(`/instances/${inst.id}/test`, { method: "POST" }); toast(r.ok ? "Connected" : r.error); }) }, "Test connection");
	const save = h("button", { class: "primary", onclick: (e) => guard(e.target, async () => {
		const body = { name: name.value, url: url.value, enabled: enabled.checked, ...(key.value ? { apiKey: key.value } : {}) };
		await api(inst ? `/instances/${inst.id}` : "/instances", { method: inst ? "PUT" : "POST", body: inst ? body : { ...body, type: type.value } });
		dialog.close(); route();
	}) }, "Save");
	dialog.replaceChildren(h("h1", {}, inst ? "Edit instance" : "Add instance"), h("div", { class: "field" }, h("label", {}, "Name"), name), h("div", { class: "field" }, h("label", {}, "Type"), type), h("div", { class: "field" }, h("label", {}, "URL"), url), h("div", { class: "field" }, keyLabel, key, hint),
		h("div", { class: "field" }, h("label", { class: "check" }, enabled, "Enabled")), h("div", { class: "row end" }, h("button", { onclick: () => dialog.close() }, "Cancel"), test, save));
	dialog.showModal();
}

// ── Settings ───────────────────────────────────────────────────────────────
async function renderSettings() {
	const c = await api("/config");
	const num = (v, min = 0) => h("input", { type: "number", min, value: v ?? "" });
	const interval = num(c.intervalHours, 1), max = num(c.maxRemovalsPerRun, 1), expiry = num(c.approvalExpiryDays, 1);
	const rej = h("select", {}, [["0", "Off: rejected items can be proposed again next run"], ["30", "30 days"], ["90", "90 days"], ["365", "1 year"], ["forever", "Forever"]].map(([v, l]) => h("option", { value: v, selected: v === (c.rejectionMemoryDays === null ? "forever" : String(c.rejectionMemoryDays)) }, l)));
	const cb = (checked, label, help) => { const i = h("input", { type: "checkbox", checked }); return [i, h("div", { class: "field" }, h("label", { class: "check" }, i, label), help ? h("div", { class: "muted small" }, help) : null)]; };
	const [dry, dryF] = cb(c.dryRun, "Dry-run mode", "Report what would be removed without changing anything or creating approvals. Recommended until you trust your rules.");
	const [appr, apprF] = cb(c.requireApproval, "Require approval", "Queue matches for review instead of removing them automatically.");
	const [on, onF] = cb(c.enabled, "Run on a schedule");
	const save = h("button", { class: "primary", onclick: (e) => guard(e.target, async () => {
		if (!dry.checked && c.dryRun && !confirm("Leaving dry-run means real removals are possible. Continue?")) return;
		await api("/config", { method: "PUT", body: { dryRun: dry.checked, requireApproval: appr.checked, enabled: on.checked, intervalHours: Number(interval.value), maxRemovalsPerRun: Number(max.value), approvalExpiryDays: Number(expiry.value), rejectionMemoryDays: rej.value === "forever" ? null : Number(rej.value) } });
		toast("Saved"); refreshMode();
	}) }, "Save settings");
	return h("div", {}, h("h1", {}, "Settings"), h("div", { class: "card" }, dryF, apprF, onF,
		h("div", { class: "field" }, h("label", {}, "Run every (hours)"), interval), h("div", { class: "field" }, h("label", {}, "Max removals per run"), max), h("div", { class: "field" }, h("label", {}, "Approvals expire after (days)"), expiry), h("div", { class: "field" }, h("label", {}, "Rejection memory"), rej), save));
}

route();
