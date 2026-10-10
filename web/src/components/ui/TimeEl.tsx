import { ago, when } from "../../lib/format";

export const TimeEl = ({ value }: { value?: string | null }) => <time dateTime={value || ""} title={when(value)}>{ago(value)}</time>;
