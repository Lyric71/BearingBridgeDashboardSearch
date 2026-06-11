#!/usr/bin/env node
// Batch-optimize raster images in place under public/ (or a path you pass).
//
// Usage:
//   node scripts/optimize-images-batch.mjs                   # scan public/
//   node scripts/optimize-images-batch.mjs public/work
//   node scripts/optimize-images-batch.mjs path/to/file.png  # single file is fine too
//   node scripts/optimize-images-batch.mjs --dry             # report only, no writes
//   node scripts/optimize-images-batch.mjs --max-width=1800
//   node scripts/optimize-images-batch.mjs --min-size=50     # skip files <50 KB
//   node scripts/optimize-images-batch.mjs --force           # re-encode even if no savings
//
// Behavior:
//   - Walks the target path, picks up .jpg/.jpeg/.png/.webp (case-insensitive).
//   - Skips .svg (already vector) and .avif (treat as already-optimized).
//   - For each file: resizes down if wider than --max-width, then re-encodes at the
//     same path with the same extension. JPG -> mozjpeg q82, PNG -> palette q90,
//     WEBP -> q78. Keeps EXIF orientation. Flattens onto white only for JPG.
//   - If the new buffer is not smaller than the original (with --force off), the
//     original is left untouched. This protects already-optimized files.
//   - Prints a per-file line and a total report at the end.

import { argv, exit, cwd } from "node:process";
import { readFile, stat, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const RASTER_EXT = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const SKIP_EXT = new Set([".svg", ".avif", ".gif", ".ico"]);

const DEFAULTS = {
  maxWidth: 2000,
  minSizeKB: 30, // files smaller than this gain little, skip
  jpgQuality: 82,
  webpQuality: 78,
  pngQuality: 90,
  alphaThreshold: 0.995,
  dry: false,
  force: false,
  root: "public", // default scan target when run via `npm run img:batch`
};

function parseArgs(rawArgs) {
  const opts = { ...DEFAULTS };
  const positional = [];
  for (const arg of rawArgs) {
    if (arg === "--dry") opts.dry = true;
    else if (arg === "--force") opts.force = true;
    else if (arg.startsWith("--max-width=")) opts.maxWidth = Number(arg.split("=")[1]);
    else if (arg.startsWith("--min-size=")) opts.minSizeKB = Number(arg.split("=")[1]);
    else if (arg.startsWith("--")) {
      console.error(`Unknown flag: ${arg}`);
      exit(2);
    } else {
      positional.push(arg);
    }
  }
  if (positional.length > 0) opts.root = positional[0];
  return opts;
}

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

async function walk(target) {
  const out = [];
  let st;
  try {
    st = await stat(target);
  } catch {
    return out;
  }
  if (st.isFile()) {
    out.push(target);
    return out;
  }
  const stack = [target];
  while (stack.length) {
    const dir = stack.pop();
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) out.push(p);
    }
  }
  return out;
}

async function hasMeaningfulAlpha(pipeline, meta, threshold) {
  if (!meta.hasAlpha) return false;
  const stats = await pipeline.stats();
  const alpha = stats.channels[stats.channels.length - 1];
  return alpha.min < 255 * threshold;
}

