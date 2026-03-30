/**
 * declarativeNetRequest rule generator.
 *
 * Generates dynamic redirect rules that rewrite /u/X/ and authuser=X
 * in Google URLs to point to the selected account.
 *
 * Rule ID scheme:
 *   1–500   : Global rules (default account, only when globalAccountEnabled)
 *   501–1000: Per-site rules (higher priority)
 *   1001–1010: Special-case redirect rules (gmail.com → mail.google.com)
 */
import { GOOGLE_DOMAINS, SITE_DISABLED, getSiteKey } from './constants.js';

const GLOBAL_RULE_BASE = 1;
const SITE_RULE_BASE = 501;
const SPECIAL_RULE_BASE = 1001;
const GLOBAL_PRIORITY = 1;
const GLOBAL_QUERYMATCH_PRIORITY = 2;
const SITE_PRIORITY = 3;
const SITE_QUERYMATCH_PRIORITY = 4;
const SPECIAL_PRIORITY = 5;

/**
 * Escape a string for use in a regex pattern.
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a path-based redirect rule for /u/X/ rewriting.
 *
 * Example for mail.google.com with pathPrefix '/mail':
 *   regexFilter:       ^(https?://mail\.google\.com/mail/u/)\d+(/.*)?$
 *   regexSubstitution: \1{accountNum}\2
 */
function buildPathRule(id, priority, host, pathPrefix, accountNum) {
  const escapedHost = escapeRegex(host);
  const escapedPrefix = pathPrefix ? escapeRegex(pathPrefix) : '';

  return {
    id,
    priority,
    action: {
      type: 'redirect',
      redirect: {
        regexSubstitution: `\\1${accountNum}\\2`,
      },
    },
    condition: {
      regexFilter: `^(https?://${escapedHost}${escapedPrefix}/u/)\\d+(/.*)?$`,
      requestDomains: [host],
      resourceTypes: ['main_frame', 'sub_frame'],
    },
  };
}

/**
 * Build a query-based redirect rule for authuser=X rewriting.
 *
 * Example for www.google.com:
 *   regexFilter:       ^(https?://www\.google\.com/.*[?&]authuser=)\d+(.*)$
 *   regexSubstitution: \1{accountNum}\2
 *
 * For domains with pathPrefix (e.g. search.google.com/search-console):
 *   regexFilter:       ^(https?://search\.google\.com/search-console.*[?&]authuser=)\d+(.*)$
 */
function buildQueryRule(id, priority, host, accountNum, pathPrefix = '') {
  const escapedHost = escapeRegex(host);
  const escapedPrefix = pathPrefix ? escapeRegex(pathPrefix) : '';

  return {
    id,
    priority,
    action: {
      type: 'redirect',
      redirect: {
        regexSubstitution: `\\1${accountNum}\\2`,
      },
    },
    condition: {
      regexFilter: `^(https?://${escapedHost}${escapedPrefix}.*[?&]authuser=)\\d+(.*)$`,
      requestDomains: [host],
      resourceTypes: ['main_frame', 'sub_frame'],
    },
  };
}

/**
 * Build query-match redirect rules for domains that require a specific
 * query parameter to be present (e.g., udm=50 for AI mode).
 *
 * Generates TWO rules per entry because the query-match parameter can appear
 * either before or after the authuser= parameter in the URL:
 *
 *   Pattern A (queryMatch before authuser):
 *     ?udm=50&authuser=3      → rewrite authuser
 *     ?q=test&udm=50&authuser=3 → rewrite authuser
 *
 *   Pattern B (queryMatch after authuser):
 *     ?authuser=3&udm=50      → rewrite authuser
 *     ?authuser=3&q=test&udm=50 → rewrite authuser
 *
 * These rules must have HIGHER priority than the generic query rules for the
 * same host, so when both match, the queryMatch rule wins.
 *
 * @param {number} startId - First rule ID (uses startId and startId+1)
 * @param {number} priority - Rule priority
 * @param {string} host - Domain host
 * @param {number} accountNum - Target account index
 * @param {string} qmKey - Query parameter key (e.g., 'udm')
 * @param {string} qmValue - Query parameter value (e.g., '50')
 * @param {string} [pathPrefix=''] - Optional path prefix
 * @returns {Array} Array of two redirect rules
 */
function buildQueryMatchRules(startId, priority, host, accountNum, qmKey, qmValue, pathPrefix = '') {
  const escapedHost = escapeRegex(host);
  const escapedPrefix = pathPrefix ? escapeRegex(pathPrefix) : '';
  const escapedKey = escapeRegex(qmKey);
  const escapedVal = escapeRegex(qmValue);

  return [
    // Pattern A: queryMatch param appears before authuser
    // e.g., ?udm=50&authuser=3 or ?q=test&udm=50&other=1&authuser=3
    {
      id: startId,
      priority,
      action: {
        type: 'redirect',
        redirect: { regexSubstitution: `\\1${accountNum}\\2` },
      },
      condition: {
        regexFilter: `^(https?://${escapedHost}${escapedPrefix}.*[?&]${escapedKey}=${escapedVal}&(?:.*&)?authuser=)\\d+(.*)$`,
        requestDomains: [host],
        resourceTypes: ['main_frame', 'sub_frame'],
      },
    },
    // Pattern B: queryMatch param appears after authuser
    // e.g., ?authuser=3&udm=50 or ?authuser=3&other=1&udm=50
    {
      id: startId + 1,
      priority,
      action: {
        type: 'redirect',
        redirect: { regexSubstitution: `\\1${accountNum}\\2` },
      },
      condition: {
        regexFilter: `^(https?://${escapedHost}${escapedPrefix}.*[?&]authuser=)\\d+((?:.*&)${escapedKey}=${escapedVal}(?:[&#].*|$))$`,
        requestDomains: [host],
        resourceTypes: ['main_frame', 'sub_frame'],
      },
    },
  ];
}

