# Privacy

G-Account Switcher runs entirely in your browser. It has no server, no
analytics, no telemetry and no remote code. Nothing is sent to the developer
or to any third party.

## What it stores

| Data                                                                             | Where             | Why                                                     |
| -------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------- |
| Settings: on/off, mode, default account, per-site account choices                | `storage.local`   | Remember your configuration                             |
| Account list: position, e-mail address, display name, profile-picture URL, label | `storage.local`   | Show your accounts in the popup and keep your labels    |
| Which tabs were already redirected (tab ID → account)                            | `storage.session` | Prevent redirect loops; cleared when the browser closes |

`storage.local` stays on this device. The extension does not use the browser's
synchronised storage, so your settings and the e-mail addresses in the account
list are not copied to your other devices by the extension.

### Data from versions before 3.3.0

Earlier versions kept the same data in the browser's synchronised storage
(`storage.sync`), which the browser vendor (Google for Chrome and Edge, Mozilla
for Firefox) may copy to your other signed-in devices under its own privacy
policy. Version 3.3.0 does not carry that data over; it deletes it on
install/update. Your settings start from their defaults, and **Detect**
re-fetches your account list.

## What it reads

- **Your Google account list.** To discover your accounts, the extension
  fetches `https://accounts.google.com/ListAccounts` from inside a Google page,
  using the session you already have. The response is parsed locally and only
  the fields listed above are kept. This is the extension's only network
  request.
- **Cookie change events.** It is notified when a Google sign-in cookie
  (`SID`, `SSID`, `HSID`, `LSID`, `ACCOUNT_CHOOSER`) changes, so it knows to
  refresh the account list. It looks at the cookie's name and domain only,
  never its value.
- **Tab URLs**, to recognise Google pages and (in proactive mode) add the
  account to bare URLs. URLs are not stored or transmitted.

Profile pictures in the popup are loaded from the URLs Google returned, without
a referrer.

## Permissions

Each permission and what it is used for is listed in the
[README](README.md#permissions). The extension is only granted access to
`*.google.com`, `*.youtube.com` and `*.gmail.com`.

## Questions

Open an issue in this repository.
