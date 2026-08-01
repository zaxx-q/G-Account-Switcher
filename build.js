const fs = require("fs");
const path = require("path");

const rootDir = __dirname;
const distDir = path.join(rootDir, "dist");
const chromeDist = path.join(distDir, "chrome");
const firefoxDist = path.join(distDir, "firefox");

console.log("Building G-Account Switcher...");

// Clean dist directory
if (fs.existsSync(distDir)) {
	fs.rmSync(distDir, { recursive: true, force: true });
}

// Copy src directory to chrome and firefox dist
fs.cpSync(path.join(rootDir, "src"), path.join(chromeDist, "src"), {
	recursive: true,
});
fs.cpSync(path.join(rootDir, "src"), path.join(firefoxDist, "src"), {
	recursive: true,
});

// Copy manifest files
fs.copyFileSync(
	path.join(rootDir, "manifest.json"),
	path.join(chromeDist, "manifest.json"),
);
fs.copyFileSync(
	path.join(rootDir, "manifest.firefox.json"),
	path.join(firefoxDist, "manifest.json"),
);

console.log("Build completed successfully!");
console.log("  -> dist/chrome/");
console.log("  -> dist/firefox/");
