# Contributing

Thanks for helping out. The project has no runtime dependencies and no compile
step, so getting started is quick.

## Setup

You need Node.js 20 or newer.

```bash
git clone <this repository>
cd G-Account-Switcher
npm test          # unit tests
npm run build     # writes dist/chrome, dist/firefox and the zip packages
```

`npm run check` runs the tests and then the build.

`build.js` refuses to produce a package when the versions in `manifest.json`, `manifest.firefox.json` and `package.json` disagree, or when a manifest, HTML file or `import` points at a file that does not exist. The zips are reproducible: building the same sources twice gives byte-identical archives.

Load `dist/chrome/` as an unpacked extension in Chrome, Edge or Brave, or
`dist/firefox/manifest.json` as a temporary add-on in Firefox (see the
[README](README.md#installation)).

## How the code is organised

The full design (file tree, rule priorities, the redirect-loop tracker, account
detection) is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). In short:

| Module                    | Role                                                                          | Needs a browser? |
| ------------------------- | ----------------------------------------------------------------------------- | ---------------- |
| `lib/constants.js`        | The list of Google services and how each identifies the account               | No               |
| `lib/domains.js`          | Which service does a URL belong to?                                           | No               |
| `lib/account-url.js`      | Read or rewrite the account index in a URL                                    | No               |
| `lib/parse-accounts.js`   | Parse Google's account list; merge it with stored labels                      | No               |
| `lib/rules.js`            | Build the `declarativeNetRequest` rules                                       | Only `applyRules` |
| `lib/proactive.js`        | Redirect bare URLs in a tab                                                   | Yes              |
| `lib/tab-state.js`        | Per-tab "already redirected" tracker, kept in `storage.session`               | Yes              |
| `lib/accounts.js`         | Fetch the account list from inside a Google page                              | Yes              |
| `background.js`, `popup/` | Wiring and UI                                                                 | Yes              |

Keep logic in the pure modules wherever you can. They are easy to test, and the
unit tests cover them thoroughly. The browser-facing modules are tested against
a small `chrome` mock (`test/helpers/chrome-mock.js`).

## Things that are easy to get wrong

- **The background worker is unloaded after ~30 seconds idle.** Never keep
  state only in a variable. Register listeners synchronously at the top of
  `background.js`, and make them wait for settings (`settingsReady`) before
  using them.
- **Do not run two `updateDynamicRules` calls at once.** Go through
  `applyRules()`, which queues them.
- **No lookahead or backreferences in `regexFilter`.** The engine is RE2. The
  rules tests check this.
- **Storage is `chrome.storage.local`.** Do not use `storage.sync`: the account
  list holds e-mail addresses and differs per device. Read and write through
  `lib/storage.js`. Changing what is stored affects existing users' data, so
  say what happens to it in the changelog.
- **Account indexes are positions.** Google renumbers accounts on sign-out.
  Match accounts by e-mail, not by index, when you merge.

## Adding a Google service

Add an entry to `GOOGLE_DOMAINS` in `src/lib/constants.js`:

- `type: "path"` if the service uses `/u/N/`, `type: "query"` if it uses
  `?authuser=N`.
- Add `pathPrefix` when several services share a host, and `siteKey` when each
  should get its own setting. Add `queryMatch` to tell services apart by a
  query parameter.
- Make sure the host is covered by `host_permissions` in **both** manifests.

`npm test` fails if the entry is malformed, shadowed by another entry, or not
covered by the manifests. Then add a URL to `test/domains.test.js`.

## Releasing

1. Update the version in `manifest.json`, `manifest.firefox.json` and
   `package.json`. `npm run build` fails if they differ.
2. Move the entries under "Unreleased" in `CHANGELOG.md` to the new version.
3. Tag the release (`git tag v1.2.3 && git push --tags`). The release workflow
   builds both packages and attaches them to a GitHub release.

Changing `browser_specific_settings.gecko.id` would make Firefox treat the
extension as a different add-on, so leave it alone once it has been published.

## Style

Tabs for indentation, double quotes, trailing commas. `.editorconfig` and
`biome.json` capture this; `npm run format` applies it.
