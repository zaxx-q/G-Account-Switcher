# G-Account Switcher

A lightweight Manifest V3 Chrome extension that sets your default Google account across **all** Google services — Gmail, YouTube, Drive, Docs, Calendar, AI Studio, Gemini, NotebookLM, Photos, Maps, Search, and more.

## How It Works

Google identifies accounts by a numeric index (0, 1, 2, ...) in URLs via two patterns:

| Pattern | Example | Services |
|---------|---------|----------|
| **Path-based** `/u/X/` | `mail.google.com/mail/u/1/` | Gmail, Drive, Docs, Calendar, Photos, AI Studio, Gemini |
| **Query-based** `authuser=X` | `google.com/search?authuser=1` | Search, Maps, YouTube, NotebookLM |

This extension rewrites those indices to your selected default account using two layers:

1. **`declarativeNetRequest`** — Rewrites `/u/X/` and `authuser=X` in URLs **before** the HTTP request is made. Zero flicker, zero double-loading.
2. **Proactive mode** — Detects bare Google URLs (without any account param) and redirects them to include your selected account.

## Features

- **Global default account** — One click to set which account is used everywhere
- **Per-site overrides** — Use account 0 for YouTube but account 3 for Gmail
- **Auto-detect accounts** — Discovers logged-in account emails and names via Google's ListAccounts endpoint (injected into a temporary `accounts.google.com` tab to access first-party cookies)
- **Manual account management** — Add accounts with custom labels (Work, Personal, etc.)
- **Two modes:**
  - **Proactive** (default) — Forces your account on ALL Google URLs, even bare ones
  - **Passive** — Only rewrites URLs that already have `/u/X/` or `authuser=X`
- **Dark / Light theme** — Automatically matches your system or browser color scheme via `prefers-color-scheme`
- **YouTube loop prevention** — Domain-aware cooldown prevents infinite redirect loops on services (like YouTube) that strip `authuser` after processing it
- **20+ Google domains covered** — Including Gmail, YouTube, Drive, Docs, Sheets, Calendar, Photos, Maps, Search, Meet, Chat, Keep, AI Studio, Gemini, NotebookLM, Cloud Console, and more
- **Near-zero performance impact** — `declarativeNetRequest` rules run in the browser's network layer, not in JavaScript

## Installation

1. Clone or download this repository
2. Open `chrome://extensions/` in Chrome/Edge/Brave
3. Enable "Developer mode" (toggle in top-right)
4. Click "Load unpacked"
5. Select the `G-Account-Switcher` folder (the one containing `manifest.json`)

## Usage

1. Click the extension icon in the toolbar
2. Click **🔍 Detect** to auto-discover your logged-in Google accounts
3. Select your desired default account by clicking on it
4. (Optional) Add per-site overrides for specific Google services
5. Choose between **Proactive** and **Passive** mode

## File Structure

```
G-Account-Switcher/
├── manifest.json                 # MV3 manifest
├── src/
│   ├── background.js             # Service worker entry point
│   ├── lib/
│   │   ├── constants.js          # Google domain mappings, storage keys
│   │   ├── storage.js            # chrome.storage.sync helpers
│   │   ├── accounts.js           # Account detection via ListAccounts API
│   │   ├── rules.js              # declarativeNetRequest rule generator
│   │   └── proactive.js          # Bare URL redirect logic
│   ├── popup/
│   │   ├── popup.html            # Extension popup UI
│   │   ├── popup.css             # Popup styles (light/dark theme)
│   │   └── popup.js              # Popup controller
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
| `tabs` | Detect bare Google URLs for proactive mode |
| `scripting` | Inject account detection fetch into a Google tab (required for first-party cookie access) |
| `declarativeNetRequest` | Rewrite `/u/X/` and `authuser=X` pre-request |
| `host_permissions: *.google.com, *.youtube.com` | Match and redirect Google service URLs |

## Covered Services

Gmail, Google Drive, Google Docs/Sheets/Slides/Forms, Google Calendar, Google Photos, YouTube, YouTube Studio, Google Maps, Google Search (+ AI Mode), Google Meet, Google Chat, Google Keep, Google Groups, Google Admin Console, Google Analytics, Google Cloud Console, Google Play Store, Google AI Studio, Gemini, NotebookLM, Google Contacts, Google Notifications, My Account.

**Excluded:**
- `accounts.google.com` — Login/logout flows are never modified.
- `music.youtube.com` — YouTube Music uses cookie-based sessions and does not support `authuser` parameter switching.

## Technical Notes

### Account Detection
The extension detects logged-in accounts by fetching Google's internal `ListAccounts` endpoint. Since MV3 service workers cannot send first-party cookies, the fetch is injected via `chrome.scripting.executeScript` into a temporary `accounts.google.com` tab (created in the background and closed automatically). The response may come as XSSI-prefixed JSON or HTML containing hex-escaped JSON in a `postMessage` call — both formats are parsed.

### YouTube Redirect Loop Prevention
YouTube processes the `authuser` parameter, switches the session via cookies, then strips the parameter and reloads. This would cause the extension to re-add the parameter in an infinite loop. To prevent this, a domain-aware cooldown map suppresses re-redirects to the same host within a 10-second window.

## License

MIT
