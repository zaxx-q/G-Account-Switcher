/**
 * Service worker — main background entry point.
 *
 * Responsibilities:
 * 1. On install/startup: load settings and apply declarativeNetRequest rules
 * 2. On storage change: regenerate rules and update badge
 * 3. In proactive mode: listen to tabs.onUpdated for bare Google URLs
 * 4. Handle messages from popup (detect accounts, etc.)
 * 5. Cookie-based automatic account list refresh
 * 6. Remove data older versions left in storage.sync on install/update
 *
 * MV3 lifecycle: this worker is unloaded after ~30s of inactivity and woken
 * by the next event. Listeners are registered synchronously at top level (so
 * the waking event is delivered), but they must not assume settings are
 * loaded yet: they `await settingsReady` first.
 */

import { detectAndMergeAccounts } from "./lib/accounts.js";
import { STORAGE_KEYS } from "./lib/constants.js";
import { isGoogleHost } from "./lib/domains.js";
import {
	applyForceSwitch,
	cleanupTab,
	clearSyncedState,
	handleProactiveRedirect,
	restoreTabSyncStates,
} from "./lib/proactive.js";
import { applyRules } from "./lib/rules.js";
import { getAllSettings, removeLegacySyncData } from "./lib/storage.js";

// Track current settings in memory for the tabs.onUpdated listener
let currentSettings = null;

// Resolves once the first read of storage has finished. If a storage change
// lands first, its (newer) value is kept.
const settingsReady = getAllSettings()
	.then((settings) => {
		currentSettings ??= settings;
	})
	.catch((error) => {
		console.error("[G-Account Switcher] Could not load settings:", error);
	});

// ========== COOKIE-BASED ACCOUNT CHANGE DETECTION ==========

// Cookie names that indicate Google account sign-in/sign-out events
const GOOGLE_AUTH_COOKIES = ["SID", "SSID", "HSID", "LSID", "ACCOUNT_CHOOSER"];

// Debounce timer — Google sets multiple cookies at once during sign-in/out
let cookieRefreshTimeout = null;

chrome.cookies.onChanged.addListener(({ cookie, removed }) => {
	// Only care about Google auth cookies
	if (!isGoogleHost(cookie.domain)) return;
	if (!GOOGLE_AUTH_COOKIES.includes(cookie.name)) return;

	// Debounce — wait for all cookie changes to settle
	if (cookieRefreshTimeout) clearTimeout(cookieRefreshTimeout);
	cookieRefreshTimeout = setTimeout(async () => {
		cookieRefreshTimeout = null;
		console.log(
			"[G-Account Switcher] Refreshing accounts due to auth cookie change",
		);
		try {
			// Never opens a tab: automatic refreshes use existing tabs only
			await detectAndMergeAccounts();
		} catch (error) {
			console.error("[G-Account Switcher] Account refresh failed:", error);
		}
		// Badge updates via storage.onChanged listener
	}, 2000);
});

// ========== INITIALIZATION ==========

/**
 * Load settings and apply rules + badge.
 */
async function initialize() {
	try {
		await settingsReady;
		if (!currentSettings) return;

		// Apply declarativeNetRequest rules
		await applyRules(
			currentSettings.defaultAccount,
			currentSettings.siteSettings,
			currentSettings.enabled,
			currentSettings.globalAccountEnabled,
		);

		// Update badge
		updateBadge(currentSettings);

		console.log("[G-Account Switcher] Initialized");
	} catch (error) {
		console.error("[G-Account Switcher] Init error:", error);
	}
}

/**
 * Update the action badge text and color.
 */
function updateBadge(settings) {
	if (!settings.enabled) {
		chrome.action.setBadgeText({ text: "OFF" });
		chrome.action.setBadgeBackgroundColor({ color: "#888888" });
		return;
	}

	if (settings.globalAccountEnabled) {
		chrome.action.setBadgeText({ text: settings.defaultAccount.toString() });
		chrome.action.setBadgeBackgroundColor({ color: "#1a73e8" });
	} else {
		// Per-site only mode — show number of configured sites
		const siteCount = Object.keys(settings.siteSettings || {}).length;
		chrome.action.setBadgeText({
			text: siteCount > 0 ? siteCount.toString() : "",
		});
		chrome.action.setBadgeBackgroundColor({ color: "#34a853" });
	}
}

/**
 * Handle storage changes — re-apply rules when relevant settings change.
 */
