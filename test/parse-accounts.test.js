import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	extractAccounts,
	mergeAccounts,
	parseAccounts,
	parseListAccountsResponse,
} from "../src/lib/parse-accounts.js";

const entry = (name, email, photo = "", extra = []) => [
	"gaia.l.a",
	1,
	name,
	email,
	photo,
	...extra,
];

const payload = [
	"gaia.l.a.r",
	[
		entry("Alice Anderson", "alice@example.com", "https://lh3.googleusercontent.com/a", [1, 0]),
		entry("Bob", "bob@example.com", ""),
	],
];

describe("parseListAccountsResponse / parseAccounts", () => {
	it("parses Format A (XSSI-prefixed JSON)", () => {
		const text = `)]}'\n${JSON.stringify(payload)}`;
		const accounts = parseAccounts(text);
		assert.deepEqual(
			accounts.map((a) => [a.index, a.email, a.name]),
			[
				[0, "alice@example.com", "Alice Anderson"],
				[1, "bob@example.com", "Bob"],
			],
		);
		assert.equal(accounts[0].photo, "https://lh3.googleusercontent.com/a");
		assert.equal(accounts[1].photo, "");
	});

	it("parses Format B (HTML postMessage with \\x escapes)", () => {
		const json = JSON.stringify(payload);
		const escaped = [...json]
			.map((c) => (/[[\]",]/.test(c) ? `\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}` : c))
			.join("");
		const html = `<!DOCTYPE html><html><body><script>window.parent.postMessage('${escaped}', '*');</script></body></html>`;
		assert.deepEqual(
			parseAccounts(html).map((a) => a.email),
			["alice@example.com", "bob@example.com"],
		);
	});

	it("decodes quotes, unicode escapes and backslashes in Format B names", () => {
		const data = ["gaia.l.a.r", [entry("O'Brien \u00e9", "ob@example.com")]];
		// Build the JS-literal the way Google would: ' → \x27, é → \u00e9
		const literal = JSON.stringify(data)
			.replace(/\\/g, "\\\\")
			.replace(/'/g, "\\x27")
			.replace(/\u00e9/g, "\\u00e9");
		const html = `<script>window.parent.postMessage('${literal}', '*')</script>`;
		const [account] = parseAccounts(html);
		assert.equal(account.name, "O'Brien \u00e9");
	});

	it("accepts plain JSON as a fallback", () => {
		assert.equal(parseAccounts(JSON.stringify(payload)).length, 2);
	});

	it("returns [] for garbage or empty input instead of throwing", () => {
		assert.deepEqual(parseAccounts(""), []);
		assert.deepEqual(parseAccounts("<html>Sign in</html>"), []);
		assert.deepEqual(parseAccounts(")]}'\nnot json"), []);
	});

	it("parseListAccountsResponse throws on unrecognised input", () => {
		assert.throws(() => parseListAccountsResponse("<html></html>"));
	});
});

describe("extractAccounts", () => {
	it("finds entries however deeply Google nests them", () => {
		const nested = { wrapper: [[["x"], ["gaia.l.a.r", [entry("Deep", "deep@example.com")]]]] };
		assert.deepEqual(extractAccounts(nested).map((a) => a.email), ["deep@example.com"]);
	});

	it("de-duplicates by e-mail (case-insensitive) and keeps indexes contiguous", () => {
		const data = [
			entry("A", "a@example.com"),
			entry("A again", "A@Example.com"),
			entry("B", "b@example.com"),
		];
		assert.deepEqual(extractAccounts(data).map((a) => [a.index, a.email]), [
			[0, "a@example.com"],
			[1, "b@example.com"],
		]);
	});

	it("skips entries without a usable e-mail and non-http photos", () => {
		const data = [
			entry("No email", "", ""),
			entry("Not an email", "nope"),
			entry("Photo", "p@example.com", "javascript:alert(1)"),
			["gaia.l.a", 1], // too short
		];
		const accounts = extractAccounts(data);
		assert.equal(accounts.length, 1);
		assert.equal(accounts[0].photo, "");
	});

	it("falls back to the e-mail local part when the name is empty", () => {
		assert.equal(extractAccounts([entry("", "jane.doe@example.com")])[0].name, "jane.doe");
	});

	it("stops descending past the depth limit", () => {
		let deep = [entry("Too deep", "deep@example.com")];
		for (let i = 0; i < 30; i++) deep = [deep];
		assert.deepEqual(extractAccounts(deep), []);
	});
});

describe("mergeAccounts", () => {
	const detected = (list) =>
		list.map(([email, name], index) => ({ index, email, name, photo: "" }));

	it("keeps labels for accounts that stay put", () => {
		const merged = mergeAccounts(
			detected([["a@x.com", "A"], ["b@x.com", "B"]]),
			[
				{ index: 0, email: "a@x.com", label: "Work" },
				{ index: 1, email: "b@x.com", label: "Home" },
			],
		);
		assert.deepEqual(merged.map((a) => a.label), ["Work", "Home"]);
	});

	it("moves labels with the e-mail when accounts shift position", () => {
		// Alice (0, "Work") signs out; Bob slides from index 1 to 0.
		const merged = mergeAccounts(detected([["b@x.com", "B"]]), [
			{ index: 0, email: "a@x.com", label: "Work" },
			{ index: 1, email: "b@x.com", label: "Home" },
		]);
		assert.equal(merged[0].email, "b@x.com");
		assert.equal(merged[0].label, "Home"); // NOT "Work"
	});

	it("matches e-mail case-insensitively and refreshes name and photo", () => {
		const merged = mergeAccounts(
			[{ index: 0, email: "A@X.com", name: "New Name", photo: "https://p" }],
			[{ index: 3, email: "a@x.com", name: "Old", photo: "", label: "Work" }],
		);
		assert.deepEqual(merged[0], {
			index: 0,
			email: "A@X.com",
			name: "New Name",
			photo: "https://p",
			label: "Work",
		});
	});

	it("gives a brand-new account an empty label", () => {
		const merged = mergeAccounts(detected([["new@x.com", "New"]]), [
			{ index: 0, email: "old@x.com", label: "Old label" },
		]);
		assert.equal(merged[0].label, "");
	});

	it("lets a manually added entry (no e-mail) keep its label by index", () => {
		const merged = mergeAccounts(detected([["a@x.com", "A"], ["b@x.com", "B"]]), [
			{ index: 1, email: "", label: "Manual" },
		]);
		assert.deepEqual(merged.map((a) => a.label), ["", "Manual"]);
	});

	it("handles an empty or missing stored list", () => {
		assert.equal(mergeAccounts(detected([["a@x.com", "A"]])).length, 1);
		assert.deepEqual(mergeAccounts([], [{ index: 0, email: "a@x.com", label: "x" }]), []);
	});
});
