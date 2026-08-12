import { cp, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const srcDir = path.join(rootDir, "src");
const distDir = path.join(rootDir, "dist");
const requiredFiles = [
  "manifest.json",
  "background/service-worker.js",
  "content/content-script.js",
  "options/options.html",
  "options/options.js",
  "options/options.css"
];

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });
await cp(srcDir, distDir, { recursive: true });

const manifestPath = path.join(distDir, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

if (manifest.manifest_version !== 3) {
  throw new Error("Expected Manifest V3.");
}

for (const file of requiredFiles) {
  await readFile(path.join(distDir, file), "utf8");
}

console.log(`Built extension into ${path.relative(rootDir, distDir)}`);
