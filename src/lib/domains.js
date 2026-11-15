/**
 * Pure helpers for matching URLs against GOOGLE_DOMAINS.
 *
 * Nothing in here touches browser APIs, so everything can be unit-tested
 * under plain Node. The popup and the background worker share these
 * helpers so both always agree on which service a URL belongs to.
 */
import { GOOGLE_DOMAINS } from "./constants.js";

const GOOGLE_HOST_SUFFIXES = ["google.com", "youtube.com", "gmail.com"];

/**
 * True if `hostname` is google.com, youtube.com or gmail.com or a subdomain
 * of one of them. A leading dot (as in cookie domains) is ignored.
 *
 * Unlike `hostname.includes("google.com")` this does not match look-alikes
 * such as `notgoogle.com` or `google.com.example.org`.
 *
 * @param {string} hostname
 * @returns {boolean}
 */
export function isGoogleHost(hostname) {
	if (!hostname) return false;
	const host = hostname.replace(/^\./, "").toLowerCase();
	return GOOGLE_HOST_SUFFIXES.some(
		(suffix) => host === suffix || host.endsWith(`.${suffix}`),
	);
}

/**
 * True if `pathname` equals `prefix` or lives below it. `/mail` matches
 * `/mail` and `/mail/u/0/` but not `/mailing`. An empty prefix matches
 * every path.
 *
 * @param {string} pathname
 * @param {string} [prefix]
 * @returns {boolean}
 */
export function pathMatchesPrefix(pathname, prefix) {
	if (!prefix) return true;
	return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * Find the GOOGLE_DOMAINS entry that applies to a URL.
 *
 * Priority chain (same for every entry type):
 *   1. queryMatch entries whose query parameter is present (e.g. udm=50)
 *   2. entries with a pathPrefix that matches (longest prefix wins)
 *   3. catch-all entries (no pathPrefix, no queryMatch)
 *
 * @param {string} url
 * @param {Object} [options]
 * @param {boolean} [options.resolveGmailAlias=false] - Treat gmail.com and
 *   *.gmail.com as mail.google.com (the popup does this; a DNR rule already
 *   redirects those hosts, so the background worker never needs to).
 * @returns {Object|null} The matching entry, or null
 */
export function findMatchingDomain(url, { resolveGmailAlias = false } = {}) {
	let parsed;
	try {
		parsed = new URL(url);
	} catch {
		return null;
	}

	const host = parsed.hostname;

	if (
		resolveGmailAlias &&
		(host === "gmail.com" || host.endsWith(".gmail.com"))
	) {
		return GOOGLE_DOMAINS.find((d) => d.host === "mail.google.com") ?? null;
	}

	const matches = GOOGLE_DOMAINS.filter(
		(d) => d.host === host && d.type !== "excluded",
	);
	if (matches.length === 0) return null;

	// 1. queryMatch entries (e.g., udm=50 for AI mode)
	const queryMatched = matches.find(
		(d) =>
			d.queryMatch &&
			pathMatchesPrefix(parsed.pathname, d.pathPrefix) &&
			parsed.searchParams.get(d.queryMatch.key) === d.queryMatch.value,
	);
	if (queryMatched) return queryMatched;

	// 2. Specific pathPrefix entries, longest prefix first
	const pathMatched = matches
		.filter(
			(d) =>
				d.pathPrefix &&
				!d.queryMatch &&
				pathMatchesPrefix(parsed.pathname, d.pathPrefix),
		)
		.sort((a, b) => b.pathPrefix.length - a.pathPrefix.length);
	if (pathMatched.length > 0) return pathMatched[0];

	// 3. Catch-all
	return matches.find((d) => !d.pathPrefix && !d.queryMatch) ?? null;
}
