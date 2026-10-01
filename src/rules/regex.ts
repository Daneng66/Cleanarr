const MAX_LENGTH = 200;
/** Rejects the common catastrophic-backtracking shapes: a quantified group that itself contains a quantifier. */
const NESTED_QUANTIFIER = /\((?:[^()\\]|\\.)*[+*](?:[^()\\]|\\.)*\)[+*{]/;

export function getRegexError(pattern: string): string | null {
	if (pattern.length > MAX_LENGTH) return `Pattern exceeds ${MAX_LENGTH} characters`;
	if (NESTED_QUANTIFIER.test(pattern)) return "Pattern has nested quantifiers (risk of catastrophic backtracking)";
	try {
		new RegExp(pattern, "i");
	} catch (e) {
		return `Invalid pattern: ${(e as Error).message}`;
	}
	return null;
}

const cache = new Map<string, RegExp | null>();

/** Compiled, cached, case-insensitive regex, or null when the pattern is unsafe/invalid. */
export function safeRegex(pattern: string): RegExp | null {
	let hit = cache.get(pattern);
	if (hit === undefined) {
		hit = getRegexError(pattern) ? null : new RegExp(pattern, "i");
		cache.set(pattern, hit);
	}
	return hit;
}
