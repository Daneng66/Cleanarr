import { useEffect, useState } from "react";

export interface ArtProps {
	src?: string | null;
	title: string;
	/** Class on the <img>. */
	imgClass?: string;
	/** Class on the text stand-in shown when there is no image or it fails to load. */
	fallbackClass: string;
	/** Element used for the stand-in. */
	as?: "span" | "div";
	lazy?: boolean;
}

/** Poster image with the title as a text fallback. */
export function Art({ src, title, imgClass, fallbackClass, as: Tag = "span", lazy = false }: ArtProps) {
	const [failed, setFailed] = useState(false);
	useEffect(() => setFailed(false), [src]);
	if (!src || failed) return <Tag className={fallbackClass}>{title}</Tag>;
	return <img src={src} alt="" className={imgClass} {...(lazy ? { loading: "lazy" as const, decoding: "async" as const } : {})} onError={() => setFailed(true)} />;
}
