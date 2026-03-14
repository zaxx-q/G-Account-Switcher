/**
 * declarativeNetRequest rule generator.
 *
 * Generates dynamic redirect rules that rewrite /u/X/ and authuser=X
 * in Google URLs to point to the selected account.
 *
 * Rule ID scheme:
 *   1–500   : Global rules (default account)
 *   501–1000: Per-site override rules (higher priority)
 *   1001–1010: Special-case redirect rules (gmail.com → mail.google.com)
 */
import { GOOGLE_DOMAINS, OVERRIDE_DISABLED } from './constants.js';

const GLOBAL_RULE_BASE = 1;
const OVERRIDE_RULE_BASE = 501;
const SPECIAL_RULE_BASE = 1001;
const GLOBAL_PRIORITY = 1;
const OVERRIDE_PRIORITY = 2;
const SPECIAL_PRIORITY = 3;

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
 * @param {Object} siteOverrides - Map of host → account index (or OVERRIDE_DISABLED)
 * @param {boolean} enabled - Whether the extension is enabled
 * @returns {Array} Array of declarativeNetRequest rule objects
 */
export function generateRules(defaultAccount, siteOverrides = {}, enabled = true) {
  if (!enabled) {
    return [];
  }

  const rules = [];
  let globalId = GLOBAL_RULE_BASE;
  let overrideId = OVERRIDE_RULE_BASE;

  for (const domain of GOOGLE_DOMAINS) {
    if (domain.type === 'excluded') {
      continue;
    }

    const hasOverride = domain.host in siteOverrides;
    const overrideValue = hasOverride ? siteOverrides[domain.host] : undefined;

    // If override is OVERRIDE_DISABLED, skip rule generation for this domain
    // (no redirect rule = no account rewriting = Google's default behavior)
    if (overrideValue === OVERRIDE_DISABLED) {
      continue;
    }

    const accountNum = hasOverride ? overrideValue : defaultAccount;

    if (domain.type === 'path') {
      if (hasOverride) {
        rules.push(
          buildPathRule(overrideId++, OVERRIDE_PRIORITY, domain.host, domain.pathPrefix, accountNum)
        );
      } else {
        rules.push(
          buildPathRule(globalId++, GLOBAL_PRIORITY, domain.host, domain.pathPrefix, accountNum)
        );
      }
    } else if (domain.type === 'query') {
      if (hasOverride) {
        rules.push(
          buildQueryRule(overrideId++, OVERRIDE_PRIORITY, domain.host, accountNum, domain.pathPrefix || '')
        );
      } else {
        rules.push(
          buildQueryRule(globalId++, GLOBAL_PRIORITY, domain.host, accountNum, domain.pathPrefix || '')
        );
      }
    }
  }

  // Special-case: gmail.com → mail.google.com/mail/u/X/
  const gmailOverride = siteOverrides['mail.google.com'];
  // Skip gmail redirect rules if mail.google.com is disabled
  if (gmailOverride !== OVERRIDE_DISABLED) {
    const gmailAccount = gmailOverride !== undefined ? gmailOverride : defaultAccount;
    rules.push(...buildGmailRedirectRules(gmailAccount));
  }

  return rules;
}

/**
 * Apply new rules by removing all existing dynamic rules and adding new ones.
 *
 * @param {number} defaultAccount
 * @param {Object} siteOverrides
 * @param {boolean} enabled
 */
export async function applyRules(defaultAccount, siteOverrides, enabled) {
  // Get all existing dynamic rules
  const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existingRules.map((r) => r.id);

  // Generate new rules
  const addRules = generateRules(defaultAccount, siteOverrides, enabled);

  // Atomic update: remove old, add new
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds,
    addRules,
  });

  console.log(
    `[G-Account Switcher] Applied ${addRules.length} rules (default: ${defaultAccount}, ` +
    `overrides: ${Object.keys(siteOverrides).length}, enabled: ${enabled})`
  );
}
