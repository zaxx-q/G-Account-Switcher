# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [3.3.1] - 2026-11-25
 
### Fixed

- **Google Meet now uses `authuser=N` on every URL instead of `/u/N/`.** The
  home page and bare meeting codes were being rewritten to
  `meet.google.com/u/N/...`, and a link that already carried `authuser=` ended
  up with both. Existing Meet site settings are unaffected. `/u/N/` URLs on
  Meet are no longer rewritten.

## [3.3.0] - 2026-11-15

### Fixed

- **AI Studio was treated as a query-based site**, so its `/u/N/` URLs were
  not rewritten by the network rules. It is now path-based, like Gemini.
- **Proactive redirects were occasionally skipped right after the background
  worker restarted.** The worker is unloaded when idle; the navigation that
  woke it could be handled before settings had loaded and was silently
  dropped. Listeners now wait for settings first.
- **The per-tab redirect tracker is now persisted** (`storage.session`) rather
  than rebuilt from the open tabs on every worker start. The old rebuild could
  mark a tab that had just navigated to a bare URL as "already synced", which
  also suppressed its redirect.
- **Two quick settings changes could make rule updates fail** with
  `Rule with id N does not have a unique ID`, aborting the rest of the change
  handler (badge update, tab-state reset, popup notification). Rule updates are
  now queued.
- **Account labels followed the account's position instead of its e-mail.**
  After signing out of one account, the others shifted down and inherited the
  wrong label. Labels are now matched by e-mail.
- **Detect did nothing when no Google tab was open**, which is also the
  first-run situation. Clicking Detect now opens a short-lived background tab
  when it has to. Automatic refreshes still never open tabs.
- Path prefixes now match at a path boundary (`/maps` no longer matches
  `/mapsfoo`), in both the URL matcher and the generated rules.
- An account index inside a search query (`?q=…/u/2/…`) is no longer mistaken
  for the current account on query-type sites.
- Host checks use proper suffix matching instead of `includes("google.com")`,
  so `notgoogle.com` is not treated as a Google site.
- Detect's error message no longer blames being signed out when the cause may
  be something else.

### Changed

- **Settings and the account list moved from `chrome.storage.sync` to
  `chrome.storage.local`.** The account list holds e-mail addresses and
  describes this browser's sign-ins, so it should not be copied between
  devices. **Existing settings are not carried over:** on install/update the
  old synced data is deleted, and users start from the defaults (no redirects
  until they pick accounts again). Use **Detect** to re-fetch the account list.
  Devices still on an older version lose their synced settings once another
  device updates. Site settings are per device from now on.
- Rule priorities are now explicit (`tier + specificity`), so overlapping
  rules such as Maps and Search never tie. Previously the result depended on
  rule order.
- Account parsing moved out of the function injected into web pages into a
  testable module; the Format B (HTML/postMessage) decoder now handles
  `\uXXXX`, escaped quotes and backslashes in one pass.
- Three copies of the URL-rewrite logic and two copies of the domain matcher
  are now one implementation each.
- Editing an account label is done in place instead of with `window.prompt()`,
  which is unreliable in extension popups.
- Keyboard and screen-reader support in the popup: the Global Default header
  is focusable and operable with Enter/Space, icon buttons have accessible
  names, and keyboard focus is visible.
- `build.js` validates before packaging, checks that the manifests and
  `package.json` agree on the version, checks that manifest, HTML and `import`
  references resolve, no longer needs the `zip` command, and produces
  reproducible archives.
- Chrome manifest declares `minimum_chrome_version` 102 (`storage.session`).
- Removed the redundant `www.gmail.com` redirect rule (`||gmail.com^` already
  covers subdomains) and an unused, incorrect host-pattern constant.

### Added

- Unit tests (`npm test`), GitHub Actions CI and a release workflow.
- `docs/ARCHITECTURE.md`: the technical notes, file tree and design rationale
  that used to make up most of the README.
- `package.json`, `LICENSE`, `PRIVACY.md`, `CONTRIBUTING.md`, `.editorconfig`,
  `biome.json`, and a bug-report issue template.

### Documentation

- The README is now a user-facing overview. Technical notes moved to
  `docs/ARCHITECTURE.md`; build and release steps are in `CONTRIBUTING.md`.
- README now says the extension supports Chrome, other Chromium browsers and
  Firefox (it previously said "Chrome extension"), lists the minimum browser
  versions, and has an accurate service table and file tree (the `tools/`
  folder it described does not exist).
- README no longer claims that a manual account switch inside a site is
  respected: for configured sites the network-layer rules rewrite it back.

## [3.2.1]

Baseline of this changelog. Earlier history was not recorded here.
