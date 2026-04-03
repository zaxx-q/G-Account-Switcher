# G-Account Switcher

A lightweight Manifest V3 Chrome extension that lets you assign specific Google accounts to individual Google services — Gmail, YouTube, Drive, Docs, Calendar, AI Studio, Gemini, NotebookLM, Firebase, Google Ads, Analytics, and 30+ more. Optionally set a global default across all services.

## How It Works

Google identifies accounts by a numeric index (0, 1, 2, ...) in URLs via two patterns:

| Pattern | Example | Services |
|---------|---------|----------|
| **Path-based** `/u/X/` | `mail.google.com/mail/u/1/` | Gmail, Drive, Calendar, Photos, AI Studio, Gemini, Meet, Cloud Console |
| **Query-based** `authuser=X` | `google.com/search?authuser=1` | Search, Maps, Docs, Sheets, Slides, Forms, Drawings, YouTube, NotebookLM, Analytics, Firebase, Ads, Tag Manager |

This extension rewrites those indices using two layers:

1. **`declarativeNetRequest`** — Rewrites `/u/X/` and `authuser=X` in URLs **before** the HTTP request is made. Zero flicker, zero double-loading.
2. **Proactive mode** — Detects bare Google URLs (without any account param) and redirects them to include the configured account.

### Per-Site First

By default, the extension only activates based on **specific per-site configurations**. The global default account is optional and disabled on fresh installs. This means:

- **No redirects** until you explicitly configure a site or enable the global default
- Each Google service can use a **different account** independently
- The global default acts as a **fallback** for unconfigured sites (when enabled)

## Features

- **Per-site account settings** — Assign specific accounts to individual services (e.g., Account 0 for YouTube, Account 3 for Gmail). Each Docs suite service (Docs, Sheets, Slides, Forms, Drawings) gets its own independent setting, as do Search, Maps, and AI mode on `www.google.com`
- **Icon-based account selector** — Current site panel shows clickable account avatars with profile pictures, index badges, and labels for quick switching
- **Optional global default** — When enabled, unconfigured sites fall back to a single default account
- **Auto-detect accounts** — Discovers logged-in account emails, names, and profile pictures via Google's ListAccounts endpoint
- **Profile pictures** — Popup shows account avatars with initials fallback across all sections
- **Inline editing** — Change site account assignments directly in the site settings list without deleting and re-adding
- **Auto-refresh** — Current tab automatically refreshes after switching accounts for immediate effect
- **Cookie-based account sync** — Automatically refreshes the account list when you sign in/out of Google (monitors `SID`, `SSID`, `HSID`, `LSID`, `ACCOUNT_CHOOSER` cookies)
- **Fast detection** — Reuses existing Google/YouTube tabs for account detection instead of creating new tabs; falls back to cached accounts when no tabs are available
- **Manual account management** — Add accounts with custom labels (Work, Personal, etc.)
- **gmail.com redirect** — `gmail.com` and `www.gmail.com` are redirected to `mail.google.com/mail/u/X/`
- **Per-site disable** — Disable redirection entirely for specific sites
- **Two modes:**
  - **Proactive** (default) — Forces configured account on ALL matching Google URLs, even bare ones
  - **Passive** — Only rewrites URLs that already have `/u/X/` or `authuser=X`
- **Dark / Light theme** — Automatically matches your system or browser color scheme via `prefers-color-scheme`
- **Per-tab redirect tracking** — Redirects only fire on first visit to a domain in each tab; eliminates repeated redirects that cause lost progress on YouTube, Play Store, Docs, and other param-stripping services
- **30+ Google domains covered** — Including all Workspace, Developer, Ads, and AI services. Sub-service disambiguation for Maps and AI mode on `www.google.com`, and all Docs suite services on `docs.google.com`
- **Near-zero performance impact** — `declarativeNetRequest` rules run in the browser's network layer, not in JavaScript
- **Migration safe** — Existing users upgrading from v2 automatically have their settings migrated and global default enabled to preserve behavior

## Installation

1. Clone or download this repository
2. Open `chrome://extensions/` in Chrome/Edge/Brave
3. Enable "Developer mode" (toggle in top-right)
4. Click "Load unpacked"
5. Select the `G-Account-Switcher` folder (the one containing `manifest.json`)

## Usage

