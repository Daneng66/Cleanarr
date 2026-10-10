import { Fragment } from "react";
import { HelpTip } from "../ui/HelpTip";

const TITLE_EXAMPLES = [
	["^Star Wars", "Starts with Star Wars"], ["Harry Potter", "Contains Harry Potter anywhere"], ["^The Office$", "Exactly The Office, nothing more"],
	["Lord of the Rings|Hobbit", "Either one: | means or"], ["Christmas|Holiday", "Keeps seasonal favourites"],
];

/** "?" popover explaining title patterns, shared by the rule editor and the library filter. */
export const TitleRegexTip = () => (
	<HelpTip label="Title pattern examples">
		<div className="tip-h">Pattern examples</div>
		<dl>{TITLE_EXAMPLES.map(([p, d]) => <Fragment key={p}><dt><code>{p}</code></dt><dd>{d}</dd></Fragment>)}</dl>
		<p>Matching ignores case and checks the title only, not the year. Separate patterns with commas, so a pattern can't contain one.</p>
	</HelpTip>
);
