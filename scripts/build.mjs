import { cp, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Build script for unpacked-extension development.
//
// The script copies source files as-is, then validates the reachable extension
// entrypoints. This keeps module delegation cheap: new imported JS files do not
// need to be manually added to a central list.
const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const srcDir = path.join(rootDir, "src");
const distDir = path.join(rootDir, "dist");
const dynamicEntrypoints = [
  // Chrome loads the offscreen document from code, not from manifest JSON.
  // Its script and module imports are discovered from the HTML file.
  "offscreen/recorder.html",
  // Chrome opens this visible page from code to request microphone access.
  "permissions/microphone.html"
];

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });
await cp(srcDir, distDir, { recursive: true });

const manifest = JSON.parse(await readExtensionFile("manifest.json"));

if (manifest.manifest_version !== 3) {
  throw new Error("Expected Manifest V3.");
}

await validateExtensionFiles(getManifestEntrypoints(manifest));

console.log(`Built extension into ${path.relative(rootDir, distDir)}`);

/**
 * Reads every known entrypoint and recursively validates local references.
 */
async function validateExtensionFiles(entrypoints) {
  const seen = new Set();
  const pending = [...entrypoints, ...dynamicEntrypoints, "manifest.json"];

  while (pending.length > 0) {
    const relativePath = normalizeExtensionPath(pending.pop());
    if (seen.has(relativePath)) {
      continue;
    }

    seen.add(relativePath);
    const content = await readExtensionFile(relativePath);
    pending.push(...findReferencedFiles(relativePath, content));
  }
}

/**
 * Finds files Chrome loads directly from manifest declarations.
 */
function getManifestEntrypoints(manifest) {
  return compact([
    manifest.background?.service_worker,
    manifest.options_page,
    manifest.action?.default_popup,
    manifest.side_panel?.default_path,
    ...manifest.content_scripts?.flatMap((item) => item.js ?? []) ?? [],
    ...manifest.web_accessible_resources?.flatMap((item) => item.resources ?? []) ?? []
  ]);
}

/**
 * Dispatches reference discovery based on the file type.
 */
function findReferencedFiles(relativePath, content) {
  if (relativePath.endsWith(".html")) {
    return findHtmlAssets(relativePath, content);
  }

  if (relativePath.endsWith(".js")) {
    return findRelativeJavaScriptImports(relativePath, content);
  }

  return [];
}

/**
 * Finds local script/style references in extension-owned HTML files.
 */
function findHtmlAssets(relativePath, html) {
  const references = [];
  const attributePattern = /\b(?:src|href)=["']([^"']+)["']/g;

  for (const match of html.matchAll(attributePattern)) {
    const reference = match[1];
    if (isLocalAssetReference(reference)) {
      references.push(resolveRelativeExtensionPath(relativePath, reference));
    }
  }

  return references;
}

/**
 * Finds relative static imports/exports and dynamic imports in JS modules.
 */
function findRelativeJavaScriptImports(relativePath, code) {
  const imports = [];
  const importPattern = /\b(?:import|export)\s+(?:[^"'()]*?\s+from\s+)?["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;

  for (const match of code.matchAll(importPattern)) {
    const specifier = match[1] || match[2];
    if (specifier?.startsWith(".")) {
      imports.push(resolveRelativeExtensionPath(relativePath, specifier));
    }
  }

  return imports;
}

/**
 * Filters out anchors and absolute URLs so only packaged files are validated.
 */
function isLocalAssetReference(reference) {
  return reference
    && !reference.startsWith("#")
    && !/^[a-z][a-z0-9+.-]*:/i.test(reference)
    && !reference.startsWith("//");
}

/**
 * Resolves a local reference and prevents paths from leaving src/.
 */
function resolveRelativeExtensionPath(fromPath, reference) {
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), reference));

  if (resolved.startsWith("../")) {
    throw new Error(`Extension file reference leaves src/: ${fromPath} -> ${reference}`);
  }

  return resolved;
}

/**
 * Reads a copied extension file from dist/.
 */
async function readExtensionFile(relativePath) {
  return await readFile(path.join(distDir, normalizeExtensionPath(relativePath)), "utf8");
}

/**
 * Normalizes paths to Chrome extension slash-separated paths.
 */
function normalizeExtensionPath(relativePath) {
  return relativePath.replaceAll("\\", "/");
}

function compact(values) {
  return values.filter(Boolean);
}
