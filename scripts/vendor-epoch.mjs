#!/usr/bin/env node
// Regenerates vendor/ from a local checkout of @kyanitelabs/epoch.
//
//   node scripts/vendor-epoch.mjs [path-to-epoch-checkout]
//
// Vendored artifacts:
//   vendor/epoch/chunk-V7N6FMO6.js   byte-identical upstream dist (TOOL_REGISTRY + handlers)
//   vendor/epoch/chunk-K22BNBU4.js   byte-identical upstream dist (core lib)
//   vendor/epoch/reference-database.json  byte-identical upstream seed data
//   vendor/epoch/package.json        pinned upstream version metadata (hand-maintained)
//   vendor/epoch/LICENSE             upstream Apache-2.0
//   vendor/node_modules/{zod,date-fns}    exact static ESM import closure (esbuild metafile)
//   vendor/node_modules/date-fns-tz       kept WHOLE: CJS lazy requires are not
//                                         statically analyzable, so closure-pruning
//                                         it would risk runtime missing-module errors.
//
// Writes VENDOR-MANIFEST.json (relative path -> sha256) for the A4 hash-pin gate.
// Node >= 22, no dependencies beyond the upstream checkout itself.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const UPSTREAM = path.resolve(process.argv[2] ?? path.join(os.homedir(), "workspaces/kyanite-labs/Epoch"));
const HERE = path.dirname(path.dirname(path.resolve(import.meta.filename)));
const VENDOR = path.join(HERE, "vendor");
const EPOCH = path.join(VENDOR, "epoch");
const NM = path.join(VENDOR, "node_modules");

const CHUNKS = ["chunk-V7N6FMO6.js", "chunk-K22BNBU4.js"];
const DIST_EXTRA = ["reference-database.json"];
const CLOSURE_ENTRY = "dist/chunk-V7N6FMO6.js";
const WHOLE_PACKAGES = ["date-fns-tz"];
const PINNED = {
  "@kyanitelabs/epoch": "0.5.0",
  zod: "4.4.3",
  "date-fns": "4.4.0",
  "date-fns-tz": "3.2.0",
};

const fail = (msg) => {
  console.error("vendor-epoch: " + msg);
  process.exit(1);
};

for (const [name, version] of Object.entries(PINNED)) {
  const pkg = JSON.parse(readFileSync(path.join(UPSTREAM, name === "@kyanitelabs/epoch" ? "package.json" : `node_modules/${name}/package.json`), "utf8"));
  if (pkg.version !== version) fail(`pinned ${name} is ${version} but upstream checkout has ${pkg.version}`);
}

// 1. Exact ESM import closure via esbuild --metafile (esbuild ships inside the
//    upstream checkout's node_modules; the SERVICE never spawns anything —
//    this is a build-time vendoring tool, not the runtime).
const esbuildDirs = readdirSync(path.join(UPSTREAM, "node_modules/.pnpm")).filter((d) => d.startsWith("esbuild@")).sort();
if (esbuildDirs.length === 0) fail("esbuild not found in upstream node_modules");
const esbuildBin = path.join(UPSTREAM, "node_modules/.pnpm", esbuildDirs.at(-1), "node_modules/esbuild/bin/esbuild");
const entry = path.join(EPOCH, ".closure-entry.mjs");
const metaFile = path.join(EPOCH, ".closure-meta.json");
mkdirSync(EPOCH, { recursive: true });
writeFileSync(entry, `import ${JSON.stringify(path.join(UPSTREAM, CLOSURE_ENTRY))};\n`);
execFileSync(esbuildBin, [entry, "--bundle", "--format=esm", "--platform=node", `--metafile=${metaFile}`, "--outfile=" + path.join(EPOCH, ".closure-bundle.js"), "--log-level=error"], { cwd: HERE });
const meta = JSON.parse(readFileSync(metaFile, "utf8"));
// metafile keys are relative to esbuild's cwd (HERE) and reach pnpm's virtual
// store as node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg>/...
const pkgRe = /^node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?(@[^/]+\/[^/]+|[^/]+)(?:\/(.*))?$/;
const closure = [];
for (const key of Object.keys(meta.inputs)) {
  const abs = path.resolve(HERE, key);
  const rel = path.relative(UPSTREAM, abs);
  if (rel.startsWith("..") || !rel.startsWith("node_modules/")) continue; // upstream dist files are copied explicitly
  const m = rel.match(pkgRe);
  if (!m) fail(`unmapped closure path: ${rel}`);
  if (WHOLE_PACKAGES.includes(m[1])) continue; // vendored whole below
  closure.push({ pkg: m[1], sub: m[2] ?? "" });
}
if (closure.length === 0) fail("empty closure — refusing to vendor nothing");
rmSync(entry, { force: true });
rmSync(metaFile, { force: true });
rmSync(path.join(EPOCH, ".closure-bundle.js"), { force: true });
if (closure.length === 0) fail("empty closure — refusing to vendor nothing");

