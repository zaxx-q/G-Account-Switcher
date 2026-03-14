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

/**
 * Wait for a tab to finish loading.
 * @param {number} tabId
 * @param {number} timeoutMs
 * @returns {Promise<void>}
 */
function waitForTabLoad(tabId, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Tab load timed out'));
    }, timeoutMs);

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
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
 * Fetch logged-in Google accounts from ListAccounts API.
 *
 * Strategy: Always create a temporary background tab on accounts.google.com
 * and inject the fetch into it using world: 'MAIN'. This ensures:
 *   1. Same-origin fetch (no CORS issues)
 *   2. Google auth cookies are sent (SID, HSID, etc.)
 *   3. Works regardless of what other Google tabs are open
 *
 * @returns {Promise<Array<{index: number, email: string, name: string, photo: string}>>}
 */
export async function detectAccounts() {
  let tempTabId = null;

  try {
    // 1. Always create a temporary tab on accounts.google.com
    //    This guarantees same-origin for the ListAccounts fetch.
    const tab = await chrome.tabs.create({
      url: 'https://accounts.google.com/',
      active: false,
    });
    tempTabId = tab.id;
    await waitForTabLoad(tab.id);

    // 2. Execute fetch in the page's MAIN world (same-origin with accounts.google.com)
    const scriptPromise = chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: async (url) => {
        try {
          const response = await fetch(url, { credentials: 'include' });
          if (!response.ok) {
            return { error: `HTTP ${response.status}` };
          }
          return { text: await response.text() };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [LIST_ACCOUNTS_URL],
    });

    // Race against a timeout to prevent infinite hang
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Script injection timed out after 20s')), 20_000)
    );

    const results = await Promise.race([scriptPromise, timeoutPromise]);

    const result = results?.[0]?.result;

    if (!result || result.error) {
      throw new Error(`ListAccounts fetch failed: ${result?.error || 'no result'}`);
    }

    // 3. Parse the response
    // The endpoint may return either:
    //   A) Raw JSON with XSSI prefix: )]}'\n[...]
    //   B) HTML wrapper: <!DOCTYPE html>...<script>window.parent.postMessage('\x5b...\x5d', ...)</script>
    //      where the data is hex-escaped inside the postMessage string.
    const data = parseListAccountsResponse(result.text);

    const accountEntries = data?.[1];
    if (!Array.isArray(accountEntries) || accountEntries.length === 0) {
      console.warn('[G-Account Switcher] No account entries found in response');
      return [];
    }

    const accounts = accountEntries.map((entry, index) => ({
      index,
      name: entry[2] || '',
      email: entry[3] || '',
      photo: entry[4] || '',
    }));

    return accounts;
  } catch (error) {
    console.error('[G-Account Switcher] Failed to detect accounts:', error);
    return [];
  } finally {
    // Clean up temporary tab
    if (tempTabId !== null) {
      try {
        await chrome.tabs.remove(tempTabId);
      } catch { /* tab may already be closed */ }
    }
  }
}

/**
 * Detect accounts and merge with existing stored accounts (preserving labels).
 * @returns {Promise<Array>} Updated accounts list
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
