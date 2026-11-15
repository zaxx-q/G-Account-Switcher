/**
 * Per-tab sync tracker, persisted in `chrome.storage.session`.
 *
 * Maps "tabId:siteKey" → accountNum. Once a tab has been redirected to (or
 * found on) the configured account for a site, it is never redirected for
 * that site again until the user changes settings (clear) or closes the tab.
 * This is what stops redirect loops on services that strip `authuser=` from
 * the URL after reading it (YouTube, Play Store, the Docs suite).
 *
 * Why storage.session: MV3 service workers (and Firefox event pages) are
 * unloaded after ~30 seconds of inactivity, which wipes any in-memory state.
 * Session storage survives that, but is cleared when the browser closes —
 * which is exactly right, because tab IDs are not stable across restarts.
 *
 * The in-memory Map is a write-through cache. If `storage.session` is not
 * available the tracker degrades to memory-only.
 */

const SESSION_KEY = "tabSyncedStates";

const states = new Map();
let loading = null;
// Bumped by clearTabState() so a storage read that was already in flight
// when the tracker was cleared cannot merge its stale snapshot back in.
let generation = 0;

function sessionArea() {
	try {
		return globalThis.chrome?.storage?.session ?? null;
	} catch {
		return null;
	}
}

function persist() {
	const area = sessionArea();
	if (!area) return;
	try {
		Promise.resolve(
			area.set({ [SESSION_KEY]: Object.fromEntries(states) }),
		).catch((error) => {
			console.warn("[G-Account Switcher] Could not persist tab state:", error);
		});
	} catch (error) {
		console.warn("[G-Account Switcher] Could not persist tab state:", error);
	}
}

function trackingKey(tabId, siteKey) {
	return `${tabId}:${siteKey}`;
}

/**
 * Load persisted state into memory. Safe to call many times; the work runs
 * once. Event handlers must `await` this before reading state, otherwise the
 * first event after a service-worker restart would see an empty tracker.
 *
 * @returns {Promise<void>}
 */
export function loadTabState() {
	loading ??= (async () => {
		const area = sessionArea();
		if (!area) return;
		const startedAt = generation;
		try {
			const stored = (await area.get(SESSION_KEY))?.[SESSION_KEY] ?? {};
			if (startedAt !== generation) return; // cleared while we were reading
			for (const [key, value] of Object.entries(stored)) {
				if (!states.has(key)) states.set(key, value);
			}
		} catch (error) {
			console.warn("[G-Account Switcher] Could not load tab state:", error);
		}
	})();
	return loading;
}

/**
 * Has this tab already been synced to `accountNum` for `siteKey`?
 * Call `loadTabState()` first.
 */
export function isTabSynced(tabId, siteKey, accountNum) {
	return states.get(trackingKey(tabId, siteKey)) === accountNum;
}

/**
 * Record that a tab has been synced. Call `loadTabState()` first.
 */
export function recordTabSync(tabId, siteKey, accountNum) {
	states.set(trackingKey(tabId, siteKey), accountNum);
	persist();
}

/**
 * Forget a tab's sync record (used to roll back a failed redirect).
 */
export function forgetTabSync(tabId, siteKey) {
	if (states.delete(trackingKey(tabId, siteKey))) persist();
}

/**
 * Forget everything, so every tab is re-synced on its next navigation.
 * Called whenever settings change.
 */
export function clearTabState() {
	// Anything still unloaded in storage.session is about to be overwritten,
	// so there is nothing left to load, and a read already in flight is stale.
	generation++;
	loading = Promise.resolve();
	states.clear();
	persist();
}

/**
 * Forget every record for one tab. Called when the tab is closed.
 * @param {number} tabId
 */
export async function cleanupTabState(tabId) {
	await loadTabState();
	const prefix = `${tabId}:`;
	let changed = false;
	for (const key of [...states.keys()]) {
		if (key.startsWith(prefix)) {
			states.delete(key);
			changed = true;
		}
	}
	if (changed) persist();
}

/**
 * Test hook: reset module state between tests.
 * @private
 */
export function _resetForTests() {
	states.clear();
	loading = null;
	generation = 0;
}
