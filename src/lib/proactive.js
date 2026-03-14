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
 */
import { GOOGLE_DOMAINS, URL_PATTERNS } from './constants.js';

/**
 * Check if a URL already has an account identifier.
 * @param {string} url
 * @returns {boolean}
 */
function hasAccountParam(url) {
  return URL_PATTERNS.PATH_ACCOUNT.test(url) || URL_PATTERNS.QUERY_ACCOUNT.test(url);
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

  // Find matching domain entries (most specific pathPrefix wins)
  const matches = GOOGLE_DOMAINS.filter(
    (d) => d.host === host && d.type !== 'excluded'
  );

  if (matches.length === 0) return null;

  // For path-based domains, try to find the most specific pathPrefix match
  const pathMatches = matches.filter((d) => d.type === 'path');
  if (pathMatches.length > 0) {
    // Sort by pathPrefix length descending (most specific first)
    const sorted = pathMatches.sort(
      (a, b) => (b.pathPrefix || '').length - (a.pathPrefix || '').length
    );
    for (const entry of sorted) {
      if (!entry.pathPrefix || parsed.pathname.startsWith(entry.pathPrefix)) {
        return entry;
      }
    }
  }

  // Check query-based domains
  const queryMatch = matches.find((d) => d.type === 'query');
  if (queryMatch) return queryMatch;

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
 * @param {Object} siteOverrides
 * @returns {Promise<boolean>} True if a redirect was performed
 */
export async function handleProactiveRedirect(tabId, url, defaultAccount, siteOverrides) {
  // Skip if URL already has account info
  if (hasAccountParam(url)) {
    return false;
  }

  // Find matching domain
  const domain = findMatchingDomain(url);
  if (!domain) {
    return false;
  }

  // Determine which account to use (site override or global default)
  const accountNum = domain.host in siteOverrides
    ? siteOverrides[domain.host]
    : defaultAccount;

  // Build redirect URL
  const newUrl = buildProactiveUrl(url, domain, accountNum);
  if (!newUrl || newUrl === url) {
    return false;
  }

  // Perform redirect
  try {
    await chrome.tabs.update(tabId, { url: newUrl });
    console.log(`[G-Account Switcher] Proactive: ${url} → ${newUrl}`);
    return true;
  } catch (error) {
    console.error('[G-Account Switcher] Proactive redirect failed:', error);
    return false;
  }
}
