import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { Panel, SectionTitle } from "../../components/ui/Layout";
import { Segmented } from "../../components/ui/Segmented";
import { StateBadge } from "../../components/ui/StateBadge";
import { RuleKindTag, ServiceTag } from "../../components/ui/Tags";
import type { Instance, RuleTemplate, RuleTypeDef } from "../../types";
import { ExprText } from "./ExprText";

type SvcFilter = "all" | "radarr" | "sonarr";
// Survives the re-render after a rule is saved.
const remembered = { group: "all", svc: "all" as SvcFilter };

export interface TemplatesSectionProps {
	templates: RuleTemplate[];
	instances: Instance[];
	types: RuleTypeDef[];
	onUse: (t: RuleTemplate) => void;
}

/** Filterable library of ready-made rules; nothing is saved until the editor's Create. */
export function TemplatesSection({ templates, instances, types, onUse }: TemplatesSectionProps) {
	const [group, setGroup] = useState(remembered.group);
	const [svc, setSvc] = useState<SvcFilter>(remembered.svc);
	const pick = <T,>(set: (v: T) => void, key: keyof typeof remembered) => (v: T) => { set(v); (remembered as Record<string, unknown>)[key] = v; };
	const has = (t: string) => instances.some((i) => i.enabled && i.type === t);
	const groups = [...new Set(templates.map((t) => t.group))];
	const shown = templates.filter((t) => (group === "all" || t.group === group) && (svc === "all" || !t.serviceFilter || t.serviceFilter.includes(svc)));
	return (
		<section id="templates" style={{ marginTop: 32 }}>
			<SectionTitle title="Template library" grow={false}><span className="faint small">The quickest way to add a rule. Nothing is saved until you review and create it.</span></SectionTitle>
			<div className="row" style={{ gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
				<Segmented label="Services" value={svc} onChange={pick(setSvc, "svc")} options={[["all", "Radarr + Sonarr"], ["radarr", "Radarr"], ["sonarr", "Sonarr"]]} />
				<Segmented label="Group" className="wrap" value={group} onChange={pick(setGroup, "group")}
					options={[["all", `All ${templates.length}`], ...groups.map((g) => [g, `${g} ${templates.filter((t) => t.group === g).length}`] as const)]} />
			</div>
			<Panel>
				<ul className="rules templates">
					{shown.length ? shown.map((t) => {
						const missing = ([t.needs.watch && ["Plex", "plex"], t.needs.seerr && ["Seerr", "seerr"]].filter(Boolean) as string[][]).filter(([, k]) => !has(k!)).map(([l]) => l);
						return (
							<li key={t.title}>
								<div className="body">
									<div className="nm"><strong>{t.title}</strong><RuleKindTag mode={t.mode} action={t.action} />{(t.serviceFilter || []).map((s) => <ServiceTag key={s} service={s} />)}</div>
									<p className="desc">{t.description}</p>
									<div className="expr"><ExprText expr={t.expression} types={types} /></div>
									{missing.length ? <div className="need"><StateBadge state="unknown" label={`Needs ${missing.join(" and ")} connected`} /></div> : null}
								</div>
								<div className="acts"><Button className="primary" onClick={() => onUse(t)}>Use template</Button></div>
							</li>
						);
					}) : <li><div className="body faint">No templates match these filters.</div></li>}
				</ul>
			</Panel>
		</section>
	);
}
