import { useState } from "react";
import { Art } from "../../components/media/Art";
import { OpenInArrButton } from "../../components/media/LinkButtons";
import { Button } from "../../components/ui/Button";
import { DialogFrame } from "../../components/ui/DialogFrame";
import { StateBadge } from "../../components/ui/StateBadge";
import { bytesParts, kindLabel, when } from "../../lib/format";
import { SERVICES } from "../../lib/services";
import { useToast } from "../../providers/ToastProvider";
import type { LibraryRow } from "../../types";
import type { LibraryActions } from "./useLibraryActions";

export function LibraryDetailDialog({ d, actions, onClose }: { d: LibraryRow; actions: LibraryActions; onClose: () => void }) {
	const toast = useToast();
	const [protectedId, setProtectedId] = useState(d.protectedId);
	const [n, u] = bytesParts(d.sizeOnDisk);
	const dd = (k: string, v: string | string[] | null | undefined) =>
		v == null || v === "" || (Array.isArray(v) && !v.length) ? null : <><dt>{k}</dt><dd>{Array.isArray(v) ? v.join(", ") : v}</dd></>;
	/** Closes unless the title is still there after an unmonitor. */
	const act = async (action: "unmonitor" | "delete_files" | "delete") => {
		const gone = await actions.remove([d], action);
		if (gone || action !== "unmonitor") onClose();
	};
	return (
		<DialogFrame title={`${d.title}${d.year ? ` (${d.year})` : ""}`} onClose={onClose} foot={<Button onClick={onClose}>Close</Button>}>
			<div className="detail">
				<Art src={d.poster} title={d.title} imgClass="thumb" fallbackClass="thumb noart" as="div" />
				<div className="main">
					<div className="fig"><span className="n">{n}</span><span className="u">{u}</span>{protectedId ? <StateBadge state="protected" /> : null}</div>
					<dl className="basis">
						{dd("Type", kindLabel(d.itemType))}{dd("Service", SERVICES[d.service])}{dd("Status", d.status)}{dd("Monitored", d.monitored ? "Yes" : "No")}
						{dd("Files", d.itemType === "series" ? `${d.fileCount} episode files` : d.hasFile ? "1 file" : "No file")}
						{dd("Rated", d.certification)}{dd("Rating", d.rating ? d.rating.toFixed(1) : null)}{dd("Quality profile", d.qualityProfile)}{dd("Genres", d.genres)}
						{dd("Tags", d.tags)}{dd("Added", d.added ? when(d.added) : null)}{dd("Path", d.path)}
					</dl>
					<div className="acts">
						<OpenInArrButton item={d} className="small" />
						<Button icon={protectedId ? "unprotected" : "protected"} className="small" onAction={async () => {
							const id = await actions.setProtected(d, !protectedId, protectedId);
							setProtectedId(id);
							toast.show(`${id ? "Protected" : "Unprotected"} ${d.title}`);
						}}>{protectedId ? "Unprotect" : "Protect"}</Button>
						{d.monitored ? <Button icon="unprotected" className="small" onAction={() => act("unmonitor")}>Unmonitor</Button> : null}
						{d.hasFile || d.fileCount ? <Button icon="trash" className="small" onAction={() => act("delete_files")}>Delete files</Button> : null}
						<Button icon="trash" className="small danger" onAction={() => act("delete")}>Delete</Button>
					</div>
				</div>
			</div>
		</DialogFrame>
	);
}
