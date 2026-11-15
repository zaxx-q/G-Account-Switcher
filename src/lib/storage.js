/**
 * Storage helpers.
 *
 * Everything lives in chrome.storage.local: the account list (e-mail
 * addresses) describes this browser's own Google sign-ins, so it should not be
 * copied to other devices, and local storage has none of sync's small quotas.
 * Versions before 3.3.0 used chrome.storage.sync; that data is not carried over
 * and is removed on install/update (see removeLegacySyncData).
 */
import { STORAGE_DEFAULTS, STORAGE_KEYS } from "./constants.js";

/**
 * Get values from chrome.storage.local, filling in defaults.
 * @param {string|string[]} keys - Key(s) to retrieve
 * @returns {Promise<Object>}
 */
export function getStorage(keys) {
	// Build defaults subset for requested keys
	const defaults = {};
	for (const key of Array.isArray(keys) ? keys : [keys]) {
		if (key in STORAGE_DEFAULTS) {
			defaults[key] = STORAGE_DEFAULTS[key];
		}
	}
	return chrome.storage.local.get(defaults);
}

/**
 * Set values in chrome.storage.local.
 * @param {Object} items - Key-value pairs to store
 * @returns {Promise<void>}
 */
export function setStorage(items) {
	return chrome.storage.local.set(items);
}

/**
 * Get all settings at once.
 * @returns {Promise<Object>}
 */
export async function getAllSettings() {
	return getStorage(Object.values(STORAGE_KEYS));
}

/**
 * Update a single setting.
 * @param {string} key
 * @param {*} value
 * @returns {Promise<void>}
 */
export async function setSetting(key, value) {
	return setStorage({ [key]: value });
}

// Every key a version before 3.3.0 could have left in chrome.storage.sync
const LEGACY_SYNC_KEYS = [...Object.values(STORAGE_KEYS), "siteOverrides"];

/**
 * Delete the data versions before 3.3.0 kept in chrome.storage.sync. It is not
 * copied to local storage: settings start from their defaults and the account
 * list is re-fetched with Detect. Removing it stops the e-mail addresses in the
 * old account list lingering in the browser's sync storage.
 *
 * Only this extension's own keys are touched.
 * @returns {Promise<void>}
 */
export function removeLegacySyncData() {
	return chrome.storage.sync.remove(LEGACY_SYNC_KEYS);
}
