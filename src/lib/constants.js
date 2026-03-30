/**
 * Google domain configuration.
 *
 * Each domain entry specifies:
 *   - type: 'path' (uses /u/X/) or 'query' (uses authuser=X) or 'excluded'
 *   - pathPrefix: where /u/X/ appears in the URL path (for path-type)
 *   - stripsParam: (optional) true if the site strips the authuser= parameter
 *     from the URL after reading it into session cookies (e.g., YouTube, Play Store).
 *     This triggers TTL-based anti-loop caching in proactive mode.
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
  // ── Path-based domains (/u/X/ in path) ──

  // Gmail & Workspace
  { host: 'mail.google.com',           type: 'path', pathPrefix: '/mail' },
  { host: 'drive.google.com',          type: 'path', pathPrefix: '/drive' },
  { host: 'calendar.google.com',       type: 'path', pathPrefix: '/calendar' },
  { host: 'contacts.google.com',       type: 'path', pathPrefix: '' },
  { host: 'keep.google.com',           type: 'path', pathPrefix: '' },
  { host: 'chat.google.com',           type: 'path', pathPrefix: '' },
  { host: 'tasks.google.com',          type: 'path', pathPrefix: '' },
  { host: 'photos.google.com',         type: 'path', pathPrefix: '' },
  { host: 'groups.google.com',         type: 'path', pathPrefix: '' },

  // Admin & Account
  { host: 'myaccount.google.com',      type: 'path', pathPrefix: '' },
  { host: 'admin.google.com',          type: 'path', pathPrefix: '' },
  { host: 'notifications.google.com',  type: 'path', pathPrefix: '' },

  // Communication
  { host: 'meet.google.com',           type: 'path', pathPrefix: '' },

  // AI / ML
  { host: 'aistudio.google.com',       type: 'path', pathPrefix: '' },
  { host: 'gemini.google.com',         type: 'path', pathPrefix: '' },

  // Developer & Cloud
  { host: 'console.cloud.google.com',  type: 'path', pathPrefix: '' },

  // Play Store (uses ?authuser=X, strips it after load like YouTube)
  { host: 'play.google.com',           type: 'query', stripsParam: true },

  // Google Docs suite — /u/X/ comes after the document type
  { host: 'docs.google.com',           type: 'path', pathPrefix: '/document' },
  { host: 'docs.google.com',           type: 'path', pathPrefix: '/spreadsheets' },
  { host: 'docs.google.com',           type: 'path', pathPrefix: '/presentation' },
  { host: 'docs.google.com',           type: 'path', pathPrefix: '/forms' },
  { host: 'docs.google.com',           type: 'path', pathPrefix: '/drawings' },
  { host: 'docs.google.com',           type: 'path', pathPrefix: '' },

  // ── Query-based domains (authuser=X in query string) ──

  // Search & Maps
  { host: 'www.google.com',            type: 'query' },  // Search, Maps, etc.

  // YouTube (strips authuser= after reading it into session cookies)
  { host: 'www.youtube.com',           type: 'query', stripsParam: true },
  { host: 'studio.youtube.com',        type: 'query', stripsParam: true },

  // NotebookLM
  { host: 'notebooklm.google.com',     type: 'query' },

  // Analytics & Marketing
  { host: 'analytics.google.com',      type: 'query' },
  { host: 'tagmanager.google.com',     type: 'query' },
  { host: 'lookerstudio.google.com',   type: 'query' },
  { host: 'search.google.com',         type: 'query', pathPrefix: '/search-console' },

  // Ads & Monetization
  { host: 'ads.google.com',            type: 'query' },
  { host: 'adsense.google.com',        type: 'query' },
  { host: 'admob.google.com',          type: 'query' },

  // Developer
  { host: 'console.firebase.google.com', type: 'query' },

  // Other
  { host: 'translate.google.com',      type: 'path', pathPrefix: '' },

  // ── Excluded — never rewrite ──
  { host: 'music.youtube.com',         type: 'excluded' },  // Cookie-based session, doesn't support authuser
  { host: 'accounts.google.com',       type: 'excluded' },  // Login flows — must not interfere
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
  mode: 'proactive',             // 'proactive' or 'passive'
  defaultAccount: 0,
  globalAccountEnabled: false,   // Global default is OFF by default (per-site first)
  accounts: [],                  // [{ index: 0, email: '', label: '' }, ...]
  siteSettings: {},              // { 'youtube.com': 2, 'mail.google.com': 0, ... }
};

/**
 * Storage keys enum.
 */
export const STORAGE_KEYS = {
  ENABLED: 'enabled',
  MODE: 'mode',
  DEFAULT_ACCOUNT: 'defaultAccount',
  GLOBAL_ACCOUNT_ENABLED: 'globalAccountEnabled',
  ACCOUNTS: 'accounts',
  SITE_SETTINGS: 'siteSettings',
};

/**
 * Maximum Google account index supported.
 */
export const MAX_ACCOUNT_INDEX = 9;

/**
 * Sentinel value for per-site settings meaning "disable redirection entirely for this site".
 * When a site setting is set to this value, no declarativeNetRequest rules are generated
 * and proactive mode skips the redirect.
 */
export const SITE_DISABLED = -1;

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
