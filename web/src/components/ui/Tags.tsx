const ACTION_LABEL: Record<string, string> = { delete: "Delete", unmonitor: "Unmonitor", delete_files: "Delete files", delete_season: "Delete season" };
const SERVICE_LABEL: Record<string, string> = { sonarr: "Sonarr", radarr: "Radarr" };

export const actionLabel = (a: string) => ACTION_LABEL[a] || a;
export const serviceLabel = (s: string) => SERVICE_LABEL[s] || s;

export const ActionTag = ({ action }: { action: string }) => <span className={`tag ${action}`}>{actionLabel(action)}</span>;
export const ProtectTag = () => <span className="tag protect">Protect</span>;
export const ServiceTag = ({ service }: { service: string }) => <span className="tag service">{serviceLabel(service)}</span>;
/** Rule kind: retention rules protect, cleanup rules act. */
export const RuleKindTag = ({ mode, action }: { mode: string; action: string }) => (mode === "retention" ? <ProtectTag /> : <ActionTag action={action} />);
