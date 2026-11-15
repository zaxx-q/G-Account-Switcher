/**
 * Minimal in-memory stand-in for the parts of the `chrome` API the
 * extension's logic touches. Install with `installChrome()`; it returns the
 * mock so tests can inspect calls and tweak behaviour.
 */
function makeArea(data, mock) {
	return {
		async get(keys) {
			if (mock.failStorageReads) throw new Error("storage unavailable");
			if (keys === null || keys === undefined) return structuredClone(data);
			if (typeof keys === "string") keys = [keys];
			const out = {};
			if (Array.isArray(keys)) {
				for (const key of keys) if (key in data) out[key] = structuredClone(data[key]);
			} else {
				// object form: the values are defaults
				for (const [key, fallback] of Object.entries(keys)) {
					out[key] = key in data ? structuredClone(data[key]) : fallback;
				}
			}
			return out;
		},
		async set(items) {
			Object.assign(data, structuredClone(items));
		},
		async remove(keys) {
			for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
		},
	};
}

export function installChrome({ withSession = true } = {}) {
	const sessionData = {};

	const mock = {
		tabUpdates: [],
		openTabs: [],
		failNextTabUpdate: false,
		failStorageReads: false,
		sessionGetDelay: 0,
		sessionData,
		localData: {},
		syncData: {},
		dnr: {
			rules: [],
			inFlight: 0,
			maxInFlight: 0,
			errors: [],
		},
	};

	const chrome = {
		runtime: {},
		tabs: {
			async update(tabId, props) {
				if (mock.failNextTabUpdate) {
					mock.failNextTabUpdate = false;
					throw new Error("No tab with id");
				}
				mock.tabUpdates.push({ tabId, ...props });
			},
			async query() {
				return mock.openTabs;
			},
		},
		declarativeNetRequest: {
			async getDynamicRules() {
				await tick();
				return structuredClone(mock.dnr.rules);
			},
			async updateDynamicRules({ removeRuleIds = [], addRules = [] }) {
				mock.dnr.inFlight++;
				mock.dnr.maxInFlight = Math.max(
					mock.dnr.maxInFlight,
					mock.dnr.inFlight,
				);
				try {
					await tick();
					// Behave like Chrome: ids must be unique after removal
					const remaining = mock.dnr.rules.filter(
						(r) => !removeRuleIds.includes(r.id),
					);
					for (const rule of addRules) {
						if (remaining.some((r) => r.id === rule.id)) {
							const error = new Error(
								`Rule with id ${rule.id} does not have a unique ID.`,
							);
							mock.dnr.errors.push(error);
							throw error;
						}
						remaining.push(rule);
					}
					mock.dnr.rules = remaining;
				} finally {
					mock.dnr.inFlight--;
				}
			},
		},
	};

	chrome.storage = {
		local: makeArea(mock.localData, mock),
		sync: makeArea(mock.syncData, mock),
	};

	if (withSession) {
		chrome.storage.session = {
			async get(key) {
				// Like a real read, the snapshot is taken when the call is made
				const snapshot =
					key in sessionData ? { [key]: structuredClone(sessionData[key]) } : {};
				if (mock.sessionGetDelay) {
					await new Promise((r) => setTimeout(r, mock.sessionGetDelay));
				}
				return snapshot;
			},
			async set(items) {
				Object.assign(sessionData, structuredClone(items));
			},
		};
	}

	globalThis.chrome = chrome;
	return mock;
}

export function uninstallChrome() {
	delete globalThis.chrome;
}

function tick() {
	return new Promise((resolve) => setTimeout(resolve, 2));
}
