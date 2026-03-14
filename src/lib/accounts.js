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
 * PERFORMANCE: We try to reuse an existing Google/YouTube tab first.
 * Only as a fallback do we create a temporary tab on accounts.google.com.
 * If no tabs and AVOID_TAB_CREATION is true, we return cached accounts.
 *
 * The endpoint returns a JSON-like array structure with account info:
 *   [
 *     "gaia.l.a.r",
 *     [
 *       [
 *         "gaia.l.a",
 *         1,                    // unknown
 *         "Display Name",       // index 2
 *         "email@gmail.com",    // index 3
 *         "Photo URL",          // index 4
 *         ...
 *       ],
 *       ...
 *     ]
 *   ]
 */
import { LIST_ACCOUNTS_URL } from './constants.js';
import { getStorage, setStorage } from './storage.js';

const DETECTION_CONFIG = {
  TAB_LOAD_TIMEOUT: 5000,       // Max time to wait for tab load (ms)
  SCRIPT_EXEC_TIMEOUT: 10000,   // Max time for script execution (ms)
  AVOID_TAB_CREATION: true,     // Prefer cached accounts over creating tabs
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
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        setTimeout(resolve, 200); // Brief delay for page scripts to initialize
      }
    }

    chrome.tabs.onUpdated.addListener(listener);
  });
}

/**
 * Parse the ListAccounts response which can come in two formats:
 *
 * Format A (raw JSON with XSSI prefix):
 *   )]}'\n["gaia.l.a.r",[...]]
 *
 * Format B (HTML with postMessage wrapper):
 *   <!DOCTYPE html><html><body><script>
 *   window.parent.postMessage('\x5b\x22gaia.l.a.r\x22,...\x5d', '*');
 *   </script></body></html>
 *
 * @param {string} text - Raw response text
 * @returns {Array} Parsed JSON data
 */
function parseListAccountsResponse(text) {
  const trimmed = text.trim();

  // Format A: starts with )]}' — strip XSSI prefix and parse
  if (trimmed.startsWith(")]}'")) {
    const cleaned = trimmed.replace(/^\)\]\}'[\r\n]*/, '').trim();
    return JSON.parse(cleaned);
  }

  // Format B: HTML wrapper with postMessage
  // Extract the string argument from: window.parent.postMessage('...', '*')
  const postMessageMatch = trimmed.match(/window\.parent\.postMessage\('((?:[^'\\]|\\.)*)'/);
  if (postMessageMatch) {
    // Unescape \xNN hex sequences and other JS escape sequences
    const escaped = postMessageMatch[1];
    const unescaped = escaped.replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    ).replace(/\\'/g, "'").replace(/\\\\/g, '\\').replace(/\\n/g, '\n');

    return JSON.parse(unescaped);
  }

  // Fallback: try parsing as raw JSON
  return JSON.parse(trimmed);
}

/**
 * The function to inject into a web page for fetching accounts.
 * Must be self-contained (no closures over external variables).
 *
 * Uses a recursive traversal to find account entries with 'gaia.l.a' marker,
 * which is more robust than fixed-index parsing.
 */
function fetchAccountsInPageContext(url) {
  return (async () => {
    try {
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) return { error: `HTTP ${response.status}` };

      let text = await response.text();
      let jsonString = text;

      if (text.trim().startsWith('<!DOCTYPE') || text.trim().startsWith('<')) {
        const match = text.match(/window\.parent\.postMessage\s*\(\s*'([^']+)'/);
        if (match) {
          jsonString = match[1].replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) =>
            String.fromCharCode(parseInt(hex, 16))
          );
        } else {
          return { text };  // Return raw for parent to parse
        }
      } else {
        jsonString = text.replace(/^\)\]\}'\s*/, '');
      }

      const data = JSON.parse(jsonString);
      const accounts = [];
      const seen = new Set();

      function traverse(obj, depth) {
        if (!obj || depth > 15) return;
        if (Array.isArray(obj)) {
          if (obj.length >= 5 && obj[0] === 'gaia.l.a') {
            const email = obj[3];
            if (email && typeof email === 'string' && email.includes('@') && !seen.has(email)) {
              seen.add(email);
              accounts.push({
                index: accounts.length,
                email,
                name: obj[2] || email.split('@')[0],
                photo: (typeof obj[4] === 'string' && obj[4].startsWith('http')) ? obj[4] : '',
              });
            }
          }
          obj.forEach(item => traverse(item, depth + 1));
        } else if (typeof obj === 'object') {
          Object.values(obj).forEach(item => traverse(item, depth + 1));
        }
      }

      traverse(data, 0);
      accounts.forEach((acc, i) => { acc.index = i; });
      return { accounts };
    } catch (e) {
      return { error: e.message };
    }
  })();
}

