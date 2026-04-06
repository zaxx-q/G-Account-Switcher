/**
 * Service worker — main background entry point.
 *
 * Responsibilities:
 * 1. On install/startup: load settings and apply declarativeNetRequest rules
 * 2. On storage change: regenerate rules and update badge
 * 3. In proactive mode: listen to tabs.onUpdated for bare Google URLs
 * 4. Handle messages from popup (detect accounts, etc.)
 * 5. Cookie-based automatic account list refresh
 * 6. Migrate legacy storage keys on install/update
 */
import { STORAGE_KEYS } from './lib/constants.js';
import { getAllSettings, setStorage, getStorage } from './lib/storage.js';
import { applyRules } from './lib/rules.js';
import { handleProactiveRedirect, applyForceSwitch, clearSyncedState, cleanupTab, restoreTabSyncStates } from './lib/proactive.js';
import { detectAndMergeAccounts } from './lib/accounts.js';

// Track current settings in memory for the tabs.onUpdated listener
let currentSettings = null;

// ========== COOKIE-BASED ACCOUNT CHANGE DETECTION ==========

// Cookie names that indicate Google account sign-in/sign-out events
const GOOGLE_AUTH_COOKIES = ['SID', 'SSID', 'HSID', 'LSID', 'ACCOUNT_CHOOSER'];

// Debounce timer — Google sets multiple cookies at once during sign-in/out
let cookieRefreshTimeout = null;

chrome.cookies.onChanged.addListener(({ cookie, removed }) => {
  // Only care about Google auth cookies
  if (!cookie.domain.includes('google.com')) return;
  if (!GOOGLE_AUTH_COOKIES.includes(cookie.name)) return;

  // Debounce — wait for all cookie changes to settle
  if (cookieRefreshTimeout) clearTimeout(cookieRefreshTimeout);
  cookieRefreshTimeout = setTimeout(async () => {
    cookieRefreshTimeout = null;
    console.log('[G-Account Switcher] Refreshing accounts due to auth cookie change');
    await detectAndMergeAccounts();
    // Badge updates via storage.onChanged listener
  }, 2000);
});

// ========== MIGRATION ==========

/**
 * Migrate legacy storage keys from v2 (siteOverrides) to v3 (siteSettings).
 * Also sets globalAccountEnabled for existing users so behavior doesn't change.
 */
async function migrateStorage() {
  const data = await chrome.storage.sync.get(null);

  const updates = {};
  let needsUpdate = false;

  // Migrate siteOverrides → siteSettings
  if (data.siteOverrides && !data.siteSettings) {
    updates.siteSettings = data.siteOverrides;
    needsUpdate = true;
  }

  // Existing users who had a defaultAccount set: enable global for them
  // so their behavior doesn't change after the update
  if (data.defaultAccount !== undefined && data.globalAccountEnabled === undefined) {
    updates.globalAccountEnabled = true;
    needsUpdate = true;
  }

  if (needsUpdate) {
    await chrome.storage.sync.set(updates);
    // Clean up legacy key
    if (data.siteOverrides) {
      await chrome.storage.sync.remove('siteOverrides');
    }
    console.log('[G-Account Switcher] Migrated storage:', Object.keys(updates));
  }
}

// ========== INITIALIZATION ==========

/**
 * Load settings and apply rules + badge.
 */
