# G-Account Switcher

A lightweight Manifest V3 browser extension for **Chrome, other Chromium-based browsers (Edge, Brave) and Firefox** that lets you assign specific Google accounts to individual Google services — Gmail, YouTube, Drive, Docs, Calendar, AI Studio, Gemini, Gemini Notebook (NotebookLM), Firebase, Google Ads, Analytics, and 30+ more. Optionally set a global default across all services.

## How It Works

Google identifies accounts by a numeric index (0, 1, 2, ...) in URLs via two patterns:

| Pattern                      | Example                        | Services                                                                                                                                                                                                                 |
| ---------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Path-based** `/u/X/`       | `mail.google.com/mail/u/1/`    | Gmail, Drive (folders), Calendar, Contacts, Keep, Chat, Tasks, Photos, Groups, Gemini, AI Studio, Cloud Console, Admin Console, My Account, Notifications, Translate                                                     |
| **Query-based** `authuser=X` | `google.com/search?authuser=1` | Search, Maps, AI Mode, Docs, Sheets, Slides, Forms, Drawings, YouTube (+ Studio), Drive (file links), Meet, NotebookLM, Play Store, Analytics, Tag Manager, Looker Studio, Search Console, Ads, AdSense, AdMob, Firebase |

This extension rewrites those indices using two layers (details in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)):

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
- **Automatic account sync** — Refreshes the account list when you sign in or out of Google
- **Fast detection** — Reuses an open Google/YouTube tab; if you click **Detect** with none open, a short-lived background tab is used and closed again
- **Manual account management** — Add accounts with custom labels (Work, Personal, etc.). Labels follow the account's e-mail address, so they stay with the right account when Google renumbers your accounts
- **gmail.com redirect** — `gmail.com` and `www.gmail.com` are redirected to `mail.google.com/mail/u/X/`
- **Per-site disable** — Disable redirection entirely for specific sites
- **Two modes:**
  - **Proactive** (default) — Forces configured account on ALL matching Google URLs, even bare ones
  - **Passive** — Only rewrites URLs that already have `/u/X/` or `authuser=X`
- **Dark / Light theme** — Automatically matches your system or browser color scheme via `prefers-color-scheme`
- **Per-tab redirect tracking** — Proactive redirects only fire on first visit to a domain in each tab, so you don't lose progress on YouTube, Play Store, Docs and similar services
- **30+ Google domains covered** — Including all Workspace, Developer, Ads, and AI services. Sub-service disambiguation for Maps and AI mode on `www.google.com`, and all Docs suite services on `docs.google.com`
- **Near-zero performance impact** — Account rewriting happens in the browser's network layer, not in JavaScript
- **Local-only settings** — Your settings and account list stay in this browser and are not synced to other devices. If you used a version before 3.3.0, settings start fresh after updating: pick your accounts again (**Detect** re-fetches the account list)

## Installation

### Firefox

Install directly from [Firefox Add-ons (AMO)](https://addons.mozilla.org/en-US/firefox/addon/g-account-switcher/).

For manual/development loading:

1. Clone or download this repository
2. Run `node build.js`
3. Open `about:debugging#/runtime/this-firefox`
4. Click "Load Temporary Add-on..."
5. Select `dist/firefox/manifest.json`

### Chrome / Edge / Brave (Unpacked)

1. Clone or download this repository
2. Run `node build.js` (or use the `dist/chrome/` folder)
3. Open `chrome://extensions/`
4. Enable "Developer mode"
5. Click "Load unpacked" → select the `dist/chrome/` folder

### Browser support

| Browser               | Minimum version | Manifest used           |
| --------------------- | --------------- | ----------------------- |
| Chrome / Edge / Brave | 102             | `manifest.json`         |
| Firefox               | 142             | `manifest.firefox.json` |

## Usage

1. Click the extension icon in the toolbar
2. Click **🔍 Detect** to auto-discover your logged-in Google accounts (with profile pictures)
3. Navigate to a Google site — the **Current Site** panel appears with clickable account avatars
4. Click an avatar to assign that account to the current site — the page auto-refreshes
5. Configure additional sites via the **Site Settings** section (click **+ Add** or use inline editing)
6. (Optional) Expand the **Global Default** section and enable it to set a fallback account for all unconfigured sites
7. Choose between **Proactive** and **Passive** mode at the bottom of the popup

## Permissions

| Permission                                                   | Why                                                                                              |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `storage`                                                    | Save account settings and preferences; keep per-tab redirect state for the browser session       |
| `tabs`                                                       | Detect bare Google URLs for proactive mode; find existing Google tabs for fast account detection |
| `scripting`                                                  | Inject account detection fetch into a Google tab (required for first-party cookie access)        |
| `declarativeNetRequest`                                      | Rewrite `/u/X/` and `authuser=X` pre-request                                                     |
| `cookies`                                                    | Monitor Google auth cookie changes to auto-refresh the account list on sign-in/out               |
| `host_permissions: *.google.com, *.youtube.com, *.gmail.com` | Match and redirect Google service URLs                                                           |

## Covered Services

**Workspace:** Gmail, Google Drive, Google Docs, Sheets, Slides, Drawings, Google Calendar, Google Contacts, Google Keep, Google Tasks, Google Chat, Google Meet, Google Groups, Google Forms.

**AI:** Gemini, Google AI Studio, Gemini Notebook (NotebookLM), Google AI Mode (Search with `udm=50`).

**Developer & Cloud:** Google Cloud Console, Firebase Console, Google Tag Manager, Looker Studio, Google Search Console.

**Ads & Monetization:** Google Ads, AdSense, AdMob.

**Other:** YouTube, YouTube Studio, Google Search, Google Maps, Google Photos, Google Translate, Google Play Store, Google Admin Console, My Account, Google Analytics, Google Notifications.

**Excluded:**

- `accounts.google.com` — Login/logout flows are never modified.
- `music.youtube.com` — YouTube Music uses cookie-based sessions and does not support `authuser` parameter switching.

**Special Redirects:**

- `gmail.com` / `www.gmail.com` → `mail.google.com/mail/u/X/`

## Contributing

Build, test and release instructions are in [CONTRIBUTING.md](CONTRIBUTING.md); how the extension works internally is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Privacy

The extension has no server, analytics or telemetry. Its only network request is Google's own `ListAccounts` endpoint, fetched from inside a Google page with your existing session. See [PRIVACY.md](PRIVACY.md) for what is stored and why each permission is needed.

## License

[MIT](LICENSE)
