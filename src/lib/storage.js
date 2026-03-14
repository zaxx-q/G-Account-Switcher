/**
 * Chrome storage helpers with Promise wrappers.
 */
import { STORAGE_DEFAULTS, STORAGE_KEYS } from './constants.js';

/**
 * Get values from chrome.storage.sync with defaults.
 * @param {string|string[]} keys - Key(s) to retrieve
 * @returns {Promise<Object>}
 */
export function getStorage(keys) {
  return new Promise((resolve, reject) => {
    // Build defaults subset for requested keys
    const defaults = {};
    const keyList = Array.isArray(keys) ? keys : [keys];
    for (const key of keyList) {
      if (key in STORAGE_DEFAULTS) {
        defaults[key] = STORAGE_DEFAULTS[key];
      }
    }
    chrome.storage.sync.get(defaults, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(result);
      }
    });
  });
}

/**
 * Set values in chrome.storage.sync.
 * @param {Object} items - Key-value pairs to store
 * @returns {Promise<void>}
 */
export function setStorage(items) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.set(items, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
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
