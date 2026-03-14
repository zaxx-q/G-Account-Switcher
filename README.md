# G-Account Switcher

A lightweight Manifest V3 Chrome extension that sets your default Google account across **all** Google services — Gmail, YouTube, Drive, Docs, Calendar, AI Studio, Gemini, NotebookLM, Firebase, Google Ads, Analytics, and 30+ more.

## How It Works

Google identifies accounts by a numeric index (0, 1, 2, ...) in URLs via two patterns:

| Pattern | Example | Services |
|---------|---------|----------|
| **Path-based** `/u/X/` | `mail.google.com/mail/u/1/` | Gmail, Drive, Docs, Calendar, Photos, AI Studio, Gemini, Meet, Cloud Console |
| **Query-based** `authuser=X` | `google.com/search?authuser=1` | Search, Maps, YouTube, NotebookLM, Analytics, Firebase, Ads, Tag Manager |

This extension rewrites those indices to your selected default account using two layers:

1. **`declarativeNetRequest`** — Rewrites `/u/X/` and `authuser=X` in URLs **before** the HTTP request is made. Zero flicker, zero double-loading.
2. **Proactive mode** — Detects bare Google URLs (without any account param) and redirects them to include your selected account.

## Features

- **Global default account** — One click to set which account is used everywhere
- **Per-site overrides** — Use account 0 for YouTube but account 3 for Gmail
- **Quick Switch** — Context-aware popup dropdown detects the current tab's Google service and lets you switch accounts for that specific site instantly
- **Auto-detect accounts** — Discovers logged-in account emails, names, and profile pictures via Google's ListAccounts endpoint
- **Profile pictures** — Popup shows account avatars with initials fallback
- **Auto-refresh** — Current tab automatically refreshes after switching accounts for immediate effect
- **Cookie-based account sync** — Automatically refreshes the account list when you sign in/out of Google (monitors `SID`, `SSID`, `HSID`, `LSID`, `ACCOUNT_CHOOSER` cookies)
- **Fast detection** — Reuses existing Google/YouTube tabs for account detection instead of creating new tabs; falls back to cached accounts when no tabs are available
- **Manual account management** — Add accounts with custom labels (Work, Personal, etc.)
- **gmail.com redirect** — `gmail.com` and `www.gmail.com` are redirected to `mail.google.com/mail/u/X/`
- **Two modes:**
  - **Proactive** (default) — Forces your account on ALL Google URLs, even bare ones
  - **Passive** — Only rewrites URLs that already have `/u/X/` or `authuser=X`
- **Dark / Light theme** — Automatically matches your system or browser color scheme via `prefers-color-scheme`
- **YouTube loop prevention** — Domain-aware cooldown prevents infinite redirect loops on services (like YouTube) that strip `authuser` after processing it
- **30+ Google domains covered** — Including all Workspace, Developer, Ads, and AI services
- **Near-zero performance impact** — `declarativeNetRequest` rules run in the browser's network layer, not in JavaScript

## Installation

1. Clone or download this repository
2. Open `chrome://extensions/` in Chrome/Edge/Brave
3. Enable "Developer mode" (toggle in top-right)
4. Click "Load unpacked"
5. Select the `G-Account-Switcher` folder (the one containing `manifest.json`)

## Usage

1. Click the extension icon in the toolbar
2. Click **🔍 Detect** to auto-discover your logged-in Google accounts (with profile pictures)
3. Select your desired default account by clicking on it — the current tab auto-refreshes
4. Use **Quick Switch** (appears when you're on a Google site) to set per-site overrides directly
5. (Optional) Add more per-site overrides manually in the "Site Overrides" section
6. Choose between **Proactive** and **Passive** mode

## File Structure

```
G-Account-Switcher/
├── manifest.json                 # MV3 manifest
├── src/
│   ├── background.js             # Service worker: rules, cookies, messages
│   ├── lib/
│   │   ├── constants.js          # 30+ Google domain mappings, storage keys
│   │   ├── storage.js            # chrome.storage.sync helpers
│   │   ├── accounts.js           # Account detection (reuses existing tabs)
│   │   ├── rules.js              # declarativeNetRequest rule generator
│   │   └── proactive.js          # Bare URL redirect logic
│   ├── popup/
│   │   ├── popup.html            # Extension popup UI
│   │   ├── popup.css             # Popup styles (light/dark theme)
│   │   └── popup.js              # Popup controller (quick switch, avatars)
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

**Workspace:** Gmail, Google Drive, Google Docs, Sheets, Slides, Forms, Drawings, Google Calendar, Google Contacts, Google Keep, Google Tasks, Google Chat, Google Meet, Google Groups.

**AI:** Gemini, Google AI Studio, NotebookLM.

**Developer & Cloud:** Google Cloud Console, Firebase Console, Google Tag Manager, Looker Studio, Google Search Console.

**Ads & Monetization:** Google Ads, AdSense, AdMob.

**Other:** YouTube, YouTube Studio, Google Search, Google Maps, Google Photos, Google Translate, Google Play Store, Google Admin Console, My Account, Google Analytics, Google Notifications.

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

### YouTube Redirect Loop Prevention
YouTube processes the `authuser` parameter, switches the session via cookies, then strips the parameter and reloads. This would cause the extension to re-add the parameter in an infinite loop. To prevent this, a domain-aware cooldown map suppresses re-redirects to the same host within a 10-second window.

## License

MIT
