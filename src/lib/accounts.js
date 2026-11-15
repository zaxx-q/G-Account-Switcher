/**
 * Account detection via Google's ListAccounts endpoint.
 *
 * IMPORTANT: The fetch must run inside a Google web page (via
 * chrome.scripting.executeScript) because the service worker's fetch()
 * does NOT send the browser's first-party cookies for accounts.google.com.
 * Content scripts share the host page's cookie jar, so a fetch injected
 * into any *.google.com tab will include the auth cookies (SID, HSID, etc.)
 * that the ListAccounts endpoint requires.
 *
 * The injected function only fetches and returns the raw text. All parsing
 * happens here in the background (see parse-accounts.js), where it can be
 * tested without a browser.
 *
 * PERFORMANCE: We try to reuse an existing Google/YouTube tab first.
 * Only when the user explicitly asks (the popup's Detect button) and no
 * such tab exists do we open a temporary background tab. Automatic
 * refreshes (install, cookie changes) never open tabs; they fall back to
 * the cached accounts instead.
 */
import { LIST_ACCOUNTS_URL } from "./constants.js";
import { mergeAccounts, parseAccounts } from "./parse-accounts.js";
import { getStorage, setStorage } from "./storage.js";

const DETECTION_CONFIG = {
	TAB_LOAD_TIMEOUT: 5000, // Max time to wait for tab load (ms)
	SCRIPT_EXEC_TIMEOUT: 10000, // Max time for script execution (ms)
};

/**
 * Wait for a tab to finish loading.
 * @param {number} tabId
 * @param {number} timeoutMs
 * @returns {Promise<void>}
 */
function waitForTabLoad(tabId, timeoutMs = DETECTION_CONFIG.TAB_LOAD_TIMEOUT) {
	return new Promise((resolve) => {
		const timer = setTimeout(() => {
			chrome.tabs.onUpdated.removeListener(listener);
			resolve(); // Resolve anyway on timeout — tab may already be usable
		}, timeoutMs);

		function listener(updatedTabId, changeInfo) {
			if (updatedTabId === tabId && changeInfo.status === "complete") {
				clearTimeout(timer);
				chrome.tabs.onUpdated.removeListener(listener);
				setTimeout(resolve, 200); // Brief delay for page scripts to initialize
			}
		}

		chrome.tabs.onUpdated.addListener(listener);
	});
}

/**
 * The function injected into a web page to fetch the account list.
 * Must be self-contained (no closures over external variables).
 */
async function fetchListAccountsInPage(url) {
	try {
		const response = await fetch(url, { credentials: "include" });
		if (!response.ok) return { error: `HTTP ${response.status}` };
		return { text: await response.text() };
	} catch (e) {
		return { error: e.message };
	}
}

async function getCachedAccounts() {
	const cached = await getStorage("accounts");
	return cached.accounts || [];
}

/**
 * Fetch logged-in Google accounts from the ListAccounts endpoint.
 *
 * Strategy:
 *   1. Find an existing, fully loaded Google/YouTube tab
 *   2. Inject the fetch into it (fast, invisible)
 *   3. No such tab: with `allowTabCreation`, open a temporary background tab
 *      on accounts.google.com; otherwise return the cached accounts
 *
 * @param {Object} [options]
 * @param {boolean} [options.allowTabCreation=false] - Only set this for
 *   user-initiated detection. Automatic refreshes must not open tabs.
 * @returns {Promise<Array<{index: number, email: string, name: string, photo: string}>>}
 */
export async function detectAccounts({ allowTabCreation = false } = {}) {
	let createdTabId = null;

	try {
		// 1. Look for an existing Google/YouTube tab
		let tabs = await chrome.tabs.query({
			url: ["*://*.google.com/*", "*://*.youtube.com/*"],
		});

		// Filter to usable tabs: fully loaded, not on login flows, not discarded
		tabs = tabs.filter(
			(t) =>
				t.status === "complete" &&
				!t.url.includes("/AddSession") &&
				!t.url.includes("accounts.google.com/signin") &&
				!t.discarded,
		);

		let targetTab = tabs.find((t) => t.active) || tabs[0];

		// 2. No suitable tab
		if (!targetTab) {
			if (!allowTabCreation) {
				// Return cached accounts rather than creating a disruptive tab
				return await getCachedAccounts();
			}

			const newTab = await chrome.tabs.create({
				url: "https://accounts.google.com/",
				active: false,
			});
			createdTabId = newTab.id;
			await waitForTabLoad(newTab.id);
			targetTab = await chrome.tabs.get(newTab.id);
		}

		// 3. Execute the fetch with a timeout
		let timeoutId;
		const timeout = new Promise((_, reject) => {
			timeoutId = setTimeout(
				() => reject(new Error("Script execution timeout")),
				DETECTION_CONFIG.SCRIPT_EXEC_TIMEOUT,
			);
		});
		let results;
		try {
			results = await Promise.race([
				chrome.scripting.executeScript({
					target: { tabId: targetTab.id, frameIds: [0] },
					func: fetchListAccountsInPage,
					args: [LIST_ACCOUNTS_URL],
				}),
				timeout,
			]);
		} finally {
			clearTimeout(timeoutId);
		}

		// 4. Parse the response
		const result = results?.[0]?.result;

		if (result?.error) {
			console.warn(
				"[G-Account Switcher] In-page detection error:",
				result.error,
			);
		}
		if (result?.text) {
			return parseAccounts(result.text);
		}
		return [];
	} catch (error) {
		console.error("[G-Account Switcher] Failed to detect accounts:", error);
		// Return cached accounts on error
		return await getCachedAccounts();
	} finally {
		// Always close the temporary tab, whichever way we got here
		if (createdTabId !== null) {
			try {
				await chrome.tabs.remove(createdTabId);
			} catch {
				/* already closed */
			}
		}
	}
}

/**
 * Detect accounts and merge with existing stored accounts (preserving labels).
 *
 * @param {Object} [options]
 * @param {boolean} [options.allowTabCreation=false] - See detectAccounts()
 * @returns {Promise<Array|null>} Updated accounts list, or null if detection failed
 */
export async function detectAndMergeAccounts(options) {
	const detected = await detectAccounts(options);
	if (detected.length === 0) {
		return null; // Signal that detection failed
	}

	const { accounts: existing = [] } = await getStorage("accounts");
	const merged = mergeAccounts(detected, existing);

	await setStorage({ accounts: merged });
	return merged;
}
