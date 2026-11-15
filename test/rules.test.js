import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
	GOOGLE_DOMAINS,
	getSiteKey,
	SITE_DISABLED,
} from "../src/lib/constants.js";
import { applyRules, generateRules } from "../src/lib/rules.js";
import { installChrome, uninstallChrome } from "./helpers/chrome-mock.js";

const SITE_KEYS = [
	...new Set(
		GOOGLE_DOMAINS.filter((d) => d.type !== "excluded").map(getSiteKey),
	),
];

/**
 * Tiny model of declarativeNetRequest for redirect rules: which rules match
 * a URL, and what the URL becomes when one is applied.
 */
function ruleMatches(rule, url) {
	const { host } = new URL(url);
	const { requestDomains, regexFilter, urlFilter } = rule.condition;
	if (requestDomains && !requestDomains.some((d) => host === d || host.endsWith(`.${d}`))) {
		return false;
	}
	if (regexFilter) return new RegExp(regexFilter).test(url);
	if (urlFilter) {
		// Only the "||domain^" form is used
		const domain = urlFilter.slice(2, -1);
		return host === domain || host.endsWith(`.${domain}`);
	}
	return false;
}

function applyRule(rule, url) {
	const { redirect } = rule.action;
	if (redirect.url) return redirect.url;
	const match = new RegExp(rule.condition.regexFilter).exec(url);
	return redirect.regexSubstitution.replace(/\\(\d)/g, (_, d) => match[d] ?? "");
}

/** What a browser would do: highest priority wins. Fails on a tie. */
function resolve(rules, url) {
	const matching = rules.filter((r) => ruleMatches(r, url));
	if (matching.length === 0) return { url, rule: null };
	const top = Math.max(...matching.map((r) => r.priority));
	const winners = matching.filter((r) => r.priority === top);
	assert.equal(
		winners.length,
		1,
		`priority tie for ${url}: rules ${winners.map((r) => r.id).join(", ")}`,
	);
	return { url: applyRule(winners[0], url), rule: winners[0] };
}

describe("generateRules — which rules exist", () => {
	it("returns nothing when disabled", () => {
		assert.deepEqual(generateRules(0, { "mail.google.com": 1 }, false, true), []);
	});

	it("returns nothing on a fresh install (no sites, global off)", () => {
		assert.deepEqual(generateRules(0, {}, true, false), []);
	});

	it("creates rules only for configured sites when global is off", () => {
		const rules = generateRules(0, { "www.youtube.com": 2 }, true, false);
		assert.equal(rules.length, 1);
		assert.deepEqual(rules[0].condition.requestDomains, ["www.youtube.com"]);
	});

	it("creates a rule for every non-excluded entry when global is on", () => {
		const rules = generateRules(1, {}, true, true).filter((r) => r.condition.regexFilter);
		const expected = GOOGLE_DOMAINS.filter((d) => d.type !== "excluded").reduce(
			(n, d) => n + (d.queryMatch ? 2 : 1),
			0,
		);
		assert.equal(rules.length, expected);
	});

	it("never creates rules for excluded hosts", () => {
		const rules = generateRules(1, {}, true, true);
		for (const host of ["accounts.google.com", "music.youtube.com"]) {
			assert.ok(!rules.some((r) => r.condition.requestDomains?.includes(host)), host);
		}
	});

	it("skips sites set to SITE_DISABLED, even with global on", () => {
		const rules = generateRules(1, { "www.youtube.com": SITE_DISABLED }, true, true);
		assert.ok(!rules.some((r) => r.condition.requestDomains?.includes("www.youtube.com")));
		assert.ok(rules.some((r) => r.condition.requestDomains?.includes("studio.youtube.com")));
	});

	it("generates two rules for a queryMatch entry (param before/after authuser)", () => {
		const rules = generateRules(0, { "www.google.com/aimode": 3 }, true, false);
		assert.equal(rules.length, 2);
	});

	it("adds gmail.com redirects for the configured Gmail account", () => {
		const rules = generateRules(0, { "mail.google.com": 4 }, true, false);
		const special = rules.filter((r) => r.action.redirect.url);
		assert.equal(special.length, 1);
		assert.equal(special[0].action.redirect.url, "https://mail.google.com/mail/u/4/");
	});

	it("falls back to the global account for gmail.com, and honours a disabled Gmail", () => {
		const viaGlobal = generateRules(2, {}, true, true).filter((r) => r.action.redirect.url);
		assert.ok(viaGlobal.every((r) => r.action.redirect.url.endsWith("/u/2/")));
		const disabled = generateRules(2, { "mail.google.com": SITE_DISABLED }, true, true);
		assert.equal(disabled.filter((r) => r.action.redirect.url).length, 0);
	});
});

