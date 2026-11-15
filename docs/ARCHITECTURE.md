# Architecture

How G-Account Switcher works internally. For what it does and how to use it,
see the [README](../README.md); for build and release steps, see
[CONTRIBUTING.md](../CONTRIBUTING.md).

## File structure

```
G-Account-Switcher/
├── manifest.json                 # Chrome MV3 manifest
├── manifest.firefox.json         # Firefox MV3 manifest
├── build.js                      # Build: validates, then writes dist/ folders and zip packages
├── package.json                  # Scripts (build, test, lint); no runtime dependencies
├── scripts/
│   └── zip.js                    # Dependency-free, reproducible zip writer used by build.js
├── src/
│   ├── background.js             # Background script: rules, cookies, messages
│   ├── lib/
│   │   ├── constants.js          # 30+ Google domain mappings, siteKey/queryMatch config, storage keys
│   │   ├── domains.js            # URL → domain entry matching (pure; shared by popup and background)
│   │   ├── account-url.js        # Read / rewrite the account index in a URL (pure)
│   │   ├── rules.js              # declarativeNetRequest rule generator
│   │   ├── proactive.js          # Bare URL redirect logic
│   │   ├── tab-state.js          # Per-tab sync tracker persisted in storage.session
│   │   ├── accounts.js           # Account detection (reuses existing tabs)
│   │   ├── parse-accounts.js     # ListAccounts parsing and label-preserving merge (pure)
│   │   └── storage.js            # chrome.storage.local helpers
│   ├── popup/
│   │   ├── popup.html            # Extension popup UI
│   │   ├── popup.css             # Popup styles (light/dark theme)
│   │   └── popup.js              # Popup controller (icon selector, inline editing)
│   └── icons/
│       ├── icon16.png
│       ├── icon32.png
│       ├── icon48.png
│       └── icon128.png
├── docs/
│   └── ARCHITECTURE.md           # This file
├── test/                         # Unit tests (node:test, no dependencies)
├── .github/                      # CI, release workflow, issue template
├── CHANGELOG.md
├── CONTRIBUTING.md
├── PRIVACY.md
└── LICENSE
```

## Account Detection

The extension detects logged-in accounts by fetching Google's internal `ListAccounts` endpoint. Since MV3 service workers cannot send first-party cookies, the fetch is injected via `chrome.scripting.executeScript` into an existing Google/YouTube tab (or, only when you click **Detect** and no such tab exists, a temporary `accounts.google.com` tab). The injected function only fetches and returns the raw text; parsing happens in the background worker (`parse-accounts.js`) using a recursive traversal for `gaia.l.a` markers, extracting email (index 3), display name (index 2), and profile picture URL (index 4). Both XSSI-prefixed JSON and HTML/postMessage formats are supported. Re-detection merges by e-mail address, so custom labels are never handed to a different account.

## Fast Detection Strategy

Instead of always creating a new tab (slow and disruptive), the extension:

1. Searches for existing loaded Google/YouTube tabs via `chrome.tabs.query()`
2. Injects the detection script into the best available tab
3. For automatic refreshes (install, cookie changes): falls back to the cached accounts if no suitable tab exists
4. For an explicit click on **Detect**: opens a temporary background tab on `accounts.google.com` as a last resort and always closes it again

## Cookie-Based Auto-Refresh

The background service worker monitors `chrome.cookies.onChanged` for Google auth cookies (`SID`, `SSID`, `HSID`, `LSID`, `ACCOUNT_CHOOSER`). When these change (sign-in, sign-out, or account switch), account detection runs automatically after a 2-second debounce to let all cookie changes settle.

## Sub-Service Disambiguation (siteKey / queryMatch)

Multiple Google services share the same host but need independent account settings. The extension handles this through two disambiguation mechanisms:

- **`pathPrefix`** — Matches URL paths (e.g., `/maps` for Google Maps on `www.google.com`, `/forms` for Google Forms on `docs.google.com`). When a `siteKey` is set (e.g., `docs.google.com/forms`), the entry gets its own slot in site settings storage, independent from the host's catchall entry.
- **`queryMatch`** — Matches a specific query parameter key/value pair (e.g., `udm=50` for AI mode). The entry includes a `siteKey` (`www.google.com/aimode`) and `queryMatch: { key: 'udm', value: '50' }`. In `declarativeNetRequest`, two regex rules are generated per queryMatch entry to handle the parameter appearing before or after `authuser=` in any order. queryMatch rules have higher priority than generic query rules for the same host.

Domain matching follows a unified priority chain across all types: (1) queryMatch entries, (2) specific pathPrefix matches (longest wins, regardless of path vs query type), (3) catchall entries (empty pathPrefix). This ensures a query-type entry with `/forms` pathPrefix is chosen over a path-type catchall with empty pathPrefix. A `pathPrefix` matches at a path boundary: `/maps` matches `/maps` and `/maps/place/x`, but not `/mapsfoo`. The generated rules apply the same boundary.

The `getSiteKey()` helper resolves each domain entry to its storage key (`domain.siteKey || domain.host`), ensuring all code paths — rules, proactive mode, popup UI, and anti-loop cache — use the correct key for lookups.

