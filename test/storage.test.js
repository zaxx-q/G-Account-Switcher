import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { STORAGE_DEFAULTS } from "../src/lib/constants.js";
import {
	getAllSettings,
	getStorage,
	removeLegacySyncData,
	setSetting,
	setStorage,
} from "../src/lib/storage.js";
import { installChrome, uninstallChrome } from "./helpers/chrome-mock.js";

let mock;
beforeEach(() => {
	mock = installChrome();
});
afterEach(() => uninstallChrome());

describe("storage helpers", () => {
	it("read and write chrome.storage.local, never sync", async () => {
		await setStorage({ defaultAccount: 4 });
		assert.equal(mock.localData.defaultAccount, 4);
		assert.deepEqual(mock.syncData, {});
		mock.syncData.mode = "passive"; // must be ignored
		assert.equal((await getStorage("mode")).mode, STORAGE_DEFAULTS.mode);
	});

	it("fill in defaults for missing keys", async () => {
		const result = await getStorage(["enabled", "siteSettings"]);
		assert.deepEqual(result, {
			enabled: STORAGE_DEFAULTS.enabled,
			siteSettings: STORAGE_DEFAULTS.siteSettings,
		});
	});

	it("prefer stored values over defaults", async () => {
		await setStorage({ mode: "passive", siteSettings: { "mail.google.com": 2 } });
		const result = await getStorage(["mode", "siteSettings"]);
		assert.equal(result.mode, "passive");
		assert.deepEqual(result.siteSettings, { "mail.google.com": 2 });
	});

	it("accept a single key as a string", async () => {
		assert.deepEqual(await getStorage("accounts"), { accounts: [] });
	});

	it("getAllSettings returns every setting", async () => {
		const all = await getAllSettings();
		for (const key of ["enabled", "mode", "defaultAccount", "globalAccountEnabled", "accounts", "siteSettings"]) {
			assert.ok(key in all, key);
		}
	});

	it("setSetting writes one key", async () => {
		await setSetting("defaultAccount", 7);
		assert.equal(mock.localData.defaultAccount, 7);
	});

	it("surface storage errors to the caller", async () => {
		mock.failStorageReads = true;
		await assert.rejects(getStorage("mode"), /storage unavailable/);
	});
});

describe("removeLegacySyncData", () => {
	it("removes every key an older version kept in sync, including the v2 key", async () => {
		Object.assign(mock.syncData, {
			enabled: true,
			mode: "proactive",
			defaultAccount: 2,
			globalAccountEnabled: true,
			accounts: [{ index: 0, email: "a@example.com" }],
			siteSettings: { "mail.google.com": 1 },
			siteOverrides: { "www.youtube.com": 2 },
		});
		await removeLegacySyncData();
		assert.deepEqual(mock.syncData, {});
	});

	it("does not copy the old data into local storage", async () => {
		mock.syncData.siteSettings = { "mail.google.com": 1 };
		await removeLegacySyncData();
		assert.deepEqual(mock.localData, {});
		assert.deepEqual((await getStorage("siteSettings")).siteSettings, {});
	});

	it("leaves local storage untouched", async () => {
		await setStorage({ mode: "passive", siteSettings: { "mail.google.com": 3 } });
		mock.syncData.mode = "proactive";
		await removeLegacySyncData();
		assert.equal(mock.localData.mode, "passive");
		assert.deepEqual(mock.localData.siteSettings, { "mail.google.com": 3 });
	});

	it("leaves keys it does not own alone", async () => {
		mock.syncData.somethingElse = 1;
		await removeLegacySyncData();
		assert.deepEqual(mock.syncData, { somethingElse: 1 });
	});

	it("is fine when there is nothing to remove", async () => {
		await assert.doesNotReject(removeLegacySyncData());
	});
});