1. Click the extension icon in the toolbar
2. Click **🔍 Detect** to auto-discover your logged-in Google accounts (with profile pictures)
3. Navigate to a Google site — the **Current Site** panel appears with clickable account avatars
4. Click an avatar to assign that account to the current site — the page auto-refreshes
5. Configure additional sites via the **Site Settings** section (click **+ Add** or use inline editing)
6. (Optional) Expand the **Global Default** section and enable it to set a fallback account for all unconfigured sites
7. Choose between **Proactive** and **Passive** mode at the bottom of the popup

## File Structure

```
G-Account-Switcher/
├── manifest.json                 # MV3 manifest
├── src/
│   ├── background.js             # Service worker: rules, cookies, messages, migration
│   ├── lib/
│   │   ├── constants.js          # 30+ Google domain mappings, siteKey/queryMatch config, storage keys
│   │   ├── storage.js            # chrome.storage.sync helpers
│   │   ├── accounts.js           # Account detection (reuses existing tabs)
│   │   ├── rules.js              # declarativeNetRequest rule generator
│   │   └── proactive.js          # Bare URL redirect logic
│   ├── popup/
│   │   ├── popup.html            # Extension popup UI
│   │   ├── popup.css             # Popup styles (light/dark theme)
│   │   └── popup.js              # Popup controller (icon selector, inline editing)
│   └── icons/
│       ├── icon16.png
│       ├── icon32.png
│       ├── icon48.png
│       └── icon128.png
└── tools/
    ├── generate-icons.js         # Node.js icon generator
    └── generate-icons.html       # Browser-based icon generator
```

## Permissions

| Permission | Why |
|---|---|
| `storage` | Save account settings and preferences |
| `tabs` | Detect bare Google URLs for proactive mode; find existing Google tabs for fast account detection |
| `scripting` | Inject account detection fetch into a Google tab (required for first-party cookie access) |
| `declarativeNetRequest` | Rewrite `/u/X/` and `authuser=X` pre-request |
| `cookies` | Monitor Google auth cookie changes to auto-refresh the account list on sign-in/out |
| `host_permissions: *.google.com, *.youtube.com, *.gmail.com` | Match and redirect Google service URLs |

## Covered Services

**Workspace:** Gmail, Google Drive, Google Docs, Sheets, Slides, Drawings, Google Calendar, Google Contacts, Google Keep, Google Tasks, Google Chat, Google Meet, Google Groups, Google Forms.

**AI:** Gemini, Google AI Studio, NotebookLM, Google AI Mode (Search with `udm=50`).

**Developer & Cloud:** Google Cloud Console, Firebase Console, Google Tag Manager, Looker Studio, Google Search Console.

**Ads & Monetization:** Google Ads, AdSense, AdMob.

**Other:** YouTube, YouTube Studio, Google Search, Google Maps, Google Photos, Google Translate, Google Play Store, Google Admin Console, My Account, Google Analytics, Google Notifications.

**Sub-service disambiguation on `www.google.com`:**
- `www.google.com` — Google Search (generic fallback)
- `www.google.com/maps` — Google Maps (matched by `/maps` path prefix, stored as `www.google.com/maps`)
- `www.google.com/ai` — AI Mode (matched by `udm=50` query parameter, stored as `www.google.com/aimode`)

**Sub-service disambiguation on `docs.google.com`:**
- `docs.google.com` — Generic fallback (path-based `/u/X/`)
- `docs.google.com/document` — Google Docs (uses `?authuser=X`, stored as `docs.google.com/document`)
- `docs.google.com/spreadsheets` — Google Sheets (uses `?authuser=X`, stored as `docs.google.com/spreadsheets`)
- `docs.google.com/presentation` — Google Slides (uses `?authuser=X`, stored as `docs.google.com/presentation`)
- `docs.google.com/forms` — Google Forms (uses `?authuser=X`, stored as `docs.google.com/forms`)
- `docs.google.com/drawings` — Google Drawings (uses `?authuser=X`, stored as `docs.google.com/drawings`)

All Docs suite services strip the `authuser` parameter after reading it, so they rely on the per-tab sync tracker (like YouTube and Play Store).

**Excluded:**
- `accounts.google.com` — Login/logout flows are never modified.
- `music.youtube.com` — YouTube Music uses cookie-based sessions and does not support `authuser` parameter switching.

