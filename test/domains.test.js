import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GOOGLE_DOMAINS, getSiteKey } from "../src/lib/constants.js";
import {
	findMatchingDomain,
	isGoogleHost,
	pathMatchesPrefix,
} from "../src/lib/domains.js";

const siteKeyOf = (url, options) => {
	const domain = findMatchingDomain(url, options);
	return domain ? getSiteKey(domain) : null;
};

describe("isGoogleHost", () => {
	it("accepts Google, YouTube and Gmail hosts and subdomains", () => {
		for (const host of [
			"google.com",
			"mail.google.com",
			".google.com", // cookie-style domain
			"WWW.GOOGLE.COM",
			"www.youtube.com",
			"gmail.com",
			"www.gmail.com",
		]) {
			assert.equal(isGoogleHost(host), true, host);
		}
	});

	it("rejects look-alikes that merely contain the name", () => {
		for (const host of [
			"notgoogle.com",
			"google.com.evil.example",
			"mygmail.com",
			"youtube.com.example.org",
			"example.com",
			"",
			undefined,
		]) {
			assert.equal(isGoogleHost(host), false, String(host));
		}
	});
});

describe("pathMatchesPrefix", () => {
	it("matches the prefix itself and anything below it", () => {
		assert.equal(pathMatchesPrefix("/mail", "/mail"), true);
		assert.equal(pathMatchesPrefix("/mail/", "/mail"), true);
		assert.equal(pathMatchesPrefix("/mail/u/0/", "/mail"), true);
	});

	it("does not match a longer word that starts with the prefix", () => {
		assert.equal(pathMatchesPrefix("/mailing", "/mail"), false);
		assert.equal(pathMatchesPrefix("/mapsfoo", "/maps"), false);
	});

	it("treats an empty prefix as matching everything", () => {
		assert.equal(pathMatchesPrefix("/anything", ""), true);
		assert.equal(pathMatchesPrefix("/", undefined), true);
	});
});

describe("findMatchingDomain", () => {
	const cases = [
		// [url, expected siteKey]
		["https://mail.google.com/mail/u/0/", "mail.google.com"],
		["https://mail.google.com/mail/", "mail.google.com"],
		["https://www.google.com/search?q=x", "www.google.com"],
		["https://www.google.com/maps", "www.google.com/maps"],
		["https://www.google.com/maps/place/Paris", "www.google.com/maps"],
		["https://www.google.com/maps?authuser=1", "www.google.com/maps"],
		["https://www.google.com/search?q=x&udm=50", "www.google.com/aimode"],
		["https://www.google.com/search?udm=50&q=x", "www.google.com/aimode"],
		["https://www.google.com/search?udm=5", "www.google.com"],
		["https://docs.google.com/document/d/abc/edit", "docs.google.com/document"],
		["https://docs.google.com/spreadsheets/d/abc", "docs.google.com/spreadsheets"],
		["https://docs.google.com/presentation/d/abc", "docs.google.com/presentation"],
		["https://docs.google.com/forms/d/e/abc/viewform", "docs.google.com/forms"],
		["https://docs.google.com/drawings/d/abc", "docs.google.com/drawings"],
		["https://docs.google.com/", "docs.google.com"],
		["https://aistudio.google.com/prompts/new_chat", "aistudio.google.com"],
		["https://aistudio.google.com/u/3/prompts/new_chat", "aistudio.google.com"],
		["https://drive.google.com/drive/my-drive", "drive.google.com"],
		["https://drive.google.com/file/d/abc/view", "drive.google.com"],
		["https://meet.google.com/meet/abc-defg-hij", "meet.google.com"],
		["https://meet.google.com/abc-defg-hij", "meet.google.com"],
		["https://meet.google.com/", "meet.google.com"],
		["https://www.youtube.com/watch?v=abc", "www.youtube.com"],
		["https://studio.youtube.com/channel/x", "studio.youtube.com"],
		["https://search.google.com/search-console?x=1", "search.google.com"],
	];
	for (const [url, key] of cases) {
		it(`${url} → ${key}`, () => {
			assert.equal(siteKeyOf(url), key);
		});
	}

	it("picks the right entry type where a host has several", () => {
		assert.equal(findMatchingDomain("https://drive.google.com/drive/x").type, "path");
		assert.equal(findMatchingDomain("https://drive.google.com/file/d/x").type, "query");
		assert.equal(findMatchingDomain("https://meet.google.com/meet/x").type, "query");
		assert.equal(findMatchingDomain("https://meet.google.com/").type, "query");
		assert.equal(findMatchingDomain("https://aistudio.google.com/").type, "path");
	});

	it("does not treat a longer path word as a prefix match", () => {
		assert.equal(siteKeyOf("https://www.google.com/mapsfoo"), "www.google.com");
		// ...and has no catch-all fallback where none is configured
		assert.equal(siteKeyOf("https://search.google.com/search-consolefoo"), null);
	});

	it("ignores excluded and unknown hosts", () => {
		assert.equal(findMatchingDomain("https://accounts.google.com/signin"), null);
		assert.equal(findMatchingDomain("https://music.youtube.com/"), null);
		assert.equal(findMatchingDomain("https://example.com/"), null);
		assert.equal(findMatchingDomain("https://google.com.evil.example/"), null);
	});

	it("returns null for URLs that cannot be parsed", () => {
		assert.equal(findMatchingDomain("not a url"), null);
		assert.equal(findMatchingDomain(""), null);
	});

	it("resolves gmail.com to Gmail only when asked", () => {
		assert.equal(findMatchingDomain("https://gmail.com/"), null);
		assert.equal(siteKeyOf("https://gmail.com/", { resolveGmailAlias: true }), "mail.google.com");
		assert.equal(siteKeyOf("https://www.gmail.com/", { resolveGmailAlias: true }), "mail.google.com");
	});

	it("can reach every configured entry (none is shadowed by another)", () => {
		for (const entry of GOOGLE_DOMAINS.filter((d) => d.type !== "excluded")) {
			const url = new URL(`https://${entry.host}${entry.pathPrefix || "/"}`);
			if (entry.queryMatch) {
				url.searchParams.set(entry.queryMatch.key, entry.queryMatch.value);
			}
			assert.equal(
				findMatchingDomain(url.toString()),
				entry,
				`${url} should resolve to its own entry`,
			);
		}
	});
});