async function initialize() {
  try {
    currentSettings = await getAllSettings();

    // Apply declarativeNetRequest rules
    await applyRules(
      currentSettings.defaultAccount,
      currentSettings.siteSettings,
      currentSettings.enabled,
      currentSettings.globalAccountEnabled
    );

    // Update badge
    updateBadge(currentSettings);

    // Restore per-tab sync state for existing tabs.
    // MV3 service workers are killed after ~30s of inactivity, wiping
    // the in-memory tabSyncedStates Map. Without this restore step,
    // the next tab event would think every tab is a "first visit" and
    // redirect it — causing the user to lose progress.
    if (currentSettings.enabled && currentSettings.mode === 'proactive') {
      await restoreTabSyncStates(
        currentSettings.defaultAccount,
        currentSettings.siteSettings,
        currentSettings.globalAccountEnabled
      );
    }

    console.log('[G-Account Switcher] Initialized');
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

  if (settings.globalAccountEnabled) {
    chrome.action.setBadgeText({ text: settings.defaultAccount.toString() });
    chrome.action.setBadgeBackgroundColor({ color: '#1a73e8' });
  } else {
    // Per-site only mode — show number of configured sites
    const siteCount = Object.keys(settings.siteSettings || {}).length;
    chrome.action.setBadgeText({ text: siteCount > 0 ? siteCount.toString() : '' });
    chrome.action.setBadgeBackgroundColor({ color: '#34a853' });
  }
}

/**
 * Handle storage changes — re-apply rules when relevant settings change.
 */
chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName !== 'sync') return;

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
    await applyRules(
      currentSettings.defaultAccount,
      currentSettings.siteSettings,
      currentSettings.enabled,
      currentSettings.globalAccountEnabled
    );
    updateBadge(currentSettings);
    // Clear global state tracker so that new target accounts are instantly resynced
    clearSyncedState();
    // Broadcast that rules have updated so popup can refresh tabs safely
    chrome.runtime.sendMessage({ type: 'rulesUpdated' }).catch(() => {});
  }

  // When re-enabled in proactive mode, redirect the active tab immediately
  // so the user doesn't need to open a new tab for rules to take effect.
  if (wasJustEnabled && currentSettings.mode === 'proactive') {
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab?.id && activeTab?.url) {
        const redirected = await handleProactiveRedirect(
          activeTab.id,
          activeTab.url,
          currentSettings.defaultAccount,
          currentSettings.siteSettings,
          currentSettings.globalAccountEnabled
        );
      }
    } catch { /* best-effort — popup already refreshes the tab */ }
  }
});

/**
 * Proactive mode: listen to tab navigations.
 */
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Only act on actual URL changes (new navigations, link clicks, pushState).
  // Ignore status-only updates (F5 reload, loading state changes) — those
  // should never cause a redirect since the user is already on the page.
  if (!changeInfo.url) return;
  const url = changeInfo.url;

  // TEST HOOK: Change default account via URL parameter for automation
  if (url.includes('TEST_SWITCH_ACCOUNT=')) {
    const match = url.match(/TEST_SWITCH_ACCOUNT=(\d+)/);
    if (match) {
      const newAcc = parseInt(match[1], 10);
      if (currentSettings) {
        currentSettings.defaultAccount = newAcc;
      }
      chrome.storage.sync.set({ defaultAccount: newAcc });
      console.log(`[TEST HOOK] Switched account to ${newAcc}`);
    }
  }

  // Wait for settings to be loaded
  if (!currentSettings) return;

  // Skip if disabled or not in proactive mode
  if (!currentSettings.enabled || currentSettings.mode !== 'proactive') return;

  await handleProactiveRedirect(
    tabId,
    url,
    currentSettings.defaultAccount,
    currentSettings.siteSettings,
    currentSettings.globalAccountEnabled
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

  if (message.type === 'refreshTab') {
    if (message.tabId) {
      chrome.tabs.get(message.tabId).then(async (tab) => {
        if (!tab.url) {
          chrome.tabs.reload(message.tabId).catch(() => {});
          return;
        }
        const settings = currentSettings || await getAllSettings();
        const switched = await applyForceSwitch(
          message.tabId,
          tab.url,
          settings.defaultAccount,
          settings.siteSettings || {},
          settings.globalAccountEnabled || false
        );
        if (!switched) {
          chrome.tabs.reload(message.tabId).catch(() => {});
        }
      }).catch(() => {});
    }
    sendResponse({ success: true });
    return false;
  }
});

/**
 * On install or update: migrate storage, detect accounts, and initialize.
 */
chrome.runtime.onInstalled.addListener(async () => {
  // Migrate legacy storage keys first
  await migrateStorage();
  // Detect accounts on install/update (fresh detection)
  await detectAndMergeAccounts();
  await initialize();
});

/**
 * On service worker start: initialize.
 */
initialize();
