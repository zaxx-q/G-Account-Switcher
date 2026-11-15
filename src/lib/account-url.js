/**
 * Pure helpers for reading and rewriting the account index in Google URLs.
 *
 * Google identifies the active account in one of two ways:
 *   - path-based:  /mail/u/1/inbox   (domain.type === "path")
 *   - query-based: /search?authuser=1 (domain.type === "query")
 *
 * Both the proactive redirect and the popup's "switch now" action go through
 * `buildAccountUrl`, so there is exactly one implementation of the rewrite.
 */
import { pathMatchesPrefix } from "./domains.js";

const PATH_ACCOUNT = /^\/u\/(\d+)(?=\/|$)/;

/**
 * Read the account index a URL currently points at, according to the
 * domain's type. Path-type domains only look at the path (after the
 * domain's prefix) and query-type domains only look at `authuser=`, so a
 * stray `/u/2/` inside a search query is never mistaken for an account.
 *
 * @param {string} url
 * @param {Object} domain - A GOOGLE_DOMAINS entry
 * @returns {number|null} The account index, or null if none (or non-numeric,
 *   e.g. `authuser=someone@gmail.com`)
 */
export function extractAccount(url, domain) {
	let parsed;
	try {
		parsed = new URL(url);
	} catch {
		return null;
	}

	if (domain.type === "path") {
		const prefix = domain.pathPrefix || "";
		if (!pathMatchesPrefix(parsed.pathname, prefix)) return null;
		const match = parsed.pathname.slice(prefix.length).match(PATH_ACCOUNT);
		return match ? parseInt(match[1], 10) : null;
	}

	if (domain.type === "query") {
		const raw = parsed.searchParams.get("authuser");
		return raw !== null && /^\d+$/.test(raw) ? parseInt(raw, 10) : null;
	}

	return null;
}

/**
 * Return `url` rewritten to use `accountNum`, or null if no change is needed.
 *
 * - Path domains: replaces an existing `/u/N` or inserts `/u/<n>/` after the
 *   domain's prefix.
 * - Query domains: sets `authuser=<n>`. A non-numeric `authuser` value (an
 *   email address, say) is left alone unless `force` is set, because the
 *   user or Google put it there on purpose.
 *
 * @param {string} url
 * @param {Object} domain - A GOOGLE_DOMAINS entry
 * @param {number} accountNum - Target account index
 * @param {Object} [options]
 * @param {boolean} [options.force=false] - Overwrite a non-numeric authuser
 *   (used for explicit user-initiated switches from the popup)
 * @returns {string|null}
 */
export function buildAccountUrl(url, domain, accountNum, { force = false } = {}) {
	let parsed;
	try {
		parsed = new URL(url);
	} catch {
		return null;
	}

	if (domain.type === "path") {
		const prefix = domain.pathPrefix || "";
		if (!pathMatchesPrefix(parsed.pathname, prefix)) return null;

		const after = parsed.pathname.slice(prefix.length);
		const existing = after.match(PATH_ACCOUNT);

		if (existing) {
			if (parseInt(existing[1], 10) === accountNum) return null;
			parsed.pathname = `${prefix}/u/${accountNum}${after.slice(existing[0].length)}`;
		} else if (after === "" || after === "/") {
			parsed.pathname = `${prefix}/u/${accountNum}/`;
		} else {
			parsed.pathname = `${prefix}/u/${accountNum}${after}`;
		}
		return parsed.toString();
	}

	if (domain.type === "query") {
		const raw = parsed.searchParams.get("authuser");
		if (raw !== null) {
			const isNumeric = /^\d+$/.test(raw);
			if (isNumeric && parseInt(raw, 10) === accountNum) return null;
			if (!isNumeric && !force) return null;
		}
		parsed.searchParams.set("authuser", String(accountNum));
		return parsed.toString();
	}

	return null;
}
