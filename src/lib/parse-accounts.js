/**
 * Parsing of Google's ListAccounts response, and merging of detected
 * accounts with the ones already stored.
 *
 * Pure functions only (no browser APIs) so they can be tested under Node
 * with captured response fixtures.
 *
 * The endpoint returns a JSON-like array. Each account is an array that
 * starts with the marker "gaia.l.a":
 *   [
 *     "gaia.l.a.r",
 *     [
 *       ["gaia.l.a", 1, "Display Name", "email@gmail.com", "Photo URL", ...],
 *       ...
 *     ]
 *   ]
 *
 * Two wire formats exist:
 *   A) XSSI-prefixed JSON:   )]}'\n["gaia.l.a.r",[...]]
 *   B) HTML + postMessage:   <script>window.parent.postMessage('\x5b...', '*')</script>
 */

const MAX_TRAVERSAL_DEPTH = 15;

/**
 * Decode the body of a single-quoted JavaScript string literal
 * (\xNN, \uNNNN, \n, \', \\ ...) in one pass, so an escaped backslash is
 * never decoded twice.
 */
function unescapeJsString(escaped) {
	return escaped.replace(
		/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|[\s\S])/g,
		(_, seq) => {
			if (seq.length > 1) {
				return String.fromCharCode(parseInt(seq.slice(1), 16));
			}
			if (seq === "n") return "\n";
			if (seq === "r") return "\r";
			if (seq === "t") return "\t";
			return seq; // \' \" \\ \/ and anything else stands for itself
		},
	);
}

/**
 * Turn the raw response text into parsed JSON.
 *
 * @param {string} text - Raw response body
 * @returns {*} Parsed JSON
 * @throws {SyntaxError} If the text is in no recognised format
 */
export function parseListAccountsResponse(text) {
	const trimmed = text.trim();

	// Format A: strip the XSSI guard
	if (trimmed.startsWith(")]}'")) {
		return JSON.parse(trimmed.replace(/^\)\]\}'[\r\n]*/, "").trim());
	}

	// Format B: HTML wrapper, payload is the postMessage argument
	const postMessage = trimmed.match(
		/window\.parent\.postMessage\s*\(\s*'((?:[^'\\]|\\[\s\S])*)'/,
	);
	if (postMessage) {
		return JSON.parse(unescapeJsString(postMessage[1]));
	}

	// Fallback: plain JSON
	return JSON.parse(trimmed);
}

/**
 * Walk parsed data and collect every account entry, in document order.
 * Searching for the "gaia.l.a" marker is more robust than fixed positions
 * if Google nests the list differently.
 *
 * @param {*} data
 * @returns {Array<{index: number, email: string, name: string, photo: string}>}
 */
export function extractAccounts(data) {
	const accounts = [];
	const seen = new Set();

	function visit(node, depth) {
		if (!node || typeof node !== "object" || depth > MAX_TRAVERSAL_DEPTH) {
			return;
		}

		if (Array.isArray(node)) {
			if (node.length >= 5 && node[0] === "gaia.l.a") {
				const email = node[3];
				if (typeof email === "string" && email.includes("@")) {
					const id = email.toLowerCase();
					if (!seen.has(id)) {
						seen.add(id);
						accounts.push({
							index: accounts.length,
							email,
							name: node[2] || email.split("@")[0],
							photo:
								typeof node[4] === "string" && node[4].startsWith("http")
									? node[4]
									: "",
						});
					}
				}
			}
			for (const child of node) visit(child, depth + 1);
		} else {
			for (const child of Object.values(node)) visit(child, depth + 1);
		}
	}

	visit(data, 0);
	return accounts;
}

/**
 * Parse a ListAccounts response body into accounts.
 * Never throws: an unparseable response yields an empty list.
 *
 * @param {string} text
 * @returns {Array<{index: number, email: string, name: string, photo: string}>}
 */
export function parseAccounts(text) {
	try {
		return extractAccounts(parseListAccountsResponse(text));
	} catch {
		return [];
	}
}

/**
 * Merge freshly detected accounts with the stored list, keeping the labels
 * the user chose.
 *
 * Labels follow the account's email address, not its position. Google
 * numbers accounts by position, so signing out of account 0 shifts every
 * other account down one place; matching by index would hand "Work" to
 * whichever account moved into the old slot. Entries stored without an
 * email (added manually) can only be matched by index.
 *
 * @param {Array<{index: number, email: string, name: string, photo: string}>} detected
 * @param {Array<{index: number, email?: string, label?: string}>} [existing]
 * @returns {Array<{index: number, email: string, name: string, photo: string, label: string}>}
 */
export function mergeAccounts(detected, existing = []) {
	const labelByEmail = new Map();
	const manualByIndex = new Map();

	for (const account of existing) {
		if (account.email) {
			const id = account.email.toLowerCase();
			if (!labelByEmail.has(id)) labelByEmail.set(id, account);
		} else {
			manualByIndex.set(account.index, account);
		}
	}

	return detected.map((account) => {
		const previous =
			labelByEmail.get(account.email.toLowerCase()) ??
			manualByIndex.get(account.index);
		return {
			index: account.index,
			email: account.email,
			name: account.name,
			photo: account.photo,
			label: previous?.label || "",
		};
	});
}
