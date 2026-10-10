import { ActionTag } from "../../components/ui/Tags";
import { Panel, SectionTitle } from "../../components/ui/Layout";
import { bytes, frees, plural } from "../../lib/format";
import type { Candidate } from "../../types";

/** Which rules account for the reclaimable space. */
export function DriversPanel({ candidates }: { candidates: Candidate[] }) {
	const by = new Map<string, { name: string; action: string; n: number; b: number }>();
	for (const c of candidates) {
		const r = by.get(c.ruleId) || { name: c.ruleName, action: c.action, n: 0, b: 0 };
		r.n++;
		if (frees(c)) r.b += c.sizeOnDisk;
		by.set(c.ruleId, r);
	}
	const rows = [...by.values()].sort((a, b) => b.b - a.b), max = rows[0]?.b || 1;
	return (
		<section style={{ marginTop: 28 }}>
			<SectionTitle title="What's driving it"><a href="#/rules" className="small">Edit rules</a></SectionTitle>
			<Panel>
				<ul className="drivers">
					{rows.map((r) => (
						<li key={r.name}>
							<div className="nm"><strong>{r.name}</strong><ActionTag action={r.action} /></div>
							<div className="bar" aria-hidden="true"><span style={{ width: `${r.b ? Math.max((r.b / max) * 100, 1) : 0}%` }} /></div>
							<div className="v">{bytes(r.b)}<small>{plural(r.n, "title")}</small></div>
						</li>
					))}
				</ul>
			</Panel>
		</section>
	);
}
