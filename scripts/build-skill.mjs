#!/usr/bin/env node
/**
 * Builds employer-analysis.skill from skill-src/employer-analysis/ and
 * refreshes src/server/skill-bundle.ts with the new base64 payload.
 *
 * Usage:  node scripts/build-skill.mjs
 *
 * Steps:
 *   1. Run python tests/test_language_consistency.py (if python is available).
 *   2. Zip skill-src/employer-analysis/ under the inner folder
 *      "employer-analysis-v<version>/" so Claude unpacks it with that name.
 *   3. Base64-encode the zip and rewrite src/server/skill-bundle.ts.
 */

import { execSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync, cpSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const SRC_DIR = join(ROOT, "skill-src", "employer-analysis");
const BUNDLE_TS = join(ROOT, "src", "server", "skill-bundle.ts");

function readSkillVersion() {
  const md = readFileSync(join(SRC_DIR, "SKILL.md"), "utf8");
  const m = md.match(/^version:\s*([0-9.]+)\s*$/m);
  if (!m) throw new Error("Could not find `version:` in SKILL.md frontmatter");
  return m[1];
}

function runTests() {
  const testPath = join(SRC_DIR, "tests", "test_language_consistency.py");
  if (!existsSync(testPath)) {
    console.warn("[build-skill] No tests found, skipping.");
    return;
  }
  const py = spawnSync("python3", [testPath], { stdio: "inherit" });
  if (py.status !== 0) {
    console.warn(
      "[build-skill] WARNING: language-consistency test failed or python3 unavailable. " +
        "Continuing build — fix before publishing."
    );
  }
}

function buildZip(version) {
  const tmp = mkdtempSync(join(tmpdir(), "skill-build-"));
  const innerName = `employer-analysis-v${version}`;
  const innerPath = join(tmp, innerName);
  cpSync(SRC_DIR, innerPath, {
    recursive: true,
    filter: (src) => {
      const base = src.split("/").pop();
      if (base === "__pycache__" || base?.endsWith(".pyc")) return false;
      if (base === ".DS_Store") return false;
      return true;
    },
  });

  const zipPath = join(tmp, `${innerName}.skill`);
  // -X strips extra file attributes for reproducible output.
  execSync(`zip -r -X "${zipPath}" "${innerName}"`, { cwd: tmp, stdio: "inherit" });
  const buf = readFileSync(zipPath);
  rmSync(tmp, { recursive: true, force: true });
  return { buf, filename: `${innerName}.skill` };
}

function writeBundleTs(filename, b64) {
  const out = `export const SKILL_FILENAME = ${JSON.stringify(filename)};\nexport const SKILL_BASE64 = ${JSON.stringify(b64)};\n`;
  writeFileSync(BUNDLE_TS, out);
}

function main() {
  const version = readSkillVersion();
  console.log(`[build-skill] Building employer-analysis v${version}`);
  runTests();
  const { buf, filename } = buildZip(version);
  const b64 = buf.toString("base64");
  writeBundleTs(filename, b64);
  console.log(
    `[build-skill] Wrote ${BUNDLE_TS} — ${filename} (${buf.length} bytes, ${b64.length} base64 chars)`
  );
}

main();
