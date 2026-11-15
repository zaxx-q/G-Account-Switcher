import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";
import { crc32, createZip } from "../scripts/zip.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Independent reader: walks the central directory like an unzip tool would. */
function readZip(buf) {
	const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
	assert.ok(eocd >= 0, "end-of-central-directory record");
	const count = buf.readUInt16LE(eocd + 10);
	let pos = buf.readUInt32LE(eocd + 16);
	const files = new Map();
	for (let i = 0; i < count; i++) {
		assert.equal(buf.readUInt32LE(pos), 0x02014b50, "central header signature");
		const method = buf.readUInt16LE(pos + 10);
		const crc = buf.readUInt32LE(pos + 16);
		const csize = buf.readUInt32LE(pos + 20);
		const usize = buf.readUInt32LE(pos + 24);
		const nameLen = buf.readUInt16LE(pos + 28);
		const extraLen = buf.readUInt16LE(pos + 30);
		const commentLen = buf.readUInt16LE(pos + 32);
		const localOffset = buf.readUInt32LE(pos + 42);
		const name = buf.toString("utf8", pos + 46, pos + 46 + nameLen);
		assert.equal(buf.readUInt32LE(localOffset), 0x04034b50, "local header signature");
		const dataStart = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
		const raw = buf.subarray(dataStart, dataStart + csize);
		const data = method === 8 ? inflateRawSync(raw) : Buffer.from(raw);
		assert.equal(data.length, usize, `${name}: size`);
		assert.equal(crc32(data), crc, `${name}: crc`);
		files.set(name, data);
		pos += 46 + nameLen + extraLen + commentLen;
	}
	return files;
}

describe("createZip", () => {
	it("round-trips text, binary and empty files", () => {
		const binary = Buffer.from(Array.from({ length: 5000 }, (_, i) => (i * 37) % 256));
		const zip = createZip([
			{ name: "manifest.json", data: Buffer.from('{"a":1}'.repeat(50)) },
			{ name: "src/blob.bin", data: binary },
			{ name: "empty.txt", data: Buffer.alloc(0) },
		]);
		const files = readZip(zip);
		assert.deepEqual([...files.keys()].sort(), ["empty.txt", "manifest.json", "src/blob.bin"]);
		assert.deepEqual(files.get("src/blob.bin"), binary);
		assert.equal(files.get("empty.txt").length, 0);
	});

	it("handles non-ASCII file names", () => {
		const files = readZip(createZip([{ name: "src/café-é.txt", data: Buffer.from("x") }]));
		assert.ok(files.has("src/café-é.txt"));
	});

	it("is deterministic and independent of input order", () => {
		const a = { name: "a.txt", data: Buffer.from("alpha") };
		const b = { name: "b/b.txt", data: Buffer.from("beta") };
		assert.deepEqual(createZip([a, b]), createZip([b, a]));
		assert.deepEqual(createZip([a, b]), createZip([a, b]));
	});

	it("computes standard CRC-32 values", () => {
		assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
		assert.equal(crc32(Buffer.alloc(0)), 0);
	});
});

describe("build.js", () => {
	it("produces valid Chrome and Firefox packages with manifest.json at the root", () => {
		execFileSync(process.execPath, ["build.js"], { cwd: root, stdio: "pipe" });
		const { version } = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

		for (const target of ["chrome", "firefox"]) {
			const zip = readZip(fs.readFileSync(path.join(root, "dist", `g-account-switcher-${version}-${target}.zip`)));
			assert.ok(zip.has("manifest.json"), `${target}: manifest.json at root`);
			assert.ok(zip.has("src/background.js"));
			assert.ok(zip.has("src/popup/popup.html"));
			assert.ok(![...zip.keys()].some((n) => n.split("/").some((p) => p.startsWith("."))), "no dotfiles");

			// zip content must equal the unpacked dist folder
			const manifestOnDisk = fs.readFileSync(path.join(root, "dist", target, "manifest.json"));
			assert.deepEqual(zip.get("manifest.json"), manifestOnDisk);
		}
	});

	it("uses a different manifest for each browser", () => {
		const read = (t) => JSON.parse(fs.readFileSync(path.join(root, "dist", t, "manifest.json"), "utf8"));
		assert.ok(read("chrome").background.service_worker);
		assert.ok(read("firefox").background.scripts);
	});
});
