#!/usr/bin/env node
// Pre-commit step: optimize any staged raster images, then re-stage them.
//
// Wired in via .git/hooks/pre-commit. Runs only on files git reports as added
// or modified that fall under the watched directory and have a raster
// extension. Safe to run repeatedly: the batch optimizer keeps the original
// buffer if it can't shrink it.
//
// Runs with cwd = repo root (the hook shim cd's there), so staged paths and
// the optimizer script path are both repo-root-relative.

import { execSync } from "node:child_process";
import path from "node:path";

const RASTER_EXT = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const ROOT_PREFIX = "reporting-site/public/";
const OPTIMIZER = "reporting-site/scripts/optimize-images-batch.mjs";

function staged() {
  // -z + null parser keeps paths with spaces intact.
  const out = execSync("git diff --cached --name-only --diff-filter=ACMR -z", {
    encoding: "buffer",
  });
  return out
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
}

function isTargetImage(p) {
  const norm = p.replace(/\\/g, "/");
  if (!norm.startsWith(ROOT_PREFIX)) return false;
  return RASTER_EXT.has(path.extname(norm).toLowerCase());
}

function main() {
  const files = staged().filter(isTargetImage);
  if (files.length === 0) return;

  console.log(`[pre-commit] optimizing ${files.length} image(s)...`);
  for (const f of files) {
    try {
      execSync(`node ${OPTIMIZER} "${f}"`, { stdio: "inherit" });
      execSync(`git add -- "${f}"`, { stdio: "inherit" });
    } catch (err) {
      console.error(`[pre-commit] failed to optimize ${f}: ${err.message}`);
      process.exit(1);
    }
  }
}

main();
