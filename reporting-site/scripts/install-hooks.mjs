#!/usr/bin/env node
// Install repo git hooks into .git/hooks/. Run once after cloning:
//   npm run hooks:install   (from reporting-site/)
//
// Idempotent: re-running just overwrites the files in .git/hooks/. Skips with a
// warning if the hooks directory doesn't exist (e.g. running from a tarball).
// The hooks dir is resolved via git because the repo root is one level above
// this npm project.

import { copyFile, readdir, chmod, stat } from "node:fs/promises";
import { execSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "hooks");

function hooksDir() {
  const out = execSync("git rev-parse --git-path hooks", { encoding: "utf8" }).trim();
  return path.resolve(out);
}

async function main() {
  const DST = hooksDir();
  try {
    await stat(DST);
  } catch {
    console.warn(`No hooks directory at ${DST}; skipping hook install.`);
    return;
  }

  const files = await readdir(SRC);
  for (const name of files) {
    const from = path.join(SRC, name);
    const to = path.join(DST, name);
    await copyFile(from, to);
    if (process.platform !== "win32") {
      await chmod(to, 0o755);
    }
    console.log(`installed: ${path.relative(process.cwd(), to)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
