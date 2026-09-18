const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const rootDir = __dirname;
const distDir = path.join(rootDir, "dist");
const targets = [
	{ name: "chrome", manifest: "manifest.json" },
	{ name: "firefox", manifest: "manifest.firefox.json" },
];

function assertFile(filePath) {
	if (!fs.existsSync(filePath)) {
		throw new Error(
			`Required file is missing: ${path.relative(rootDir, filePath)}`,
		);
	}
}

console.log("Building G-Account Switcher...");
assertFile(path.join(rootDir, "src"));

const mainManifest = JSON.parse(
	fs.readFileSync(path.join(rootDir, "manifest.json"), "utf8"),
);
const version = mainManifest.version;

fs.rmSync(distDir, { recursive: true, force: true });

for (const target of targets) {
	const targetDir = path.join(distDir, target.name);
	const manifestPath = path.join(rootDir, target.manifest);
	assertFile(manifestPath);

	// Fail early if an edited manifest is syntactically invalid.
	JSON.parse(fs.readFileSync(manifestPath, "utf8"));
	fs.cpSync(path.join(rootDir, "src"), path.join(targetDir, "src"), {
		recursive: true,
	});
	fs.copyFileSync(manifestPath, path.join(targetDir, "manifest.json"));

	// Create zip package
	const zipName = `g-account-switcher-${version}-${target.name}.zip`;
	const zipPath = path.join(distDir, zipName);
	try {
		execSync(`cd "${targetDir}" && zip -r "${zipPath}" .`, { stdio: "pipe" });
		console.log(`  📦 ${zipName}`);
	} catch (err) {
		console.warn(
			`  ⚠️ Could not create zip archive for ${target.name}:`,
			err.message,
		);
	}
}

// Validate each built manifest references only files that exist
for (const target of targets) {
	const targetDir = path.join(distDir, target.name);
	const manifest = JSON.parse(
		fs.readFileSync(path.join(targetDir, "manifest.json"), "utf8"),
	);

	for (const iconPath of Object.values(manifest.icons || {})) {
		assertFile(path.join(targetDir, iconPath));
	}
	if (manifest.action?.default_popup) {
		assertFile(path.join(targetDir, manifest.action.default_popup));
	}
	const bgPath =
		manifest.background?.service_worker || manifest.background?.scripts?.[0];
	if (bgPath) {
		assertFile(path.join(targetDir, bgPath));
	}
}
console.log("  ✅ All manifest references validated");

console.log("Build completed successfully!");
for (const target of targets) console.log(`  → dist/${target.name}/`);
