/**
 * Build script: produces dist/chrome and dist/firefox plus a zip of each.
 *
 *   node build.js
 *
 * Needs only Node 20+. There is no compile step: the extension is the
 * contents of src/ plus the target's manifest, copied as-is.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createZip } from "./scripts/zip.js";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(rootDir, "dist");
const targets = [
	{ name: "chrome", manifest: "manifest.json" },
	{ name: "firefox", manifest: "manifest.firefox.json" },
];

function readJson(filePath) {
	try {
		return JSON.parse(fs.readFileSync(filePath, "utf8"));
	} catch (err) {
		throw new Error(
			`Cannot read ${path.relative(rootDir, filePath)}: ${err.message}`,
		);
	}
}

function assertFile(filePath, why = "Required file is missing") {
	if (!fs.existsSync(filePath)) {
		throw new Error(`${why}: ${path.relative(rootDir, filePath)}`);
	}
}

/** All files below `dir` (relative, forward-slash paths), skipping dotfiles. */
function listFiles(dir, base = dir) {
	const out = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.name.startsWith(".")) continue;
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) out.push(...listFiles(full, base));
		else out.push(path.relative(base, full).split(path.sep).join("/"));
	}
	return out.sort();
}

/** The manifest and package.json must all declare the same version. */
function checkVersions(manifests) {
	const versions = new Map();
	for (const [file, version] of manifests) versions.set(file, version);
	const pkgPath = path.join(rootDir, "package.json");
	if (fs.existsSync(pkgPath)) {
		versions.set("package.json", readJson(pkgPath).version);
	}
	if (new Set(versions.values()).size > 1) {
		const detail = [...versions].map(([f, v]) => `${f}=${v}`).join(", ");
		throw new Error(`Version mismatch: ${detail}`);
	}
}

/** Every file a manifest points at must exist in the built directory. */
function checkManifestReferences(targetDir, manifest) {
	for (const iconPath of Object.values(manifest.icons || {})) {
		assertFile(path.join(targetDir, iconPath), "Manifest icon missing");
	}
	if (manifest.action?.default_popup) {
		assertFile(
			path.join(targetDir, manifest.action.default_popup),
			"Popup missing",
		);
	}
	const background = [
		manifest.background?.service_worker,
		...(manifest.background?.scripts || []),
	].filter(Boolean);
	for (const bgPath of background) {
		assertFile(path.join(targetDir, bgPath), "Background script missing");
	}
}

/** Relative <script src> / <link href> targets in popup HTML must exist. */
function checkHtmlReferences(targetDir, files) {
	for (const file of files.filter((f) => f.endsWith(".html"))) {
		const htmlPath = path.join(targetDir, file);
		const html = fs.readFileSync(htmlPath, "utf8");
		for (const match of html.matchAll(/\b(?:src|href)="([^"#]+)"/g)) {
			const ref = match[1];
			if (/^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith("//")) continue;
			assertFile(
				path.join(path.dirname(htmlPath), ref),
				`${file} references a missing file`,
			);
		}
	}
}

/** Relative ES-module imports in every .js file must resolve. */
function checkImports(targetDir, files) {
	const importRe = /(?:import|export)\s[^"';]*?from\s*["'](\.[^"']+)["']|import\s*["'](\.[^"']+)["']/g;
	for (const file of files.filter((f) => f.endsWith(".js"))) {
		const jsPath = path.join(targetDir, file);
		const source = fs.readFileSync(jsPath, "utf8");
		for (const match of source.matchAll(importRe)) {
			const ref = match[1] || match[2];
			assertFile(
				path.join(path.dirname(jsPath), ref),
				`${file} imports a missing module`,
			);
		}
	}
}

console.log("Building G-Account Switcher...");
assertFile(path.join(rootDir, "src"), "Source folder missing");

const manifests = targets.map((target) => {
	const manifestPath = path.join(rootDir, target.manifest);
	assertFile(manifestPath);
	return { target, manifest: readJson(manifestPath), manifestPath };
});

checkVersions(manifests.map((m) => [m.target.manifest, m.manifest.version]));
const version = manifests[0].manifest.version;

fs.rmSync(distDir, { recursive: true, force: true });

for (const { target, manifestPath, manifest } of manifests) {
	const targetDir = path.join(distDir, target.name);
	fs.cpSync(path.join(rootDir, "src"), path.join(targetDir, "src"), {
		recursive: true,
	});
	fs.copyFileSync(manifestPath, path.join(targetDir, "manifest.json"));

	// Validate BEFORE packaging, so a broken build never produces a zip
	const files = listFiles(targetDir);
	checkManifestReferences(targetDir, manifest);
	checkHtmlReferences(targetDir, files);
	checkImports(targetDir, files);

	const zipName = `g-account-switcher-${version}-${target.name}.zip`;
	const zip = createZip(
		files.map((name) => ({
			name,
			data: fs.readFileSync(path.join(targetDir, name)),
		})),
	);
	fs.writeFileSync(path.join(distDir, zipName), zip);
	console.log(`  📦 ${zipName} (${files.length} files, ${zip.length} bytes)`);
}

console.log("  ✅ Versions match; manifest, HTML and import references resolve");
console.log("Build completed successfully!");
for (const { target } of manifests) console.log(`  → dist/${target.name}/`);