// 2. Rebuild vendor/ from scratch so the manifest never describes stale files.
rmSync(VENDOR, { recursive: true, force: true });
mkdirSync(EPOCH, { recursive: true });
mkdirSync(NM, { recursive: true });

for (const f of [...CHUNKS, ...DIST_EXTRA]) {
  cpSync(path.join(UPSTREAM, "dist", f), path.join(EPOCH, f));
}
cpSync(path.join(UPSTREAM, "LICENSE"), path.join(EPOCH, "LICENSE"));
writeFileSync(path.join(EPOCH, "package.json"), JSON.stringify({
  name: "@kyanitelabs/epoch-vendored",
  version: PINNED["@kyanitelabs/epoch"],
  description: "Byte-identical vendored dist artifacts of @kyanitelabs/epoch (Apache-2.0). Regenerate with scripts/vendor-epoch.mjs; every file is hash-pinned by VENDOR-MANIFEST.json.",
  type: "module",
  license: "Apache-2.0",
  private: true,
  epoch: { upstream: "@kyanitelabs/epoch", upstreamVersion: PINNED["@kyanitelabs/epoch"], vendoredBy: "scripts/vendor-epoch.mjs" },
}, null, 2) + "\n");

const copied = new Set();
function copyFile(src, dst) {
  if (copied.has(dst)) return;
  copied.add(dst);
  mkdirSync(path.dirname(dst), { recursive: true });
  cpSync(src, dst, { dereference: true });
}
// closure files keep their exact relative layout under vendor/node_modules/<pkg>/
for (const { pkg, sub } of closure) {
  const pkgRoot = path.join(UPSTREAM, "node_modules", pkg); // real root (pnpm symlink) — dereferenced on copy
  copyFile(path.join(pkgRoot, sub), path.join(NM, pkg, sub));
  // each package's manifest + license ride along so bare-specifier resolution
  // and license obligations survive the prune
  for (const extra of ["package.json", "LICENSE", "LICENSE.md", "README.md"]) {
    if (existsSync(path.join(pkgRoot, extra))) copyFile(path.join(pkgRoot, extra), path.join(NM, pkg, extra));
  }
}
for (const pkg of WHOLE_PACKAGES) {
  cpSync(path.join(UPSTREAM, "node_modules", pkg), path.join(NM, pkg), { dereference: true, recursive: true });
}

// 3. Manifest: sha256 of every vendored file (vendor/epoch + vendor/node_modules).
let upstreamCommit = "unknown";
try { upstreamCommit = execFileSync("git", ["-C", UPSTREAM, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch { /* documented as unknown */ }
const files = [];
function walk(dir) {
  for (const name of readdirSync(dir).sort()) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(path.relative(HERE, p));
  }
}
walk(VENDOR);
const manifest = {
  generator: "scripts/vendor-epoch.mjs",
  upstream: { name: "@kyanitelabs/epoch", version: PINNED["@kyanitelabs/epoch"], commit: upstreamCommit, license: "Apache-2.0" },
  dependencies: { zod: PINNED.zod, "date-fns": PINNED["date-fns"], "date-fns-tz": PINNED["date-fns-tz"] },
  notes: [
    "dist chunks are byte-identical upstream artifacts",
    "zod/date-fns are the exact static ESM import closure (esbuild --metafile)",
    "date-fns-tz is vendored whole (CJS lazy requires are not statically analyzable)",
  ],
  files: files.map((rel) => {
    const buf = readFileSync(path.join(HERE, rel));
    return { path: rel, bytes: buf.length, sha256: createHash("sha256").update(buf).digest("hex") };
  }),
};
writeFileSync(path.join(HERE, "VENDOR-MANIFEST.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`vendor-epoch: ${manifest.files.length} files pinned (${CHUNKS.length} chunks + ${closure.length} closure files + date-fns-tz whole); upstream ${PINNED["@kyanitelabs/epoch"]} @ ${upstreamCommit.slice(0, 12)}`);
