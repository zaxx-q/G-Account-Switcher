/**
 * Service worker — main background entry point.
 *
 * Responsibilities:
 * 1. On install/startup: load settings and apply declarativeNetRequest rules
 * 2. On storage change: regenerate rules and update badge
 * 3. In proactive mode: listen to tabs.onUpdated for bare Google URLs
 * 4. Handle messages from popup (detect accounts, etc.)
 */
import { STORAGE_KEYS } from './lib/constants.js';
import { getAllSettings } from './lib/storage.js';
import { applyRules } from './lib/rules.js';
import { handleProactiveRedirect } from './lib/proactive.js';
import { detectAndMergeAccounts } from './lib/accounts.js';

// Track current settings in memory for the tabs.onUpdated listener
let currentSettings = null;
// Track tabs we've already redirected to avoid loops.
// Map<tabId, { host: string, expiry: number }>
// Uses a domain-aware cooldown: skips repeated onUpdated events for the
// same host within the cooldown window.  This prevents infinite loops on
// domains like YouTube that process authuser=X, strip the param, and
// refresh — which would otherwise look like a "bare" URL again.
const redirectedTabs = new Map();
const REDIRECT_COOLDOWN_MS = 10_000; // 10 seconds

/**
 * Load settings and apply rules + badge.
 */
async function initialize() {
  try {
    currentSettings = await getAllSettings();

    // Apply declarativeNetRequest rules
    await applyRules(
      currentSettings.defaultAccount,
      currentSettings.siteOverrides,
      currentSettings.enabled
    );

    // Update badge
    updateBadge(currentSettings);

    console.log('[G-Account Switcher] Initialized', currentSettings);
  } catch (error) {
    console.error('[G-Account Switcher] Init error:', error);
  }
}

/**
 * Update the action badge text and color.
 */
function updateBadge(settings) {
  if (!settings.enabled) {
    chrome.action.setBadgeText({ text: 'OFF' });
    chrome.action.setBadgeBackgroundColor({ color: '#888888' });
    return;
  }

  chrome.action.setBadgeText({ text: settings.defaultAccount.toString() });
  chrome.action.setBadgeBackgroundColor({ color: '#1a73e8' });
}

/**
 * Handle storage changes — re-apply rules when relevant settings change.
 */
chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName !== 'sync') return;

  const relevantKeys = [
    STORAGE_KEYS.ENABLED,
    STORAGE_KEYS.DEFAULT_ACCOUNT,
    STORAGE_KEYS.SITE_OVERRIDES,
    STORAGE_KEYS.MODE,
  ];

  const hasRelevantChange = relevantKeys.some((key) => key in changes);
  if (!hasRelevantChange && !(STORAGE_KEYS.ACCOUNTS in changes)) return;

  // Reload all settings
  currentSettings = await getAllSettings();

  // Re-apply rules if a rule-relevant setting changed
  if (hasRelevantChange) {
    await applyRules(
      currentSettings.defaultAccount,
      currentSettings.siteOverrides,
      currentSettings.enabled
    );
    updateBadge(currentSettings);
  }
});

/**
 * Proactive mode: listen to tab navigations.
 */
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Only act on URL changes (not title changes, loading states, etc.)
  if (!changeInfo.url) return;

  // Wait for settings to be loaded
  if (!currentSettings) return;

  // Skip if disabled or not in proactive mode
  if (!currentSettings.enabled || currentSettings.mode !== 'proactive') return;

  // Avoid redirect loops: if we recently redirected this tab for the same
  // host, skip.  This handles domains like YouTube that process authuser,
  // strip it from the URL, and refresh — causing a second onUpdated with
  // a "bare" URL that would otherwise trigger another redirect.
  if (redirectedTabs.has(tabId)) {
    const entry = redirectedTabs.get(tabId);
    try {
      const currentHost = new URL(changeInfo.url).hostname;
      if (currentHost === entry.host && Date.now() < entry.expiry) {
        // Same domain, still in cooldown — skip silently
        return;
      }
    } catch { /* invalid URL — fall through to normal handling */ }
    // Different domain or cooldown expired — clear and proceed
    redirectedTabs.delete(tabId);
  }

  const redirected = await handleProactiveRedirect(
    tabId,
    changeInfo.url,
    currentSettings.defaultAccount,
    currentSettings.siteOverrides
  );

  if (redirected) {
    // Record the host and cooldown expiry so we can suppress loop-causing
    // re-fires from the same domain.
    try {
      const host = new URL(changeInfo.url).hostname;
      redirectedTabs.set(tabId, {
        host,
        expiry: Date.now() + REDIRECT_COOLDOWN_MS,
      });
    } catch { /* best-effort */ }
    // Safety net: auto-clear after cooldown even if no new event arrives
    setTimeout(() => redirectedTabs.delete(tabId), REDIRECT_COOLDOWN_MS);
  }
});

// Clean up redirectedTabs when tabs are closed
chrome.tabs.onRemoved.addListener((tabId) => {
  redirectedTabs.delete(tabId);
});

/**
 * Handle messages from popup.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'detectAccounts') {
    detectAndMergeAccounts()
      .then((accounts) => {
        sendResponse({ success: accounts !== null, accounts });
      })
      .catch((error) => {
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep the message channel open for async response
  }

  if (message.type === 'getSettings') {
    getAllSettings()
      .then((settings) => sendResponse(settings))
      .catch((error) => sendResponse({ error: error.message }));
    return true;
  }
});

/**
 * On install or update: initialize.
 */
chrome.runtime.onInstalled.addListener(() => {
  initialize();
});

/**
 * On service worker start: initialize.
 */
initialize();
