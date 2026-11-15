import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { GOOGLE_DOMAINS, getSiteKey } from "../src/lib/constants.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));

const chrome = readJson("manifest.json");
const firefox = readJson("manifest.firefox.json");
const pkg = readJson("package.json");

function sourceFiles(dir = path.join(root, "src")) {
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
		e.isDirectory()
			? sourceFiles(path.join(dir, e.name))
			: e.name.endsWith(".js")
				? [path.join(dir, e.name)]
				: [],
	);
}

describe("GOOGLE_DOMAINS", () => {
	const entries = GOOGLE_DOMAINS;

	it("has well-formed entries", () => {
		for (const d of entries) {
			assert.ok(["path", "query", "excluded"].includes(d.type), `${d.host}: type`);
			assert.match(d.host, /^[a-z0-9.-]+$/, `${d.host}: host`);
			if (d.pathPrefix) {
				assert.ok(d.pathPrefix.startsWith("/"), `${d.host}: pathPrefix`);
				assert.ok(!d.pathPrefix.endsWith("/"), `${d.host}: pathPrefix trailing slash`);
			}
			if (d.queryMatch) {
				assert.equal(d.type, "query", `${d.host}: queryMatch needs type query`);
				assert.ok(d.queryMatch.key && d.queryMatch.value, `${d.host}: queryMatch`);
			}
		}
	});

	it("has no duplicate entries", () => {
		const seen = new Set();
		for (const d of entries) {
			const id = JSON.stringify([d.host, d.type, d.pathPrefix || "", d.queryMatch || null]);
			assert.ok(!seen.has(id), `duplicate entry: ${id}`);
			seen.add(id);
		}
	});

	it("gives every selectable entry a non-empty site key", () => {
		for (const d of entries.filter((x) => x.type !== "excluded")) {
			assert.ok(getSiteKey(d), d.host);
		}
	});

	it("is covered by the manifest's host_permissions", () => {
		const covers = (pattern, host) => {
			const match = /^(?:\*|https?):\/\/([^/]+)\/\*$/.exec(pattern);
			if (!match) return false;
			const hostPart = match[1];
			if (hostPart.startsWith("*.")) {
				const base = hostPart.slice(2);
				return host === base || host.endsWith(`.${base}`);
			}
			return host === hostPart;
		};
		for (const manifest of [chrome, firefox]) {
			for (const d of entries) {
				assert.ok(
					manifest.host_permissions.some((p) => covers(p, d.host)),
					`${d.host} is not covered by host_permissions`,
				);
			}
		}
	});
});

describe("manifests", () => {
	it("are Manifest V3", () => {
		assert.equal(chrome.manifest_version, 3);
		assert.equal(firefox.manifest_version, 3);
	});

	it("share one version with package.json", () => {
		assert.equal(chrome.version, firefox.version);
		assert.equal(chrome.version, pkg.version);
	});

	it("declare the same user-facing metadata, permissions and UI", () => {
		for (const key of ["name", "description", "permissions", "host_permissions", "icons", "action"]) {
			assert.deepEqual(chrome[key], firefox[key], key);
		}
	});

	it("point the background at the same module", () => {
		assert.equal(chrome.background.service_worker, "src/background.js");
		assert.deepEqual(firefox.background.scripts, ["src/background.js"]);
		assert.equal(chrome.background.type, "module");
		assert.equal(firefox.background.type, "module");
	});

	it("declare exactly the permissions the code uses", () => {
		const gated = ["storage", "declarativeNetRequest", "scripting", "cookies", "tabs"];
		const used = new Set();
		for (const file of sourceFiles()) {
			for (const m of fs.readFileSync(file, "utf8").matchAll(/\bchrome\.([a-zA-Z]+)\b/g)) {
				if (gated.includes(m[1])) used.add(m[1]);
			}
		}
		assert.deepEqual([...used].sort(), [...chrome.permissions].sort());
	});

	it("ship icons that exist and match their declared sizes", () => {
		for (const [size, file] of Object.entries(chrome.icons)) {
			const png = fs.readFileSync(path.join(root, file));
			assert.equal(png.subarray(1, 4).toString("latin1"), "PNG", `${file} is not a PNG`);
			assert.equal(png.readUInt32BE(16), Number(size), `${file} width`);
			assert.equal(png.readUInt32BE(20), Number(size), `${file} height`);
		}
	});

	it("keep Firefox-specific settings out of the Chrome manifest and vice versa", () => {
		assert.ok(firefox.browser_specific_settings?.gecko?.id);
		assert.equal(chrome.browser_specific_settings, undefined);
		assert.ok(chrome.minimum_chrome_version);
	});
});
