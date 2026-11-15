/**
 * Minimal, dependency-free ZIP writer.
 *
 * Used by build.js so packaging works on every platform without the `zip`
 * command. Output is deterministic (sorted entries, fixed timestamps), so
 * building the same sources twice yields byte-identical archives. That makes
 * it possible to verify that a published package matches the repository.
 */
import { deflateRawSync } from "node:zlib";

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) {
			c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		}
		table[n] = c >>> 0;
	}
	return table;
})();

/**
 * CRC-32 (IEEE) of a buffer.
 * @param {Uint8Array} buf
 * @returns {number} Unsigned 32-bit checksum
 */
export function crc32(buf) {
	let c = 0xffffffff;
	for (let i = 0; i < buf.length; i++) {
		c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
	}
	return (c ^ 0xffffffff) >>> 0;
}

// 1980-01-01 00:00:00, the earliest timestamp the ZIP format can store.
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;
const FLAG_UTF8 = 0x0800;
const UNIX_FILE_MODE = (0o100644 << 16) >>> 0;

/**
 * Build a ZIP archive.
 *
 * @param {Array<{name: string, data: Uint8Array}>} files - Entry names use
 *   forward slashes and no leading slash.
 * @returns {Buffer}
 */
export function createZip(files) {
	const sorted = [...files].sort((a, b) =>
		a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
	);

	const localParts = [];
	const centralParts = [];
	let offset = 0;

	for (const file of sorted) {
		const name = Buffer.from(file.name, "utf8");
		const data = Buffer.from(file.data);
		const crc = crc32(data);

		let method = 8;
		let body = deflateRawSync(data, { level: 9 });
		if (body.length >= data.length) {
			method = 0; // store: deflating would not help
			body = data;
		}

		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4); // version needed
		local.writeUInt16LE(FLAG_UTF8, 6);
		local.writeUInt16LE(method, 8);
		local.writeUInt16LE(DOS_TIME, 10);
		local.writeUInt16LE(DOS_DATE, 12);
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(body.length, 18);
		local.writeUInt32LE(data.length, 22);
		local.writeUInt16LE(name.length, 26);
		local.writeUInt16LE(0, 28); // extra length
		localParts.push(local, name, body);

		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE((3 << 8) | 20, 4); // made by: Unix, v2.0
		central.writeUInt16LE(20, 6); // version needed
		central.writeUInt16LE(FLAG_UTF8, 8);
		central.writeUInt16LE(method, 10);
		central.writeUInt16LE(DOS_TIME, 12);
		central.writeUInt16LE(DOS_DATE, 14);
		central.writeUInt32LE(crc, 16);
		central.writeUInt32LE(body.length, 20);
		central.writeUInt32LE(data.length, 24);
		central.writeUInt16LE(name.length, 28);
		central.writeUInt16LE(0, 30); // extra length
		central.writeUInt16LE(0, 32); // comment length
		central.writeUInt16LE(0, 34); // disk number
		central.writeUInt16LE(0, 36); // internal attributes
		central.writeUInt32LE(UNIX_FILE_MODE, 38);
		central.writeUInt32LE(offset, 42);
		centralParts.push(central, name);

		offset += local.length + name.length + body.length;
	}

	const centralDir = Buffer.concat(centralParts);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(0, 4); // this disk
	end.writeUInt16LE(0, 6); // disk with central directory
	end.writeUInt16LE(sorted.length, 8);
	end.writeUInt16LE(sorted.length, 10);
	end.writeUInt32LE(centralDir.length, 12);
	end.writeUInt32LE(offset, 16);
	end.writeUInt16LE(0, 20); // comment length

	return Buffer.concat([...localParts, centralDir, end]);
}
