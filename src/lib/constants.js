/**
 * Google domain configuration.
 *
 * Each domain entry specifies:
 *   - type: 'path' (uses /u/X/) or 'query' (uses authuser=X) or 'both'
 *   - pathPrefix: where /u/X/ appears in the URL path (for path-type)
 *   - excluded: if true, never rewrite this domain
 *
 * Based on real-world URL patterns:
 *   https://mail.google.com/mail/u/1/
 *   https://aistudio.google.com/u/3/prompts/new_chat
 *   https://gemini.google.com/u/3/app
 *   https://docs.google.com/document/u/3/
 *   https://photos.google.com/u/3/
 *   https://www.google.com/maps?authuser=1
 *   https://www.google.com/search?q=test&authuser=3
 */

// Domains where /u/X/ appears right after a known path segment
// e.g., mail.google.com/mail/u/0/  → pathPrefix = '/mail'
//       docs.google.com/document/u/0/ → pathPrefix = '/document'
export const GOOGLE_DOMAINS = [
  // Path-based domains (/u/X/ in path)
  { host: 'mail.google.com',           type: 'path', pathPrefix: '/mail' },
  { host: 'drive.google.com',          type: 'path', pathPrefix: '/drive' },
  { host: 'calendar.google.com',       type: 'path', pathPrefix: '/calendar' },
  { host: 'contacts.google.com',       type: 'path', pathPrefix: '' },
  { host: 'keep.google.com',           type: 'path', pathPrefix: '' },
  { host: 'chat.google.com',           type: 'path', pathPrefix: '' },
  { host: 'photos.google.com',         type: 'path', pathPrefix: '' },
  { host: 'myaccount.google.com',      type: 'path', pathPrefix: '' },
  { host: 'notifications.google.com',  type: 'path', pathPrefix: '' },
  { host: 'meet.google.com',           type: 'path', pathPrefix: '' },
  { host: 'groups.google.com',         type: 'path', pathPrefix: '' },
  { host: 'admin.google.com',          type: 'path', pathPrefix: '' },
  { host: 'analytics.google.com',      type: 'path', pathPrefix: '' },
  { host: 'console.cloud.google.com',  type: 'path', pathPrefix: '' },
  { host: 'play.google.com',           type: 'path', pathPrefix: '/store' },

  // These have /u/X/ directly after the host
  { host: 'aistudio.google.com',       type: 'path', pathPrefix: '' },
  { host: 'gemini.google.com',         type: 'path', pathPrefix: '' },

  // Google Docs suite — /u/X/ comes after the document type
  { host: 'docs.google.com',           type: 'path', pathPrefix: '/document' },
  { host: 'docs.google.com',           type: 'path', pathPrefix: '/spreadsheets' },
  { host: 'docs.google.com',           type: 'path', pathPrefix: '/presentation' },
  { host: 'docs.google.com',           type: 'path', pathPrefix: '/forms' },
  { host: 'docs.google.com',           type: 'path', pathPrefix: '/drawings' },
  { host: 'docs.google.com',           type: 'path', pathPrefix: '' },

  // NotebookLM — query-based
  { host: 'notebooklm.google.com',     type: 'query' },

  // Query-based domains (authuser=X in query string)
  { host: 'www.google.com',            type: 'query' },  // Search, Maps, etc.
  { host: 'www.youtube.com',           type: 'query' },
  { host: 'studio.youtube.com',        type: 'query' },
  { host: 'music.youtube.com',         type: 'excluded' },  // Doesn't support authuser — uses cookie-based session

  // Excluded — never rewrite
  { host: 'accounts.google.com',       type: 'excluded' },
];

/**
 * Unique host patterns for manifest host_permissions and URL matching.
 */
export const ALL_GOOGLE_HOST_PATTERNS = [
  '*://*.google.com/*',
  '*://*.youtube.com/*',
  '*://*.googleapis.com/*',
];

/**
 * Default storage values.
 */
export const STORAGE_DEFAULTS = {
  enabled: true,
  mode: 'proactive',       // 'proactive' or 'passive'
  defaultAccount: 0,
  accounts: [],            // [{ index: 0, email: '', label: '' }, ...]
  siteOverrides: {},       // { 'youtube.com': 2, 'mail.google.com': 0, ... }
};

/**
 * Storage keys enum.
 */
export const STORAGE_KEYS = {
  ENABLED: 'enabled',
  MODE: 'mode',
  DEFAULT_ACCOUNT: 'defaultAccount',
  ACCOUNTS: 'accounts',
  SITE_OVERRIDES: 'siteOverrides',
};

/**
 * Maximum Google account index supported.
 */
export const MAX_ACCOUNT_INDEX = 9;

/**
 * URL for the Google ListAccounts endpoint.
 */
export const LIST_ACCOUNTS_URL = 'https://accounts.google.com/ListAccounts?gpsia=1&source=ogb&mo=1';

/**
 * Regex patterns for matching /u/X/ and authuser=X in URLs.
 */
export const URL_PATTERNS = {
  // Matches /u/ followed by a digit
  PATH_ACCOUNT: /\/u\/(\d+)(\/|$)/,
  // Matches authuser= followed by a digit(s)
  QUERY_ACCOUNT: /[?&]authuser=(\d+)/,
};
