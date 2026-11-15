import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { SITE_DISABLED } from "../src/lib/constants.js";
import {
	applyForceSwitch,
	cleanupTab,
	clearSyncedState,
	handleProactiveRedirect,
	resolveTargetAccount,
	restoreTabSyncStates,
} from "../src/lib/proactive.js";
import { _resetForTests, loadTabState } from "../src/lib/tab-state.js";
import { findMatchingDomain } from "../src/lib/domains.js";
import { installChrome, uninstallChrome } from "./helpers/chrome-mock.js";

const MAIL = "https://mail.google.com/mail/";
const YT = "https://www.youtube.com/watch?v=abc";

const originalLog = console.log;
let mock;
beforeEach(() => {
	_resetForTests();
	mock = installChrome();
	console.log = () => {}; // keep test output quiet
});
afterEach(() => {
	console.log = originalLog;
	uninstallChrome();
});

/** Simulate the service worker being unloaded and started again. */
function restartWorker() {
	_resetForTests();
}

describe("resolveTargetAccount", () => {
	const mail = () => findMatchingDomain(MAIL);

	it("uses the site setting when there is one", () => {
		assert.deepEqual(resolveTargetAccount(mail(), { "mail.google.com": 3 }, 0, false), { key: "mail.google.com", accountNum: 3 });
	});
	it("falls back to the global default only when it is enabled", () => {
		assert.equal(resolveTargetAccount(mail(), {}, 2, false), null);
		assert.deepEqual(resolveTargetAccount(mail(), {}, 2, true), { key: "mail.google.com", accountNum: 2 });
	});
	it("returns null for a disabled site, even with the global default on", () => {
		assert.equal(resolveTargetAccount(mail(), { "mail.google.com": SITE_DISABLED }, 2, true), null);
	});
	it("tolerates missing settings", () => {
		assert.equal(resolveTargetAccount(mail(), undefined, 0, false), null);
	});
});

describe("handleProactiveRedirect", () => {
	const settings = { "mail.google.com": 3, "www.youtube.com": 2 };

	it("redirects a bare URL to the configured account", async () => {
		assert.equal(await handleProactiveRedirect(1, MAIL, 0, settings, false), true);
		assert.deepEqual(mock.tabUpdates, [{ tabId: 1, url: "https://mail.google.com/mail/u/3/" }]);
	});

	it("does not redirect the same tab and site twice", async () => {
		await handleProactiveRedirect(1, MAIL, 0, settings, false);
		assert.equal(await handleProactiveRedirect(1, MAIL, 0, settings, false), false);
		assert.equal(mock.tabUpdates.length, 1);
	});

	it("handles a site that strips authuser= without looping", async () => {
		await handleProactiveRedirect(7, YT, 0, settings, false);
		// YouTube loads the page, then strips the parameter → a bare URL again
		assert.equal(await handleProactiveRedirect(7, YT, 0, settings, false), false);
		assert.equal(mock.tabUpdates.length, 1);
		assert.match(mock.tabUpdates[0].url, /authuser=2/);
	});

	it("treats each tab independently", async () => {
		await handleProactiveRedirect(1, MAIL, 0, settings, false);
		assert.equal(await handleProactiveRedirect(2, MAIL, 0, settings, false), true);
		assert.equal(mock.tabUpdates.length, 2);
	});

	it("records, but does not redirect, a URL that is already correct", async () => {
		assert.equal(await handleProactiveRedirect(1, "https://mail.google.com/mail/u/3/", 0, settings, false), false);
		assert.equal(mock.tabUpdates.length, 0);
	});

	it("corrects a wrong account on the first visit", async () => {
		assert.equal(await handleProactiveRedirect(1, "https://mail.google.com/mail/u/0/", 0, settings, false), true);
		assert.equal(mock.tabUpdates[0].url, "https://mail.google.com/mail/u/3/");
	});

	it("respects a different account once the tab has been synced", async () => {
		await handleProactiveRedirect(1, MAIL, 0, settings, false);
		assert.equal(await handleProactiveRedirect(1, "https://mail.google.com/mail/u/1/", 0, settings, false), false);
	});

	it("does nothing without a setting when the global default is off", async () => {
		assert.equal(await handleProactiveRedirect(1, "https://drive.google.com/drive/my-drive", 0, settings, false), false);
	});

	it("uses the global default when enabled", async () => {
		assert.equal(await handleProactiveRedirect(1, "https://drive.google.com/drive/my-drive", 5, {}, true), true);
		assert.equal(mock.tabUpdates[0].url, "https://drive.google.com/drive/u/5/my-drive");
	});

	it("does nothing for a disabled site", async () => {
		assert.equal(await handleProactiveRedirect(1, MAIL, 0, { "mail.google.com": SITE_DISABLED }, true), false);
	});

	it("ignores non-Google and excluded URLs", async () => {
		for (const url of ["https://example.com/", "https://accounts.google.com/signin", "https://music.youtube.com/", "garbage"]) {
			assert.equal(await handleProactiveRedirect(1, url, 0, {}, true), false, url);
		}
	});

	it("forgets the sync if the navigation fails, so a later attempt can retry", async () => {
		mock.failNextTabUpdate = true;
		const origError = console.error;
		console.error = () => {};
		assert.equal(await handleProactiveRedirect(1, MAIL, 0, settings, false), false);
		console.error = origError;
		assert.equal(await handleProactiveRedirect(1, MAIL, 0, settings, false), true);
	});
});

