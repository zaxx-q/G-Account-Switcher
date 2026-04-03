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
 * Anti-loop strategy: per-tab tracking.
 *   We record which account each tab+siteKey has been synced to.
 *   Once a tab is synced for a given siteKey, we never redirect it again
 *   unless the user explicitly switches accounts via the popup or settings
 *   change (which clears all synced state).
 *
 *   This replaces the old TTL-based cache which would expire and cause
 *   unwanted re-redirects (losing user progress).
 */
import { GOOGLE_DOMAINS, URL_PATTERNS, SITE_DISABLED, getSiteKey } from './constants.js';

/**
 * Per-tab sync tracker.
 * Maps "tabId:siteKey" → accountNum
 *
 * Once a redirect is performed (or the URL already has the correct account),
 * the entry persists until:
 *   - The user switches accounts via the popup (clearSyncedState())
 *   - The tab is closed (cleanupTab(tabId))
 *   - Settings change (clearSyncedState())
 */
const tabSyncedStates = new Map();

/**
 * Extract the account number from a URL, if present.
 * Pure function — no side effects.
 *
 * @param {string} url
 * @returns {number|null} The account number, or null if not present
 */
function extractAccountFromUrl(url) {
  const pathMatch = url.match(URL_PATTERNS.PATH_ACCOUNT);
  if (pathMatch) return parseInt(pathMatch[1], 10);

  const queryMatch = url.match(URL_PATTERNS.QUERY_ACCOUNT);
  if (queryMatch) return parseInt(queryMatch[1], 10);

  return null;
}

/**
 * Build the tracking key for a tab + site combination.
 * @param {number} tabId
 * @param {string} siteKey
 * @returns {string}
 */
function trackingKey(tabId, siteKey) {
  return `${tabId}:${siteKey}`;
}

/**
 * Check if a tab has already been synced to the target account for a site.
 * @param {number} tabId
 * @param {string} siteKey
 * @param {number} accountNum
 * @returns {boolean}
 */
function isTabSynced(tabId, siteKey, accountNum) {
  return tabSyncedStates.get(trackingKey(tabId, siteKey)) === accountNum;
}

/**
 * Record that a tab has been synced to an account for a site.
 * @param {number} tabId
 * @param {string} siteKey
 * @param {number} accountNum
 */
function recordTabSync(tabId, siteKey, accountNum) {
  tabSyncedStates.set(trackingKey(tabId, siteKey), accountNum);
}

/**
 * Find the matching domain config for a URL.
 * @param {string} url
 * @returns {Object|null} The matching domain entry from GOOGLE_DOMAINS, or null
 */
function findMatchingDomain(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const host = parsed.hostname;

  // Find matching domain entries
  const matches = GOOGLE_DOMAINS.filter(
    (d) => d.host === host && d.type !== 'excluded'
  );

  if (matches.length === 0) return null;

  // Priority 1: queryMatch entries (e.g., udm=50 for AI mode)
  const withQueryMatch = matches.filter((d) => {
    if (!d.queryMatch) return false;
    const pathOk = !d.pathPrefix || parsed.pathname.startsWith(d.pathPrefix);
    return pathOk && parsed.searchParams.get(d.queryMatch.key) === d.queryMatch.value;
  });
  if (withQueryMatch.length > 0) return withQueryMatch[0];

  // Priority 2: specific (non-empty) pathPrefix match across ALL types
  const specificMatches = matches
    .filter((d) => d.pathPrefix && !d.queryMatch && parsed.pathname.startsWith(d.pathPrefix))
    .sort((a, b) => (b.pathPrefix || '').length - (a.pathPrefix || '').length);
  if (specificMatches.length > 0) return specificMatches[0];

  // Priority 3: catchall entries (empty/no pathPrefix, no queryMatch)
  const catchall = matches.find((d) => !d.pathPrefix && !d.queryMatch);
  if (catchall) return catchall;

  return null;
}