## Redirect Loop Prevention (Per-Tab Tracking)

Some Google services (YouTube, Play Store, Docs suite) process the `authuser` parameter, switch the session via cookies (for YouTube and Play Store only), then strip the parameter and reload. Without protection, the extension would re-add the parameter in an infinite loop.

To prevent this, a per-tab sync tracker records `tabId:siteKey → accountNum` after each proactive redirect. Once a tab has been synced for a given site, no further proactive redirects occur — regardless of how much time passes or how many in-page navigations happen. This means:

- **First visit** to a Google domain in a tab → redirects to the configured account
- **Subsequent navigations** within the same tab+domain → no proactive redirect (even after hours)
- **User switches account via popup** → `clearSyncedState()` wipes all entries, so the next navigation triggers a fresh redirect
- **Tab closed** → `cleanupTab(tabId)` removes all entries for that tab
- **Extension installed or updated** → tabs that are already open are marked as synced, so they are not redirected on their next navigation

The tracker lives in `chrome.storage.session` (see `tab-state.js`), not just in memory: MV3 background workers are unloaded after ~30 seconds of inactivity, and an in-memory tracker would forget every tab each time. Session storage survives that but is cleared when the browser closes, which is correct because tab IDs are not stable across restarts. Every event handler waits for the tracker (and the settings) to load before acting, so the event that wakes a stopped worker is handled correctly.

The tracker is keyed by `getSiteKey(domain)` combined with `tabId` to prevent collisions between services sharing the same host (e.g., Forms vs Docs on `docs.google.com`) and to provide per-tab isolation.

> **Note:** the tracker only governs *proactive* redirects of bare URLs. A site with a configured account is also enforced at the network layer: `declarativeNetRequest` rewrites any request that carries a different `/u/X/` or `authuser=X` (for example, from Gmail's built-in account picker) back to the configured account. To use another account temporarily, change the site's account in the popup, or set the site to **disabled** (`-1`).

## Rule Priorities

Several rules can match one URL (Maps and Search both live on `www.google.com`, for instance). Rule priority is `tier + specificity`, where the tier is global (10) or per-site (30), and specificity is +0 for a catch-all, +1 for a `pathPrefix` and +2 for a `queryMatch`. A per-site rule therefore always beats a global one, and the more specific service wins within a tier. No two overlapping rules share a priority, so the outcome never depends on rule order or on a browser's tie-breaking.

## Storage

Settings and the account list are kept in `chrome.storage.local`; the per-tab tracker is in `chrome.storage.session`. Nothing is written to `chrome.storage.sync`.

Local rather than synced storage is deliberate. The account list holds e-mail addresses and describes *this browser's* Google sign-ins, which differ from device to device, so syncing it would copy addresses to other devices and have each device overwrite the others' list. Local storage also has none of sync's small per-item quotas.

Account indexes are positional: Google renumbers accounts when you sign out of one, and per-site settings refer to those positions. After signing out of an account, review your site settings.

### Upgrading from `chrome.storage.sync` (before 3.3.0)

Versions before 3.3.0 kept everything in `chrome.storage.sync`. That data is deliberately **not** carried over: the extension has few settings, and the account list can be re-fetched with **Detect**. Instead, `removeLegacySyncData()` deletes the old synced keys (this extension's own keys only) on install/update, so the e-mail addresses in the old account list do not linger in the browser's sync storage.

The effect is that anyone updating from an earlier version starts from the defaults: no redirects until they pick accounts again. Devices still on an older version lose their synced settings once another device updates.

The v2 → v3 key migration (`siteOverrides` → `siteSettings`, enabling the global default for users who had one) was removed with this, since the data it operated on lived in sync.

## Services that share a host

Several Google services share one host but need independent settings, so
their entries in `GOOGLE_DOMAINS` carry a `siteKey` (the storage key of the
setting) and are told apart by `pathPrefix` or `queryMatch`.

### `www.google.com`

- `www.google.com` — Google Search (generic fallback)
- `www.google.com/maps` — Google Maps (matched by `/maps` path prefix, stored as `www.google.com/maps`)
- `www.google.com/aimode` — AI Mode (matched by `udm=50` query parameter, stored as `www.google.com/aimode`)

### `docs.google.com`

- `docs.google.com` — Generic fallback (path-based `/u/X/`)
- `docs.google.com/document` — Google Docs (uses `?authuser=X`, stored as `docs.google.com/document`)
- `docs.google.com/spreadsheets` — Google Sheets (uses `?authuser=X`, stored as `docs.google.com/spreadsheets`)
- `docs.google.com/presentation` — Google Slides (uses `?authuser=X`, stored as `docs.google.com/presentation`)
- `docs.google.com/forms` — Google Forms (uses `?authuser=X`, stored as `docs.google.com/forms`)
- `docs.google.com/drawings` — Google Drawings (uses `?authuser=X`, stored as `docs.google.com/drawings`)

All Docs suite services strip the `authuser` parameter after reading it, so they rely on the per-tab sync tracker (like YouTube and Play Store).
