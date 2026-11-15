/**
 * Proactive mode handler.
 *
 * When proactive mode is enabled, this module detects bare Google URLs
 * (without /u/X/ or authuser=X) and redirects them to include the
 * selected account identifier.
 *
 * Since declarativeNetRequest RE2 doesn't support negative lookahead,
 * we handle this via chrome.tabs.onUpdated after page navigation begins.
 * This causes a brief redirect but only for bare URLs.
 *
 * Anti-loop strategy: per-tab tracking (see tab-state.js).
 *   We record which account each tab+siteKey has been synced to.
 *   Once a tab is synced for a given siteKey, we never redirect it again
 *   unless the user explicitly switches accounts via the popup or settings
 *   change (which clears all synced state).
 */
import { buildAccountUrl, extractAccount } from "./account-url.js";
import { getSiteKey, SITE_DISABLED } from "./constants.js";
import { findMatchingDomain } from "./domains.js";
import {
	cleanupTabState,
	clearTabState,
	forgetTabSync,
	isTabSynced,
	loadTabState,
	recordTabSync,
} from "./tab-state.js";

/**
 * Work out which account applies to a domain entry.
 *
 * @param {Object} domain - A GOOGLE_DOMAINS entry
 * @param {Object} siteSettings
 * @param {number} defaultAccount
 * @param {boolean} globalAccountEnabled
 * @returns {{key: string, accountNum: number}|null} null when redirection
 *   is disabled for the site, or when nothing is configured for it
 */
export function resolveTargetAccount(
	domain,
	siteSettings,
	defaultAccount,
	globalAccountEnabled,
) {
	const settings = siteSettings || {};
	const key = getSiteKey(domain);
	const hasSiteSetting = key in settings;

	if (hasSiteSetting && settings[key] === SITE_DISABLED) return null;
	if (!hasSiteSetting && !globalAccountEnabled) return null;

	return { key, accountNum: hasSiteSetting ? settings[key] : defaultAccount };
}

/**
 * Navigate a tab to `newUrl`, recording the sync first so the navigation
 * we are about to cause is not itself treated as a first visit.
 *
 * @returns {Promise<boolean>} True if the tab was navigated
 */
async function redirectTab(tabId, key, accountNum, url, newUrl, label) {
	recordTabSync(tabId, key, accountNum);
	try {
		await chrome.tabs.update(tabId, { url: newUrl });
		console.log(`[G-Account Switcher] ${label}: ${url} → ${newUrl}`);
		return true;
	} catch (error) {
		// e.g. the tab was closed in the meantime
		forgetTabSync(tabId, key);
		console.error(`[G-Account Switcher] ${label} failed:`, error);
		return false;
	}
}

/**
 * Handle a tab update event for proactive mode.
 *
 * @param {number} tabId
 * @param {string} url
 * @param {number} defaultAccount
 * @param {Object} siteSettings
 * @param {boolean} globalAccountEnabled - Whether the global default is active
 * @returns {Promise<boolean>} True if a redirect was performed
 */
export async function handleProactiveRedirect(
	tabId,
	url,
	defaultAccount,
	siteSettings,
	globalAccountEnabled,
) {
	const domain = findMatchingDomain(url);
	if (!domain) return false;

	const target = resolveTargetAccount(
		domain,
		siteSettings,
		defaultAccount,
		globalAccountEnabled,
	);
	if (!target) return false;
	const { key, accountNum } = target;

	await loadTabState();

	// Already on the right account: remember it so later navigations in this
	// tab (which may strip the parameter) are left alone.
	if (extractAccount(url, domain) === accountNum) {
		recordTabSync(tabId, key, accountNum);
		return false;
	}

	// Already synced once for this site. Covers both services that strip the
	// parameter after loading (YouTube, ...) and reloads of any domain.
	if (isTabSynced(tabId, key, accountNum)) return false;

	const newUrl = buildAccountUrl(url, domain, accountNum);
	if (!newUrl || newUrl === url) return false;

	return redirectTab(tabId, key, accountNum, url, newUrl, "Proactive");
}

/**
 * Mark every already-open Google tab as synced to its configured account.
 *
 * Called once when the extension is installed or updated. At that point the
 * session-storage tracker is empty, so without this step every open tab
 * would count as a "first visit" and be redirected on its next navigation,
 * losing the user's place in YouTube, Docs and similar.
 *
 * It is deliberately NOT called on ordinary service-worker restarts: the
 * tracker is persisted in storage.session, and re-scanning then would mark
 * a tab that has just navigated to a bare URL as already synced.
 *
 * @param {number} defaultAccount
 * @param {Object} siteSettings
 * @param {boolean} globalAccountEnabled
 */
export async function restoreTabSyncStates(
	defaultAccount,
	siteSettings,
	globalAccountEnabled,
) {
	try {
		await loadTabState();
		const tabs = await chrome.tabs.query({});
		let restored = 0;

		for (const tab of tabs) {
			if (!tab.url || !tab.id) continue;

			const domain = findMatchingDomain(tab.url);
			if (!domain) continue;

			const target = resolveTargetAccount(
				domain,
				siteSettings,
				defaultAccount,
				globalAccountEnabled,
			);
			if (!target) continue;

			recordTabSync(tab.id, target.key, target.accountNum);
			restored++;
		}

		if (restored > 0) {
			console.log(
				`[G-Account Switcher] Marked ${restored} open tab(s) as already synced`,
			);
		}
	} catch (error) {
		console.error(
			"[G-Account Switcher] Failed to restore tab sync states:",
			error,
		);
	}
}

/**
 * Clear synced state so tabs will be re-synced on next navigation.
 * Called when settings change so new account preferences apply immediately.
 */
export function clearSyncedState() {
	clearTabState();
}

/**
 * Clean up all synced state entries for a specific tab.
 * Called when a tab is closed.
 * @param {number} tabId
 */
export function cleanupTab(tabId) {
	return cleanupTabState(tabId);
}

/**
 * Force switch the URL for a tab, modifying an existing account parameter if present.
 * Used for manual user-initiated switches from the popup.
 *
 * @returns {Promise<boolean>} True if the tab was navigated
 */
export async function applyForceSwitch(
	tabId,
	url,
	targetAccount,
	siteSettings,
	globalAccountEnabled,
) {
	const domain = findMatchingDomain(url);
	if (!domain) return false;

	const target = resolveTargetAccount(
		domain,
		siteSettings,
		targetAccount,
		globalAccountEnabled,
	);
	if (!target) return false;

	await loadTabState();

	const newUrl = buildAccountUrl(url, domain, target.accountNum, {
		force: true,
	});
	if (!newUrl || newUrl === url) return false;

	return redirectTab(
		tabId,
		target.key,
		target.accountNum,
		url,
		newUrl,
		"Force Switch",
	);
}