describe("state survives a service-worker restart", () => {
	const settings = { "www.youtube.com": 2 };

	it("does not re-redirect a synced tab after the worker restarts", async () => {
		await handleProactiveRedirect(7, YT, 0, settings, false);
		assert.equal(mock.tabUpdates.length, 1);

		restartWorker(); // in-memory state gone; storage.session remains

		assert.equal(await handleProactiveRedirect(7, YT, 0, settings, false), false);
		assert.equal(mock.tabUpdates.length, 1);
	});

	it("still redirects a tab that was never synced after a restart", async () => {
		await handleProactiveRedirect(7, YT, 0, settings, false);
		restartWorker();
		assert.equal(await handleProactiveRedirect(8, YT, 0, settings, false), true);
	});

	it("persists the tracker in storage.session", async () => {
		await handleProactiveRedirect(7, YT, 0, settings, false);
		assert.deepEqual(mock.sessionData.tabSyncedStates, { "7:www.youtube.com": 2 });
	});

	it("clearSyncedState wins over not-yet-loaded persisted state", async () => {
		await handleProactiveRedirect(7, YT, 0, settings, false);
		restartWorker();
		clearSyncedState(); // before anything has loaded the old state
		assert.equal(await handleProactiveRedirect(7, YT, 0, settings, false), true);
		assert.equal(mock.tabUpdates.length, 2);
	});

	it("a clear during an in-flight read is not undone by that read", async () => {
		await handleProactiveRedirect(7, YT, 0, settings, false);
		restartWorker();
		mock.sessionGetDelay = 20; // the read will still be running when we clear
		const loading = loadTabState();
		clearSyncedState();
		await loading;
		mock.sessionGetDelay = 0;
		assert.equal(await handleProactiveRedirect(7, YT, 0, settings, false), true);
		assert.equal(mock.tabUpdates.length, 2);
	});

	it("cleanupTab removes only that tab, including persisted entries", async () => {
		await handleProactiveRedirect(7, YT, 0, settings, false);
		await handleProactiveRedirect(8, YT, 0, settings, false);
		restartWorker();
		await cleanupTab(7);
		assert.deepEqual(mock.sessionData.tabSyncedStates, { "8:www.youtube.com": 2 });
	});

	it("falls back to memory-only when storage.session is unavailable", async () => {
		uninstallChrome();
		mock = installChrome({ withSession: false });
		_resetForTests();
		await handleProactiveRedirect(7, YT, 0, settings, false);
		assert.equal(await handleProactiveRedirect(7, YT, 0, settings, false), false);
		assert.equal(mock.tabUpdates.length, 1);
	});
});

describe("restoreTabSyncStates", () => {
	it("marks open, configured Google tabs as synced and leaves others alone", async () => {
		mock.openTabs = [
			{ id: 1, url: YT },
			{ id: 2, url: MAIL },
			{ id: 3, url: "https://example.com/" },
			{ id: 4 }, // no url permission / blank tab
		];
		await restoreTabSyncStates(0, { "www.youtube.com": 2 }, false);
		await loadTabState();
		assert.deepEqual(mock.sessionData.tabSyncedStates, { "1:www.youtube.com": 2 });
		// An already-open YouTube tab is therefore not redirected later
		assert.equal(await handleProactiveRedirect(1, YT, 0, { "www.youtube.com": 2 }, false), false);
		// A tab that was not restored still is
		assert.equal(await handleProactiveRedirect(9, YT, 0, { "www.youtube.com": 2 }, false), true);
	});
});

describe("applyForceSwitch", () => {
	it("switches immediately, replacing an existing account", async () => {
		const done = await applyForceSwitch(1, "https://mail.google.com/mail/u/0/#inbox", 0, { "mail.google.com": 4 }, false);
		assert.equal(done, true);
		assert.equal(mock.tabUpdates[0].url, "https://mail.google.com/mail/u/4/#inbox");
	});

	it("overwrites a non-numeric authuser (the user asked for this)", async () => {
		await applyForceSwitch(1, "https://www.youtube.com/?authuser=me@example.com", 0, { "www.youtube.com": 2 }, false);
		assert.equal(mock.tabUpdates[0].url, "https://www.youtube.com/?authuser=2");
	});

	it("returns false when already on the right account or not configured", async () => {
		assert.equal(await applyForceSwitch(1, "https://mail.google.com/mail/u/4/", 0, { "mail.google.com": 4 }, false), false);
		assert.equal(await applyForceSwitch(1, MAIL, 0, {}, false), false);
		assert.equal(await applyForceSwitch(1, "https://example.com/", 0, {}, true), false);
	});

	it("records the switch so proactive mode does not immediately redo it", async () => {
		await applyForceSwitch(1, YT, 0, { "www.youtube.com": 2 }, false);
		assert.equal(await handleProactiveRedirect(1, YT, 0, { "www.youtube.com": 2 }, false), false);
	});
});
