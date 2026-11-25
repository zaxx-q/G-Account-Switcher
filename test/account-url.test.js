import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildAccountUrl, extractAccount } from "../src/lib/account-url.js";
import { findMatchingDomain } from "../src/lib/domains.js";

const dom = (url) => findMatchingDomain(url);

describe("extractAccount", () => {
	it("reads /u/N/ from path-type domains", () => {
		assert.equal(extractAccount("https://mail.google.com/mail/u/2/#inbox", dom("https://mail.google.com/mail/")), 2);
		assert.equal(extractAccount("https://mail.google.com/mail/u/12", dom("https://mail.google.com/mail/")), 12);
		assert.equal(extractAccount("https://gemini.google.com/u/3/app", dom("https://gemini.google.com/")), 3);
	});

	it("returns null for a bare path URL", () => {
		assert.equal(extractAccount("https://mail.google.com/mail/", dom("https://mail.google.com/mail/")), null);
		assert.equal(extractAccount("https://mail.google.com/mail/u/x/", dom("https://mail.google.com/mail/")), null);
	});

	it("reads authuser= from query-type domains", () => {
		const youtube = dom("https://www.youtube.com/");
		assert.equal(extractAccount("https://www.youtube.com/watch?v=a&authuser=4", youtube), 4);
		assert.equal(extractAccount("https://www.youtube.com/watch?v=a", youtube), null);
	});

	it("ignores a non-numeric authuser (e.g. an e-mail address)", () => {
		const youtube = dom("https://www.youtube.com/");
		assert.equal(extractAccount("https://www.youtube.com/?authuser=me@example.com", youtube), null);
	});

	it("is not fooled by /u/N/ appearing inside a query string", () => {
		const search = dom("https://www.google.com/search?q=x");
		assert.equal(extractAccount("https://www.google.com/search?q=example.com/u/2/profile", search), null);
	});

	it("is not fooled by authuser= on a path-type domain's query", () => {
		const mail = dom("https://mail.google.com/mail/");
		assert.equal(extractAccount("https://mail.google.com/mail/?authuser=3", mail), null);
	});
});

describe("buildAccountUrl — path domains", () => {
	const mail = dom("https://mail.google.com/mail/");

	it("inserts /u/N/ into a bare URL", () => {
		assert.equal(buildAccountUrl("https://mail.google.com/mail/", mail, 3), "https://mail.google.com/mail/u/3/");
		assert.equal(buildAccountUrl("https://mail.google.com/mail", mail, 3), "https://mail.google.com/mail/u/3/");
		assert.equal(buildAccountUrl("https://mail.google.com/mail/inbox", mail, 3), "https://mail.google.com/mail/u/3/inbox");
	});

	it("keeps query string and fragment", () => {
		assert.equal(
			buildAccountUrl("https://mail.google.com/mail/?x=1#label/Work", mail, 2),
			"https://mail.google.com/mail/u/2/?x=1#label/Work",
		);
	});

	it("replaces a different account", () => {
		assert.equal(buildAccountUrl("https://mail.google.com/mail/u/0/#inbox", mail, 5), "https://mail.google.com/mail/u/5/#inbox");
	});

	it("returns null when the URL already has the target account", () => {
		assert.equal(buildAccountUrl("https://mail.google.com/mail/u/3/", mail, 3), null);
	});

	it("works for domains with an empty prefix", () => {
		const contacts = dom("https://contacts.google.com/");
		assert.equal(buildAccountUrl("https://contacts.google.com/", contacts, 1), "https://contacts.google.com/u/1/");
		assert.equal(buildAccountUrl("https://contacts.google.com/u/0/person/x", contacts, 1), "https://contacts.google.com/u/1/person/x");
	});

	it("handles AI Studio's /u/N/ URLs", () => {
		const studio = dom("https://aistudio.google.com/");
		assert.equal(extractAccount("https://aistudio.google.com/u/3/prompts/new_chat", studio), 3);
		assert.equal(buildAccountUrl("https://aistudio.google.com/prompts/new_chat", studio, 3), "https://aistudio.google.com/u/3/prompts/new_chat");
		assert.equal(buildAccountUrl("https://aistudio.google.com/u/0/prompts/new_chat", studio, 3), "https://aistudio.google.com/u/3/prompts/new_chat");
	});

	it("refuses paths outside the domain's prefix", () => {
		assert.equal(buildAccountUrl("https://mail.google.com/mailing", mail, 3), null);
	});
});

describe("buildAccountUrl — query domains", () => {
	const youtube = dom("https://www.youtube.com/");

	it("adds authuser to a bare URL", () => {
		assert.equal(
			buildAccountUrl("https://www.youtube.com/watch?v=abc", youtube, 2),
			"https://www.youtube.com/watch?v=abc&authuser=2",
		);
		assert.equal(buildAccountUrl("https://www.youtube.com/", youtube, 2), "https://www.youtube.com/?authuser=2");
	});

	it("replaces a different numeric account", () => {
		assert.equal(
			buildAccountUrl("https://www.youtube.com/watch?authuser=0&v=abc", youtube, 2),
			"https://www.youtube.com/watch?authuser=2&v=abc",
		);
	});

	it("returns null when already on the target account", () => {
		assert.equal(buildAccountUrl("https://www.youtube.com/?authuser=2", youtube, 2), null);
	});

	it("leaves a non-numeric authuser alone unless forced", () => {
		const url = "https://www.youtube.com/?authuser=me@example.com";
		assert.equal(buildAccountUrl(url, youtube, 2), null);
		assert.equal(
			buildAccountUrl(url, youtube, 2, { force: true }),
			"https://www.youtube.com/?authuser=2",
		);
	});

	it("uses authuser= everywhere on Meet, never /u/N/", () => {
		const meet = dom("https://meet.google.com/");
		assert.equal(meet.type, "query");
		// home page, bare meeting code, and /meet/<code> links all get authuser
		assert.equal(buildAccountUrl("https://meet.google.com/", meet, 2), "https://meet.google.com/?authuser=2");
		assert.equal(buildAccountUrl("https://meet.google.com/abc-defg-hij", meet, 2), "https://meet.google.com/abc-defg-hij?authuser=2");
		assert.equal(buildAccountUrl("https://meet.google.com/meet/abc-defg-hij?pli=1", meet, 2), "https://meet.google.com/meet/abc-defg-hij?pli=1&authuser=2");
		// an existing authuser is replaced, not joined by a /u/N/ segment
		assert.equal(buildAccountUrl("https://meet.google.com/abc-defg-hij?authuser=1", meet, 2), "https://meet.google.com/abc-defg-hij?authuser=2");
		assert.equal(extractAccount("https://meet.google.com/meet/abc-defg-hij?pli=1&authuser=2", meet), 2);
		assert.equal(extractAccount("https://meet.google.com/u/1/landing", meet), null);
	});

	it("preserves the fragment", () => {
		assert.equal(
			buildAccountUrl("https://docs.google.com/document/d/abc/edit#heading=h.1", dom("https://docs.google.com/document/d/abc"), 4),
			"https://docs.google.com/document/d/abc/edit?authuser=4#heading=h.1",
		);
	});
});

describe("buildAccountUrl — bad input", () => {
	it("returns null for unparseable URLs and unsupported domain types", () => {
		const mail = dom("https://mail.google.com/mail/");
		assert.equal(buildAccountUrl("nope", mail, 1), null);
		assert.equal(buildAccountUrl("https://example.com/", { type: "excluded" }, 1), null);
		assert.equal(extractAccount("nope", mail), null);
	});
});