async function optimizeOne(file, opts) {
  const ext = path.extname(file).toLowerCase();
  if (SKIP_EXT.has(ext)) return { file, skipped: "vector/other" };
  if (!RASTER_EXT.has(ext)) return { file, skipped: "not raster" };

  const srcStat = await stat(file);
  const srcBytes = srcStat.size;
  if (srcBytes < opts.minSizeKB * 1024) {
    return { file, srcBytes, skipped: "small" };
  }

  const srcBuf = await readFile(file);
  const probe = sharp(srcBuf, { failOn: "error" }).rotate();
  let meta;
  try {
    meta = await probe.metadata();
  } catch (err) {
    return { file, srcBytes, error: `metadata: ${err.message}` };
  }

  const needsResize = meta.width && meta.width > opts.maxWidth;
  const resizer = (p) =>
    needsResize ? p.resize({ width: opts.maxWidth, withoutEnlargement: true }) : p;

  let outBuf;
  try {
    if (ext === ".jpg" || ext === ".jpeg") {
      outBuf = await resizer(sharp(srcBuf).rotate())
        .flatten({ background: "#ffffff" })
        .jpeg({ quality: opts.jpgQuality, mozjpeg: true, progressive: true })
        .toBuffer();
    } else if (ext === ".png") {
      const alpha = await hasMeaningfulAlpha(probe, meta, opts.alphaThreshold);
      let pipe = resizer(sharp(srcBuf).rotate());
      if (!alpha) pipe = pipe.flatten({ background: "#ffffff" });
      outBuf = await pipe
        .png({ palette: true, quality: opts.pngQuality, compressionLevel: 9, effort: 10 })
        .toBuffer();
    } else if (ext === ".webp") {
      outBuf = await resizer(sharp(srcBuf).rotate())
        .webp({ quality: opts.webpQuality, effort: 6 })
        .toBuffer();
    }
  } catch (err) {
    return { file, srcBytes, error: `encode: ${err.message}` };
  }

  if (!outBuf) return { file, srcBytes, skipped: "no output" };

  const saved = srcBytes - outBuf.length;
  const ratio = saved / srcBytes;

  // Don't replace if we didn't actually save space (unless --force).
  if (!opts.force && saved <= 0) {
    return { file, srcBytes, outBytes: outBuf.length, kept: true };
  }
  // Don't bother replacing if savings are negligible (<3%) to avoid churn.
  if (!opts.force && ratio < 0.03) {
    return { file, srcBytes, outBytes: outBuf.length, kept: true };
  }

  if (!opts.dry) {
    await writeFile(file, outBuf);
  }

  return {
    file,
    srcBytes,
    outBytes: outBuf.length,
    width: meta.width,
    height: meta.height,
    resized: needsResize,
    saved,
    ratio,
  };
}

async function main() {
  const opts = parseArgs(argv.slice(2));
  const root = path.resolve(opts.root);
  console.log(
    `Scanning: ${path.relative(cwd(), root) || "."}  (max-width=${opts.maxWidth}, min-size=${opts.minSizeKB} KB${opts.dry ? ", DRY RUN" : ""})`,
  );

  const files = (await walk(root)).filter((f) =>
    RASTER_EXT.has(path.extname(f).toLowerCase()),
  );
  if (files.length === 0) {
    console.log("No raster images found.");
    return;
  }

  let totalSrc = 0;
  let totalOut = 0;
  let optimized = 0;
  let kept = 0;
  let skipped = 0;
  let errored = 0;

  for (const f of files) {
    const r = await optimizeOne(f, opts);
    const rel = path.relative(cwd(), f);
    if (r.error) {
      errored++;
      console.log(`  !! ${rel}  ${r.error}`);
      continue;
    }
    if (r.skipped) {
      skipped++;
      continue;
    }
    if (r.kept) {
      kept++;
      totalSrc += r.srcBytes;
      totalOut += r.srcBytes; // we kept the original
      continue;
    }
    optimized++;
    totalSrc += r.srcBytes;
    totalOut += r.outBytes;
    const pct = (r.ratio * 100).toFixed(0);
    const flags = r.resized ? " [resized]" : "";
    console.log(
      `  ${rel}  ${fmtBytes(r.srcBytes)} -> ${fmtBytes(r.outBytes)}  (-${pct}%)${flags}`,
    );
  }

  const totalSaved = totalSrc - totalOut;
  const pct = totalSrc > 0 ? ((totalSaved / totalSrc) * 100).toFixed(1) : "0.0";
  console.log("");
  console.log(
    `Done: ${optimized} optimized, ${kept} kept (no gain), ${skipped} skipped, ${errored} errored.`,
  );
  console.log(
    `Total: ${fmtBytes(totalSrc)} -> ${fmtBytes(totalOut)}  (${fmtBytes(totalSaved)} saved, -${pct}%)${opts.dry ? "  [DRY RUN, nothing written]" : ""}`,
  );
}

main();
