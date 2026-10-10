import { IconButton } from "../ui/Button";
import { serviceLabel } from "../ui/Tags";
import { useApi } from "../../providers/ApiProvider";
import { useToast } from "../../providers/ToastProvider";
import type { ItemRef } from "../../types";

interface LinkResult {
	url: string;
	plexUrl?: string | null;
}
const linkPath = (d: ItemRef) => `/link/${encodeURIComponent(d.instanceId)}/${d.arrItemId}`;

/** Opens the item's Sonarr/Radarr page in a new tab. */
export function OpenInArrButton({ item, className = "ghost small" }: { item: ItemRef; className?: string }) {
	const api = useApi();
	const svc = item.itemType === "movie" ? "radarr" : "sonarr";
	return <IconButton icon={svc} label={`Open in ${serviceLabel(svc)}`} className={className}
		onAction={async () => window.open((await api.get<LinkResult>(linkPath(item))).url, "_blank", "noopener")} />;
}

/** Opens the item in Plex's web app; reports when Plex isn't connected or doesn't have the title. */
export function OpenInPlexButton({ item, className = "ghost small" }: { item: ItemRef; className?: string }) {
	const api = useApi();
	const toast = useToast();
	return <IconButton icon="plex" label="Open in Plex" className={className} onAction={async () => {
		const { plexUrl } = await api.get<LinkResult>(linkPath(item));
		if (plexUrl) window.open(plexUrl, "_blank", "noopener");
		else toast.show("Not found in Plex");
	}} />;
}