describe("generateRules — identifiers", () => {
	const everything = generateRules(
		1,
		Object.fromEntries(SITE_KEYS.map((k, i) => [k, i % 10])),
		true,
		true,
	);

	it("uses unique rule IDs", () => {
		const ids = everything.map((r) => r.id);
		assert.equal(new Set(ids).size, ids.length);
	});

	it("keeps IDs inside their documented ranges", () => {
		for (const rule of everything) {
			if (rule.action.redirect.url) {
				assert.ok(rule.id >= 1001 && rule.id <= 1010, `special ${rule.id}`);
			} else {
				assert.ok(rule.id >= 501 && rule.id <= 1000, `site ${rule.id}`);
			}
		}
		const globals = generateRules(1, {}, true, true).filter((r) => !r.action.redirect.url);
		assert.ok(globals.every((r) => r.id >= 1 && r.id <= 500));
	});

	it("only uses regex features RE2 supports (no lookaround or backreferences)", () => {
		for (const rule of everything.filter((r) => r.condition.regexFilter)) {
			const re = rule.condition.regexFilter;
			assert.ok(!/\(\?[=!<]/.test(re), `lookaround in ${re}`);
			assert.ok(!/\\[1-9]/.test(re), `backreference in ${re}`);
			assert.doesNotThrow(() => new RegExp(re));
		}
	});
});

describe("generateRules — behaviour on real-looking URLs", () => {
	it("rewrites path-type /u/N/ to the configured account", () => {
		const rules = generateRules(0, { "mail.google.com": 3 }, true, false);
		assert.equal(resolve(rules, "https://mail.google.com/mail/u/1/#inbox").url, "https://mail.google.com/mail/u/3/#inbox");
		assert.equal(resolve(rules, "https://mail.google.com/mail/u/0/").url, "https://mail.google.com/mail/u/3/");
	});

	it("rewrites AI Studio's /u/N/ path", () => {
		const rules = generateRules(0, { "aistudio.google.com": 2 }, true, false);
		assert.equal(resolve(rules, "https://aistudio.google.com/u/1/prompts/new_chat").url, "https://aistudio.google.com/u/2/prompts/new_chat");
		assert.equal(resolve(rules, "https://aistudio.google.com/prompts/new_chat").rule, null);
	});

	it("rewrites authuser= on query-type domains, in any parameter order", () => {
		const rules = generateRules(0, { "www.google.com": 2 }, true, false);
		assert.equal(resolve(rules, "https://www.google.com/search?q=x&authuser=0").url, "https://www.google.com/search?q=x&authuser=2");
		assert.equal(resolve(rules, "https://www.google.com/search?authuser=0&q=x").url, "https://www.google.com/search?authuser=2&q=x");
	});

	it("leaves bare URLs alone (that is proactive mode's job)", () => {
		const rules = generateRules(0, { "www.google.com": 2 }, true, false);
		assert.equal(resolve(rules, "https://www.google.com/search?q=x").rule, null);
	});

	it("handles AI mode's udm=50 before and after authuser=", () => {
		const rules = generateRules(0, { "www.google.com/aimode": 5 }, true, false);
		assert.equal(resolve(rules, "https://www.google.com/search?udm=50&authuser=1").url, "https://www.google.com/search?udm=50&authuser=5");
		assert.equal(resolve(rules, "https://www.google.com/search?authuser=1&udm=50").url, "https://www.google.com/search?authuser=5&udm=50");
		assert.equal(resolve(rules, "https://www.google.com/search?q=a&udm=50&x=1&authuser=1").url, "https://www.google.com/search?q=a&udm=50&x=1&authuser=5");
		// Plain search must not be touched by the AI-mode rule
		assert.equal(resolve(rules, "https://www.google.com/search?q=x&authuser=1").rule, null);
		assert.equal(resolve(rules, "https://www.google.com/search?udm=5&authuser=1").rule, null);
	});

	it("matches a pathPrefix only at a path boundary", () => {
		const rules = generateRules(0, { "www.google.com/maps": 5 }, true, false);
		assert.equal(resolve(rules, "https://www.google.com/maps?authuser=1").url, "https://www.google.com/maps?authuser=5");
		assert.equal(resolve(rules, "https://www.google.com/maps/place/x?authuser=1").url, "https://www.google.com/maps/place/x?authuser=5");
		assert.equal(resolve(rules, "https://www.google.com/mapsfoo?authuser=1").rule, null);
	});

	it("never ties: Maps beats Search, per-site beats global, AI mode beats both", () => {
		const settings = {
			"www.google.com": 0,
			"www.google.com/maps": 5,
			"www.google.com/aimode": 7,
		};
		const rules = generateRules(9, settings, true, true);
		assert.equal(resolve(rules, "https://www.google.com/maps?authuser=1").url, "https://www.google.com/maps?authuser=5");
		assert.equal(resolve(rules, "https://www.google.com/search?q=x&authuser=1").url, "https://www.google.com/search?q=x&authuser=0");
		assert.equal(resolve(rules, "https://www.google.com/search?udm=50&authuser=1").url, "https://www.google.com/search?udm=50&authuser=7");
	});

	it("per-site rules beat global rules for the same URL", () => {
		const rules = generateRules(9, { "www.youtube.com": 2 }, true, true);
		assert.equal(resolve(rules, "https://www.youtube.com/watch?v=a&authuser=0").url, "https://www.youtube.com/watch?v=a&authuser=2");
		assert.equal(resolve(rules, "https://studio.youtube.com/?authuser=0").url, "https://studio.youtube.com/?authuser=9");
	});

	it("has no priority ties anywhere across a broad URL sample", () => {
		const settings = Object.fromEntries(SITE_KEYS.map((k, i) => [k, i % 10]));
		for (const global of [false, true]) {
			const rules = generateRules(8, settings, true, global);
			for (const entry of GOOGLE_DOMAINS.filter((d) => d.type !== "excluded")) {
				const sample = new URL(`https://${entry.host}${entry.pathPrefix || ""}${entry.type === "path" ? "/u/1/x" : "/x"}`);
				if (entry.type === "query") sample.searchParams.set("authuser", "1");
				if (entry.queryMatch) sample.searchParams.set(entry.queryMatch.key, entry.queryMatch.value);
				resolve(rules, sample.toString()); // asserts internally
			}
		}
	});

	it("redirects gmail.com and www.gmail.com to the account's inbox", () => {
		const rules = generateRules(0, { "mail.google.com": 4 }, true, false);
		assert.equal(resolve(rules, "https://gmail.com/").url, "https://mail.google.com/mail/u/4/");
		assert.equal(resolve(rules, "https://www.gmail.com/").url, "https://mail.google.com/mail/u/4/");
	});
});

describe("applyRules", () => {
	let mock;
	beforeEach(() => {
		mock = installChrome();
	});
	afterEach(() => uninstallChrome());

	it("replaces the existing dynamic rules", async () => {
		await applyRules(0, { "www.youtube.com": 2 }, true, false);
		assert.equal(mock.dnr.rules.length, 1);
		await applyRules(0, { "www.youtube.com": 3, "mail.google.com": 1 }, true, false);
		assert.ok(mock.dnr.rules.length > 1);
		await applyRules(0, {}, true, false);
		assert.equal(mock.dnr.rules.length, 0);
	});

	it("serializes overlapping calls so none fails and the last one wins", async () => {
		// Fired together, from an empty rule set — the situation that used to
		// throw "Rule with id N does not have a unique ID".
		const results = await Promise.allSettled([
			applyRules(0, { "mail.google.com": 1, "drive.google.com": 2 }, true, false),
			applyRules(0, { "mail.google.com": 3 }, true, false),
			applyRules(0, { "www.youtube.com": 4 }, true, false),
		]);
		assert.deepEqual(results.map((r) => r.status), ["fulfilled", "fulfilled", "fulfilled"]);
		assert.equal(mock.dnr.errors.length, 0);
		assert.equal(mock.dnr.maxInFlight, 1);
		assert.deepEqual(mock.dnr.rules.map((r) => r.condition.requestDomains[0]), ["www.youtube.com"]);
	});

	it("keeps working after one call fails", async () => {
		const original = chrome.declarativeNetRequest.updateDynamicRules;
		chrome.declarativeNetRequest.updateDynamicRules = async () => {
			throw new Error("boom");
		};
		await assert.rejects(applyRules(0, { "www.youtube.com": 2 }, true, false), /boom/);
		chrome.declarativeNetRequest.updateDynamicRules = original;
		await applyRules(0, { "www.youtube.com": 2 }, true, false);
		assert.equal(mock.dnr.rules.length, 1);
	});
});
