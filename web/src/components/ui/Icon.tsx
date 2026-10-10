import { createElement } from "react";
import { ICONS, type IconName } from "./iconData";

export type { IconName };

export function Icon({ name }: { name: IconName }) {
	return (
		<svg viewBox="0 0 16 16" className="i" aria-hidden="true">
			{(ICONS[name] as ReadonlyArray<readonly [string, object]>).map(([tag, props], i) => createElement(tag, { key: i, ...props }))}
		</svg>
	);
}
