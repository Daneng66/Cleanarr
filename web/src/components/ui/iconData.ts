import type { SVGProps } from "react";

type Shape = [tag: "path" | "rect" | "circle", props: SVGProps<SVGElement>];
const FILL = { fill: "currentColor", stroke: "none" } as const;
const SQ = { x: 3, y: 3, width: 10, height: 10, rx: 1 } as const;
const SHIELD = "M8 1.8l5.2 2v4.1c0 3.1-2.2 5.3-5.2 6.3-3-1-5.2-3.2-5.2-6.3V3.8z";

/** One 16px, 1.6-stroke set. The state marks are the closed vocabulary used on every screen. Add an entry to add an icon. */
export const ICONS = {
	loaded: [["rect", { ...SQ, ...FILL }]],
	flagged: [["rect", { x: 2, y: 3, width: 8, height: 10, rx: 1, ...FILL }], ["path", { d: "M12 5l3 3-3 3" }]],
	queued: [["rect", SQ], ["rect", { x: 3, y: 8, width: 10, height: 5, ...FILL }]],
	protected: [["path", { d: SHIELD }]],
	unprotected: [["path", { d: SHIELD }], ["path", { d: "M2.5 13.5l11-11" }]],
	unknown: [["rect", { ...SQ, strokeDasharray: "2.2 2" }]],
	ejected: [["rect", SQ], ["path", { d: "M3.5 12.5l9-9" }]],
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
	// Simplified platform marks (filled): Plex chevron, Radarr target, Sonarr wave.
	plex: [["path", { d: "M4.5 1.5h3.6L12.5 8l-4.4 6.5H4.5L8.9 8z", ...FILL }]],
	radarr: [["path", { d: "m80.3 80.8 3.9 372.4c-31.4 3.9-54.9-11.8-54.9-43.1l-3.9-309.7c0-98 90.2-121.5 145.1-82.3l278.3 160.7c39.2 27.4 47 78.4 27.4 113.7-3.9-27.4-15.7-43.1-39.2-58.8L123.4 57.2C99.9 41.6 80.3 45.5 80.3 80.8m-23.5 392c23.5 7.8 47 3.9 66.6-7.8l321.5-188.2c19.6 27.4 15.7 54.9-7.8 70.6L166.5 504.2c-39.2 19.6-90.1 0-109.7-31.4M150.9 363 343 253.3 154.8 147.4z", transform: "scale(.03125)", ...FILL }]],
	sonarr: [
		["path", { d: "m459.7 100.3-52.9 52.9c-30.9 30.9-33.6 57.8-33.6 105.3 0 42.3 6.7 81.1 38.2 112.6 23 23 44.9 44.7 44.9 44.7-5.9 7.2-12.3 14.3-19.1 21.2-1.7 2-3.5 3.8-5.5 5.4-6 5.9-12.2 11.4-18.6 16.4l-41.4-41.4C334.9 380.6 305.6 377 257 377c-46.7 0-78.4 4.3-112.6 38.5-20.4 20.4-43.8 43.9-43.8 43.9-8.9-6.8-17.3-14.2-25.3-22.4-6.6-6.6-12.8-13.4-18.5-20.3 0 0 23.1-23.2 45.2-45.3 32.7-32.7 38-70.6 38-113 0-41.3-6.8-79.8-36.8-109.9C82.2 127.7 53.3 99 53.3 99c6.7-8.5 14-16.7 21.8-24.5 6.9-6.8 14-13.1 21.2-19l48 48c30.7 30.7 70 38.6 112.4 38.6 43.6 0 82.8-8.4 114.7-40.4C391 82.1 417 56.3 417 56.3c6.8 5.6 13.5 11.6 20.1 18.2 8.3 8.3 15.8 16.9 22.6 25.8", transform: "scale(.03125)", ...FILL, fillRule: "evenodd" }],
		["path", { d: "M186 269.1c-.5-2.8-.8-5.5-.9-8.4-.1-1.6-.1-3.1-.1-4.7 0-1.7 0-3.2.1-4.7 0-.2 0-.3.1-.5 1-17.4 7.9-32.4 20.5-45.1 13.9-13.8 30.6-20.7 50.2-20.7s36.3 6.9 50.2 20.7c13.8 14 20.7 30.8 20.7 50.3s-6.9 36.2-20.7 50.2c-.5.5-1 1.1-1.5 1.5q-3.45 3.3-7.2 6-18 13.2-41.4 13.2c-23.4 0-29.4-4.4-41.3-13.2-3.1-2.2-6.1-4.7-8.9-7.6-10.8-10.6-17.3-22.9-19.8-37", transform: "scale(.03125)", ...FILL, fillRule: "evenodd" }],
	],
	external: [["path", { d: "M6.5 3H3.5v9.5H13V9.5" }], ["path", { d: "M8.5 3H13v4.5" }], ["path", { d: "M13 3L7 9" }]],
} satisfies Record<string, Shape[]>;

export type IconName = keyof typeof ICONS;
