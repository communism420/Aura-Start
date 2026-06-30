import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

const root = process.cwd();
const distDir = process.env.AURA_FIREFOX_DIST_DIR?.trim() || "dist-firefox";
const distPath = join(root, distDir);

const unsafeHtmlPatterns = [
  {
    label: "assignment to innerHTML",
    pattern: /(?:\.innerHTML|\[\s*["']innerHTML["']\s*\])\s*(?:[+\-*/%]?=)/g
  },
  {
    label: "assignment to outerHTML",
    pattern: /(?:\.outerHTML|\[\s*["']outerHTML["']\s*\])\s*(?:[+\-*/%]?=)/g
  },
  {
    label: "call to insertAdjacentHTML",
    pattern: /(?:\.insertAdjacentHTML|\[\s*["']insertAdjacentHTML["']\s*\])\s*\(/g
  }
];

async function listJavaScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listJavaScriptFiles(path));
    } else if (entry.isFile() && /\.(?:js|mjs|cjs)$/.test(entry.name)) {
      files.push(path);
    }
  }

  return files;
}

function lineNumberForIndex(source, index) {
  return source.slice(0, index).split(/\r?\n/).length;
}

function findUnsafeHtmlUsage(source, filePath) {
  const findings = [];
  for (const { label, pattern } of unsafeHtmlPatterns) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      findings.push(`${relative(root, filePath)}:${lineNumberForIndex(source, match.index ?? 0)} ${label}`);
    }
  }
  return findings;
}

function sanitizeReactDomBundle(source) {
  let sanitized = source;
  let replacementCount = 0;

  sanitized = sanitized.replace(
    /function\(a, b\) \{\s*if \("http:\/\/www\.w3\.org\/2000\/svg" !== a\.namespaceURI \|\| "innerHTML" in a\) a\.innerHTML = b;\s*else \{\s*mb = mb \|\| document\.createElement\("div"\);\s*mb\.innerHTML = "<svg>" \+ b\.valueOf\(\)\.toString\(\) \+ "<\/svg>";\s*for \(b = mb\.firstChild; a\.firstChild; \) a\.removeChild\(a\.firstChild\);\s*for \(; b\.firstChild; \) a\.appendChild\(b\.firstChild\);\s*\}\s*\}\);/g,
    () => {
      replacementCount += 1;
      return `function() {
    throw Error("Raw HTML rendering is disabled in Aura Start Firefox builds.");
  });`;
    }
  );

  sanitized = sanitized.replace(
    /a = g\.createElement\("div"\), a\.innerHTML = "<script><\\\/script>", a = a\.removeChild\(a\.firstChild\)/g,
    () => {
      replacementCount += 1;
      return `a = g.createElement("script")`;
    }
  );

  return { sanitized, replacementCount };
}

const files = await listJavaScriptFiles(distPath);
let totalReplacementCount = 0;

for (const file of files) {
  const source = await readFile(file, "utf8");
  const { sanitized, replacementCount } = sanitizeReactDomBundle(source);
  if (replacementCount > 0) {
    await writeFile(file, sanitized, "utf8");
    totalReplacementCount += replacementCount;
  }
}

const findings = [];
for (const file of files) {
  findings.push(...findUnsafeHtmlUsage(await readFile(file, "utf8"), file));
}

if (findings.length) {
  console.error("Firefox JavaScript still contains unsafe HTML sinks:");
  for (const finding of findings) {
    console.error(`- ${finding}`);
  }
  process.exit(1);
}

console.log(`Sanitized Firefox JavaScript: ${totalReplacementCount} replacement(s).`);