chrome.storage.onChanged.addListener(async (changes, areaName) => {
	if (areaName !== "local") return;

	const relevantKeys = [
		STORAGE_KEYS.ENABLED,
		STORAGE_KEYS.DEFAULT_ACCOUNT,
		STORAGE_KEYS.GLOBAL_ACCOUNT_ENABLED,
		STORAGE_KEYS.SITE_SETTINGS,
		STORAGE_KEYS.MODE,
	];

	const hasRelevantChange = relevantKeys.some((key) => key in changes);
	if (!hasRelevantChange && !(STORAGE_KEYS.ACCOUNTS in changes)) return;

	// Detect enabled transition (false → true) BEFORE updating currentSettings
	const wasJustEnabled =
		STORAGE_KEYS.ENABLED in changes &&
		changes[STORAGE_KEYS.ENABLED].newValue === true &&
		changes[STORAGE_KEYS.ENABLED].oldValue === false;

	// Reload all settings
	currentSettings = await getAllSettings();

	// Re-apply rules if a rule-relevant setting changed
	if (hasRelevantChange) {
		try {
			await applyRules(
				currentSettings.defaultAccount,
				currentSettings.siteSettings,
				currentSettings.enabled,
				currentSettings.globalAccountEnabled,
			);
		} catch (error) {
			console.error("[G-Account Switcher] Could not apply rules:", error);
		}
		updateBadge(currentSettings);
		// Clear global state tracker so that new target accounts are instantly resynced
		clearSyncedState();
		// Broadcast that rules have updated so popup can refresh tabs safely
		chrome.runtime.sendMessage({ type: "rulesUpdated" }).catch(() => {});
	}

	// When re-enabled in proactive mode, redirect the active tab immediately
	// so the user doesn't need to open a new tab for rules to take effect.
	if (wasJustEnabled && currentSettings.mode === "proactive") {
		try {
			const [activeTab] = await chrome.tabs.query({
				active: true,
				currentWindow: true,
			});
			if (activeTab?.id && activeTab?.url) {
				await handleProactiveRedirect(
					activeTab.id,
					activeTab.url,
					currentSettings.defaultAccount,
					currentSettings.siteSettings,
					currentSettings.globalAccountEnabled,
				);
			}
		} catch {
			/* best-effort — popup already refreshes the tab */
		}
	}
});

/**
 * Proactive mode: listen to tab navigations.
 */
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, _tab) => {
	// Only act on actual URL changes (new navigations, link clicks, pushState).
	// Ignore status-only updates (F5 reload, loading state changes) — those
	// should never cause a redirect since the user is already on the page.
	if (!changeInfo.url) return;
	const url = changeInfo.url;

	// A worker woken by this very event may not have loaded settings yet
	await settingsReady;
	if (!currentSettings) return;

	// Skip if disabled or not in proactive mode
	if (!currentSettings.enabled || currentSettings.mode !== "proactive") return;

	await handleProactiveRedirect(
		tabId,
		url,
		currentSettings.defaultAccount,
		currentSettings.siteSettings,
		currentSettings.globalAccountEnabled,
	);
});

/**
 * Clean up per-tab synced state when a tab is closed.
 */
chrome.tabs.onRemoved.addListener((tabId) => {
	cleanupTab(tabId);
});

/**
 * Handle messages from popup.
 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	if (message.type === "detectAccounts") {
		// User clicked Detect: opening a temporary tab is acceptable here
		detectAndMergeAccounts({ allowTabCreation: true })
			.then((accounts) => {
				sendResponse({ success: accounts !== null, accounts });
			})
			.catch((error) => {
				sendResponse({ success: false, error: error.message });
			});
		return true; // Keep the message channel open for async response
	}

	if (message.type === "getSettings") {
		getAllSettings()
			.then((settings) => sendResponse(settings))
			.catch((error) => sendResponse({ error: error.message }));
		return true;
	}

	if (message.type === "refreshTab") {
		if (message.tabId) {
			chrome.tabs
				.get(message.tabId)
				.then(async (tab) => {
					if (!tab.url) {
						chrome.tabs.reload(message.tabId).catch(() => {});
						return;
					}
					const settings = currentSettings || (await getAllSettings());
					const switched = await applyForceSwitch(
						message.tabId,
						tab.url,
						settings.defaultAccount,
						settings.siteSettings || {},
						settings.globalAccountEnabled || false,
					);
					if (!switched) {
						chrome.tabs.reload(message.tabId).catch(() => {});
					}
				})
				.catch(() => {});
		}
		sendResponse({ success: true });
		return false;
	}
});

/**
 * On install or update: clear legacy synced data, detect accounts, and initialize.
 */
chrome.runtime.onInstalled.addListener(async (details) => {
	// Versions before 3.3.0 kept their data in storage.sync; it is not carried
	// over, so remove it rather than leave e-mail addresses behind.
	try {
		await removeLegacySyncData();
	} catch (error) {
		console.error("[G-Account Switcher] Could not remove legacy data:", error);
	}
	// Detect accounts on install/update (fresh detection)
	await detectAndMergeAccounts();
	await initialize();

	// The per-tab tracker starts empty after an install or update. Mark the
	// Google tabs that are already open as synced so they are not redirected
	// (and lose their place) on their next navigation.
	if (details.reason === "install" || details.reason === "update") {
		const settings = await getAllSettings();
		if (settings.enabled && settings.mode === "proactive") {
			await restoreTabSyncStates(
				settings.defaultAccount,
				settings.siteSettings,
				settings.globalAccountEnabled,
			);
		}
	}
});

/**
 * On service worker start: initialize.
 */
initialize();