/**
 * Fetch logged-in Google accounts from ListAccounts API.
 *
 * Strategy (v2 — performance optimized):
 *   1. Try to find an existing Google/YouTube tab that's fully loaded
 *   2. Inject the fetch script into that tab (fast — no tab creation)
 *   3. If no suitable tab exists and AVOID_TAB_CREATION is true, return cached accounts
 *   4. Fallback: create a temporary background tab on accounts.google.com
 *
 * @returns {Promise<Array<{index: number, email: string, name: string, photo: string}>>}
 */
export async function detectAccounts() {
  let createdTabId = null;

  try {
    // 1. Look for an existing Google/YouTube tab
    let tabs = await chrome.tabs.query({
      url: ['*://*.google.com/*', '*://*.youtube.com/*'],
    });

    // Filter to usable tabs: fully loaded, not on login flows, not discarded
    tabs = tabs.filter(t =>
      t.status === 'complete' &&
      !t.url.includes('/AddSession') &&
      !t.url.includes('accounts.google.com/signin') &&
      !t.discarded
    );

    let targetTab = tabs.find(t => t.active) || tabs[0];

    // 2. If no suitable tab, check preferences
    if (!targetTab) {
      if (DETECTION_CONFIG.AVOID_TAB_CREATION) {
        // Return cached accounts rather than creating a disruptive tab
        const cached = await getStorage('accounts');
        return cached.accounts || [];
      }

      // Fallback: create a temporary background tab
      const newTab = await chrome.tabs.create({
        url: 'https://accounts.google.com/',
        active: false,
      });
      createdTabId = newTab.id;
      await waitForTabLoad(newTab.id);
      targetTab = await chrome.tabs.get(newTab.id);
    }

    // 3. Execute detection script with timeout
    const results = await Promise.race([
      chrome.scripting.executeScript({
        target: { tabId: targetTab.id, frameIds: [0] },
        func: fetchAccountsInPageContext,
        args: [LIST_ACCOUNTS_URL],
      }),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error('Script execution timeout')),
          DETECTION_CONFIG.SCRIPT_EXEC_TIMEOUT
        )
      ),
    ]);

    // 4. Clean up created tab
    if (createdTabId) {
      try { await chrome.tabs.remove(createdTabId); } catch { /* ignore */ }
      createdTabId = null;
    }

    // 5. Parse results
    const result = results?.[0]?.result;

    if (result?.accounts && result.accounts.length > 0) {
      return result.accounts;
    }

    if (result?.error) {
      console.warn('[G-Account Switcher] In-page detection error:', result.error);
    }

    // Try fallback parsing if raw text was returned
    if (result?.text) {
      const data = parseListAccountsResponse(result.text);
      const accountEntries = data?.[1];
      if (Array.isArray(accountEntries) && accountEntries.length > 0) {
        return accountEntries.map((entry, index) => ({
          index,
          name: entry[2] || '',
          email: entry[3] || '',
          photo: entry[4] || '',
        }));
      }
    }

    return [];
  } catch (error) {
    console.error('[G-Account Switcher] Failed to detect accounts:', error);
    // Return cached accounts on error
    const cached = await getStorage('accounts');
    return cached.accounts || [];
  } finally {
    // Clean up temporary tab if still exists
    if (createdTabId !== null) {
      try { await chrome.tabs.remove(createdTabId); } catch { /* ignore */ }
    }
  }
}

/**
 * Detect accounts and merge with existing stored accounts (preserving labels).
 * @returns {Promise<Array>} Updated accounts list, or null if detection failed
 */
export async function detectAndMergeAccounts() {
  const detected = await detectAccounts();
  if (detected.length === 0) {
    return null; // Signal that detection failed
  }

  const { accounts: existing = [] } = await getStorage('accounts');

  // Merge: keep existing labels, update email/name/photo from detected
  const merged = detected.map((det) => {
    const existingAccount = existing.find((a) => a.index === det.index);
    return {
      index: det.index,
      email: det.email,
      name: det.name,
      photo: det.photo,
      label: existingAccount?.label || '', // Preserve user-set label
    };
  });

  await setStorage({ accounts: merged });
  return merged;
}