/**
 * Build the redirected URL with account identifier added.
 *
 * For path-based: insert /u/X/ after the pathPrefix
 *   e.g., mail.google.com/mail/ → mail.google.com/mail/u/3/
 *
 * For query-based: append authuser=X to query string
 *   e.g., www.google.com/search?q=test → www.google.com/search?q=test&authuser=3
 *
 * @param {string} url - Original URL
 * @param {Object} domain - Matching domain config
 * @param {number} accountNum - Account index to use
 * @returns {string|null} New URL, or null if no change needed
 */
export function buildProactiveUrl(url, domain, accountNum) {
  try {
    const parsed = new URL(url);

    if (domain.type === 'path') {
      const prefix = domain.pathPrefix || '';
      const afterPrefix = parsed.pathname.substring(prefix.length);

      // Don't add /u/X/ if it's already there
      if (/^\/u\/\d+/.test(afterPrefix)) {
        return null;
      }

      // Insert /u/X/ after the prefix
      // e.g., /mail/ → /mail/u/3/
      // e.g., /mail/inbox → /mail/u/3/inbox
      let newPath;
      if (afterPrefix === '' || afterPrefix === '/') {
        newPath = `${prefix}/u/${accountNum}/`;
      } else {
        // afterPrefix starts with / (e.g., /inbox)
        newPath = `${prefix}/u/${accountNum}${afterPrefix}`;
      }

      parsed.pathname = newPath;
      return parsed.toString();
    }

    if (domain.type === 'query') {
      // Don't add authuser if already present
      if (parsed.searchParams.has('authuser')) {
        return null;
      }

      parsed.searchParams.set('authuser', accountNum.toString());
      return parsed.toString();
    }

    return null;
  } catch {
    return null;
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
export async function handleProactiveRedirect(tabId, url, defaultAccount, siteSettings, globalAccountEnabled) {
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }

  // Find matching domain config
  const domain = findMatchingDomain(url);
  if (!domain) {
    return false;
  }

  // Determine which account to use (site setting or global default)
  const key = getSiteKey(domain);
  const hasSiteSetting = key in siteSettings;
  const siteValue = hasSiteSetting ? siteSettings[key] : undefined;

  // If site setting is SITE_DISABLED, skip redirect entirely for this site
  if (siteValue === SITE_DISABLED) {
    return false;
  }

  // If no site setting and global is disabled, skip redirect
  if (!hasSiteSetting && !globalAccountEnabled) {
    return false;
  }

  const accountNum = hasSiteSetting ? siteValue : defaultAccount;

  // Extract account number currently in the URL (pure — no cache side effects)
  const urlAccount = extractAccountFromUrl(url);

  // ── URL already has an account identifier ──
  if (urlAccount !== null) {
    if (urlAccount === accountNum) {
      // Already on the correct account — record the sync so we don't
      // re-check on subsequent navigations within this tab+site
      recordTabSync(tabId, key, accountNum);
      return false;
    }

    // Wrong account in URL — but if this tab was already synced for this
    // site, the user must have manually switched accounts within the site
    // (e.g., Gmail's built-in account picker). Respect their choice.
    if (isTabSynced(tabId, key, accountNum)) {
      return false;
    }

    // First visit with wrong account — rewrite it to the target account
    try {
      const parsed = new URL(url);
      let newUrl = null;

      if (domain.type === 'path') {
        const prefix = domain.pathPrefix || '';
        const afterPrefix = parsed.pathname.substring(prefix.length);
        const newAfter = afterPrefix.replace(/^\/u\/\d+/, `/u/${accountNum}`);
        if (newAfter !== afterPrefix) {
          parsed.pathname = prefix + newAfter;
          newUrl = parsed.toString();
        }
      } else if (domain.type === 'query') {
        if (parsed.searchParams.get('authuser') !== accountNum.toString()) {
          parsed.searchParams.set('authuser', accountNum.toString());
          newUrl = parsed.toString();
        }
      }

      if (newUrl && newUrl !== url) {
        recordTabSync(tabId, key, accountNum);
        await chrome.tabs.update(tabId, { url: newUrl });
        console.log(`[G-Account Switcher] Proactive (account mismatch): ${url} → ${newUrl}`);
        return true;
      }
    } catch { /* invalid URL — skip */ }
    return false;
  }

  // ── URL has no account identifier (bare URL) ──

  // If this tab+site was already synced to the target account, skip.
  // This prevents re-redirects on sites that strip the param (YouTube, etc.)
  // as well as unnecessary redirects on reloads of any domain.
  if (isTabSynced(tabId, key, accountNum)) {
    return false;
  }

  // Build redirect URL (adds /u/X/ or authuser=X to bare URL)
  const newUrl = buildProactiveUrl(url, domain, accountNum);
  if (!newUrl || newUrl === url) {
    return false;
  }

  // Perform redirect
  try {
    recordTabSync(tabId, key, accountNum);
    await chrome.tabs.update(tabId, { url: newUrl });
    console.log(`[G-Account Switcher] Proactive: ${url} → ${newUrl}`);
    return true;
  } catch (error) {
    console.error('[G-Account Switcher] Proactive redirect failed:', error);
    return false;
  }
}

/**
 * Clear synced state so tabs will be re-synced on next navigation.
 *
 * Called when settings change (no args → clear everything) so that
 * the new account preferences take effect immediately.
 */
export function clearSyncedState() {
  tabSyncedStates.clear();
}

/**
 * Clean up all synced state entries for a specific tab.
 * Called when a tab is closed.
 * @param {number} tabId
 */
export function cleanupTab(tabId) {
  const prefix = `${tabId}:`;
  for (const key of tabSyncedStates.keys()) {
    if (key.startsWith(prefix)) {
      tabSyncedStates.delete(key);
    }
  }
}

/**
 * Force switch the URL for a tab, modifying an existing account parameter if present.
 * Used for manual user-initiated switches from the popup.
 */
export async function applyForceSwitch(tabId, url, targetAccount, siteSettings, globalAccountEnabled) {
  const domain = findMatchingDomain(url);
  if (!domain) return false;

  const key = getSiteKey(domain);
  const hasSiteSetting = key in siteSettings;
  const siteValue = hasSiteSetting ? siteSettings[key] : undefined;
  if (siteValue === SITE_DISABLED) return false;

  // If no site setting and global is disabled, skip
  if (!hasSiteSetting && !globalAccountEnabled) return false;

  const accountNum = hasSiteSetting ? siteValue : targetAccount;

  try {
    const parsed = new URL(url);
    let changed = false;

    if (domain.type === 'path') {
      const prefix = domain.pathPrefix || '';
      let afterPrefix = parsed.pathname.substring(prefix.length);

      if (/^\/u\/\d+/.test(afterPrefix)) {
        const newAfter = afterPrefix.replace(/^\/u\/\d+/, `/u/${accountNum}`);
        if (newAfter !== afterPrefix) {
          parsed.pathname = prefix + newAfter;
          changed = true;
        }
      } else {
        // Fallback to building proactive url if missing
        let newPath;
        if (afterPrefix === '' || afterPrefix === '/') {
          newPath = `${prefix}/u/${accountNum}/`;
        } else {
          newPath = `${prefix}/u/${accountNum}${afterPrefix}`;
        }
        parsed.pathname = newPath;
        changed = true;
      }
    } else if (domain.type === 'query') {
      if (parsed.searchParams.get('authuser') !== accountNum.toString()) {
        parsed.searchParams.set('authuser', accountNum.toString());
        changed = true;
      }
    }

    if (changed) {
      recordTabSync(tabId, key, accountNum);
      await chrome.tabs.update(tabId, { url: parsed.toString() });
      console.log(`[G-Account Switcher] Force Switch: ${url} → ${parsed.toString()}`);
      return true;
    }
  } catch { }

  return false;
}