**Special Redirects:**
- `gmail.com` / `www.gmail.com` → `mail.google.com/mail/u/X/`

## Technical Notes

### Account Detection
The extension detects logged-in accounts by fetching Google's internal `ListAccounts` endpoint. Since MV3 service workers cannot send first-party cookies, the fetch is injected via `chrome.scripting.executeScript` into an existing Google/YouTube tab (or a temporary `accounts.google.com` tab as fallback). The response is parsed using a recursive traversal for `gaia.l.a` markers, extracting email (index 3), display name (index 2), and profile picture URL (index 4). Both XSSI-prefixed JSON and HTML/postMessage formats are supported.

### Fast Detection Strategy
Instead of always creating a new tab (slow and disruptive), the extension:
1. Searches for existing loaded Google/YouTube tabs via `chrome.tabs.query()`
2. Injects the detection script into the best available tab
3. Falls back to cached accounts if no suitable tab exists and `AVOID_TAB_CREATION` is true
4. Only creates a temporary tab as a last resort

### Cookie-Based Auto-Refresh
The background service worker monitors `chrome.cookies.onChanged` for Google auth cookies (`SID`, `SSID`, `HSID`, `LSID`, `ACCOUNT_CHOOSER`). When these change (sign-in, sign-out, or account switch), account detection runs automatically after a 2-second debounce to let all cookie changes settle.

### Sub-Service Disambiguation (siteKey / queryMatch)
Multiple Google services share the same host but need independent account settings. The extension handles this through two disambiguation mechanisms:

- **`pathPrefix`** — Matches URL paths (e.g., `/maps` for Google Maps on `www.google.com`, `/forms` for Google Forms on `docs.google.com`). When a `siteKey` is set (e.g., `docs.google.com/forms`), the entry gets its own slot in site settings storage, independent from the host's catchall entry.
- **`queryMatch`** — Matches a specific query parameter key/value pair (e.g., `udm=50` for AI mode). The entry includes a `siteKey` (`www.google.com/aimode`) and `queryMatch: { key: 'udm', value: '50' }`. In `declarativeNetRequest`, two regex rules are generated per queryMatch entry to handle the parameter appearing before or after `authuser=` in any order. queryMatch rules have higher priority than generic query rules for the same host.

Domain matching follows a unified priority chain across all types: (1) queryMatch entries, (2) specific pathPrefix matches (longest wins, regardless of path vs query type), (3) catchall entries (empty pathPrefix). This ensures a query-type entry with `/forms` pathPrefix is chosen over a path-type catchall with empty pathPrefix.

The `getSiteKey()` helper resolves each domain entry to its storage key (`domain.siteKey || domain.host`), ensuring all code paths — rules, proactive mode, popup UI, and anti-loop cache — use the correct key for lookups.

### Redirect Loop Prevention (Per-Tab Tracking)
Some Google services (YouTube, Play Store, Docs suite) process the `authuser` parameter, switch the session via cookies (for YouTube and Play Store only), then strip the parameter and reload. Without protection, the extension would re-add the parameter in an infinite loop.

To prevent this, a per-tab sync tracker (`tabSyncedStates`) records `tabId:siteKey → accountNum` after each redirect. Once a tab has been synced for a given site, no further redirects occur — regardless of how much time passes or how many in-page navigations happen. This means:

- **First visit** to a Google domain in a tab → redirects to the configured account
- **Subsequent navigations** within the same tab+domain → no redirect (even after hours)
- **User switches account via popup** → `clearSyncedState()` wipes all entries, so the next navigation triggers a fresh redirect
- **Tab closed** → `cleanupTab(tabId)` removes all entries for that tab to prevent memory leaks
- **User manually switches account within a site** (e.g., Gmail's built-in account picker) → the extension respects their choice and does not force them back

The tracker is keyed by `getSiteKey(domain)` combined with `tabId` to prevent collisions between services sharing the same host (e.g., Forms vs Docs on `docs.google.com`) and to provide per-tab isolation.

### Storage Migration (v2 → v3)
On install/update, the background service worker migrates legacy storage keys:
- `siteOverrides` → `siteSettings` (data preserved)
- Existing users with a `defaultAccount` set automatically get `globalAccountEnabled: true` to preserve their existing behavior
- New installs start with `globalAccountEnabled: false` (per-site only)

## License

MIT