/**
 * Build special-case redirect rules for gmail.com → mail.google.com.
 *
 * Gmail has shortcut domains (gmail.com, www.gmail.com) that should
 * redirect directly to the correct account path.
 *
 * @param {number} accountNum - Target account index
 * @returns {Array} Array of redirect rules
 */
function buildGmailRedirectRules(accountNum) {
  let ruleId = SPECIAL_RULE_BASE;
  return [
    {
      id: ruleId++,
      priority: SPECIAL_PRIORITY,
      action: {
        type: 'redirect',
        redirect: { url: `https://mail.google.com/mail/u/${accountNum}/` },
      },
      condition: {
        urlFilter: '||gmail.com^',
        resourceTypes: ['main_frame'],
      },
    },
    {
      id: ruleId++,
      priority: SPECIAL_PRIORITY,
      action: {
        type: 'redirect',
        redirect: { url: `https://mail.google.com/mail/u/${accountNum}/` },
      },
      condition: {
        urlFilter: '||www.gmail.com^',
        resourceTypes: ['main_frame'],
      },
    },
  ];
}

/**
 * Generate all declarativeNetRequest rules based on current settings.
 *
 * @param {number} defaultAccount - The global default account index
 * @param {Object} siteSettings - Map of host → account index (or SITE_DISABLED)
 * @param {boolean} enabled - Whether the extension is enabled
 * @param {boolean} globalAccountEnabled - Whether the global default account is active
 * @returns {Array} Array of declarativeNetRequest rule objects
 */
export function generateRules(defaultAccount, siteSettings = {}, enabled = true, globalAccountEnabled = false) {
  if (!enabled) {
    return [];
  }

  const rules = [];
  let globalId = GLOBAL_RULE_BASE;
  let siteId = SITE_RULE_BASE;

  for (const domain of GOOGLE_DOMAINS) {
    if (domain.type === 'excluded') {
      continue;
    }

    const key = getSiteKey(domain);
    const hasSiteSetting = key in siteSettings;
    const siteValue = hasSiteSetting ? siteSettings[key] : undefined;

    // If site setting is SITE_DISABLED, skip rule generation for this domain
    // (no redirect rule = no account rewriting = Google's default behavior)
    if (siteValue === SITE_DISABLED) {
      continue;
    }

    if (hasSiteSetting) {
      // Per-site rule (always generated when a site setting exists)
      const accountNum = siteValue;
      if (domain.type === 'path') {
        rules.push(
          buildPathRule(siteId++, SITE_PRIORITY, domain.host, domain.pathPrefix, accountNum)
        );
      } else if (domain.type === 'query' && domain.queryMatch) {
        // queryMatch rule: needs 2 rules (param before/after authuser) at higher priority
        rules.push(
          ...buildQueryMatchRules(siteId, SITE_QUERYMATCH_PRIORITY, domain.host, accountNum,
            domain.queryMatch.key, domain.queryMatch.value, domain.pathPrefix || '')
        );
        siteId += 2;
      } else if (domain.type === 'query') {
        rules.push(
          buildQueryRule(siteId++, SITE_PRIORITY, domain.host, accountNum, domain.pathPrefix || '')
        );
      }
    } else if (globalAccountEnabled) {
      // Global rule (only when global default is enabled)
      if (domain.type === 'path') {
        rules.push(
          buildPathRule(globalId++, GLOBAL_PRIORITY, domain.host, domain.pathPrefix, defaultAccount)
        );
      } else if (domain.type === 'query' && domain.queryMatch) {
        // queryMatch rule: needs 2 rules (param before/after authuser) at higher priority
        rules.push(
          ...buildQueryMatchRules(globalId, GLOBAL_QUERYMATCH_PRIORITY, domain.host, defaultAccount,
            domain.queryMatch.key, domain.queryMatch.value, domain.pathPrefix || '')
        );
        globalId += 2;
      } else if (domain.type === 'query') {
        rules.push(
          buildQueryRule(globalId++, GLOBAL_PRIORITY, domain.host, defaultAccount, domain.pathPrefix || '')
        );
      }
    }
  }

  // Special-case: gmail.com → mail.google.com/mail/u/X/
  const gmailSetting = siteSettings['mail.google.com'];
  if (gmailSetting === SITE_DISABLED) {
    // Skip gmail redirect rules if mail.google.com is disabled
  } else if (gmailSetting !== undefined) {
    // Use per-site setting for gmail
    rules.push(...buildGmailRedirectRules(gmailSetting));
  } else if (globalAccountEnabled) {
    // Use global default for gmail
    rules.push(...buildGmailRedirectRules(defaultAccount));
  }

  return rules;
}

/**
 * Apply new rules by removing all existing dynamic rules and adding new ones.
 *
 * @param {number} defaultAccount
 * @param {Object} siteSettings
 * @param {boolean} enabled
 * @param {boolean} globalAccountEnabled
 */
export async function applyRules(defaultAccount, siteSettings, enabled, globalAccountEnabled) {
  // Get all existing dynamic rules
  const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existingRules.map((r) => r.id);

  // Generate new rules
  const addRules = generateRules(defaultAccount, siteSettings, enabled, globalAccountEnabled);

  // Atomic update: remove old, add new
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds,
    addRules,
  });

  console.log(
    `[G-Account Switcher] Applied ${addRules.length} rules (default: ${defaultAccount}, ` +
    `sites: ${Object.keys(siteSettings).length}, global: ${globalAccountEnabled}, enabled: ${enabled})`
  );
}
