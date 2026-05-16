#!/usr/bin/env node
/**
 * electron:prepare — between `next build` and `electron-builder`.
 *
 * Next's standalone output (`.next/standalone/`) is *missing* the
 * static assets it serves at runtime — `.next/static/` and the
 * project's `public/` folder live one level up. The standalone
 * `server.js` expects them at `.next/standalone/.next/static/`
 * and `.next/standalone/public/`. We do that copy here; it's the
 * shape `electron-builder.yml` then bundles as `extraResources`.
 *
 * Native module ABI: we do NOT rebuild here. The expected order
 * (see .github/workflows/electron-windows.yml) is:
 *   pnpm install          # root node_modules with Node ABI
 *   pnpm electron:rebuild # → Electron Node ABI rebuilds
 *   pnpm next build       # standalone tree picks up rebuilt .node
 *   node electron-prepare # this script: static-asset copy only
 *   pnpm electron-builder # packages everything
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const require_ = createRequire(import.meta.url);

const repoRoot = resolve(import.meta.dirname, "..");
const standaloneDir = resolve(repoRoot, ".next", "standalone");
const staticSrc = resolve(repoRoot, ".next", "static");
const staticDst = resolve(standaloneDir, ".next", "static");
const publicSrc = resolve(repoRoot, "public");
const publicDst = resolve(standaloneDir, "public");

if (!existsSync(standaloneDir)) {
  console.error(
    `✗ .next/standalone not found at ${standaloneDir}\n  Did \`pnpm build\` run first?`,
  );
  process.exit(1);
}

function copyDir(src, dst) {
  if (!existsSync(src)) {
    console.warn(`  skip ${src} (not present)`);
    return;
  }
  if (existsSync(dst)) rmSync(dst, { recursive: true, force: true });
  cpSync(src, dst, { recursive: true });
  console.log(`  copied ${src} → ${dst}`);
}

console.log("▶ Copying static assets into standalone tree…");
copyDir(staticSrc, staticDst);
copyDir(publicSrc, publicDst);

// Stage runtime deps that Next's standalone trace skips under
// pnpm's strict-isolated linker.
//
// Two distinct reasons a package can be missing from the trace:
//
//   1. `serverExternalPackages` in next.config.ts opts a module
//      out of bundling (e.g. `@signalapp/better-sqlite3` because
//      Turbopack can't bundle .node binaries). NFT then skips
//      them entirely. The Linux Dockerfile (lines 76-102) works
//      around this by hand-staging them into the runner image.
//
//   2. Plain pnpm-isolation tracer gaps: pnpm puts every package
//      under `.pnpm/<name>@<ver>/node_modules/<name>/…`, only
//      the top-level dep gets symlinked into the project root.
//      `@vercel/nft` occasionally fails to copy a transitively-
//      required package into `.next/standalone/node_modules/`
//      even though `require` would resolve it at dev time
//      (e.g. `@swc/helpers/_/_interop_require_default` —
//      observed in 0.120.5).
//
// Fix in both cases: dereference the package via `require.resolve`
// and `cpSync({dereference: true})` into the standalone tree's
// node_modules.
console.log("\n▶ Staging pnpm-isolated runtime deps into standalone tree…");
const standaloneNodeModules = resolve(standaloneDir, "node_modules");

// pnpm's strict-isolated linker only hoists direct dependencies
// to top-level `node_modules`; transitive deps live under
// `.pnpm/<name>@<ver>/node_modules/<name>/` and are NOT visible to
// a default `require.resolve` from the repo root. Resolving them
// requires walking through a parent package's location. The
// Dockerfile's runtime-deps staging uses the same trick — see
// lines 87-102.
function stagePackage(pkgName, fromDir) {
  const opts = fromDir ? { paths: [fromDir] } : undefined;
  const pkgJson = require_.resolve(`${pkgName}/package.json`, opts);
  const srcDir = dirname(pkgJson);
  const dst = resolve(standaloneNodeModules, pkgName);
  if (existsSync(dst)) {
    console.log(`  already present: ${pkgName}`);
    return srcDir;
  }
  mkdirSync(dirname(dst), { recursive: true });
  cpSync(srcDir, dst, { recursive: true, dereference: true });
  console.log(`  staged ${pkgName} ← ${srcDir}`);
  return srcDir;
}

// Resolve `next` first so we can find its transitive deps that
// pnpm hides from top-level resolves. Even with the CI's hoisted
// linker the staging stays as defence-in-depth — `node_modules`
// layout can shift between pnpm versions.
const nextDir = dirname(require_.resolve("next/package.json"));
stagePackage("@swc/helpers", nextDir);
stagePackage("@next/env", nextDir);

// serverExternalPackages chain: each peer's directory is the
// lookup root for the next hop. Same shape as the Dockerfile's
// staged sequence.
const bs3Dir = stagePackage("@signalapp/better-sqlite3");
const bindingsDir = stagePackage("bindings", bs3Dir);
stagePackage("file-uri-to-path", bindingsDir);

// @signalapp/better-sqlite3 ships ~62 MB of node-gyp build
// artifacts (source tree + intermediate object files + the vendored
// SQLite C sources used to compile the addon). Only the compiled
// `build/Release/better_sqlite3.node` (~3.6 MB) is loaded at
// runtime. The Linux Dockerfile trims this at lines 60-70; mirror
// that pattern here so the Windows .exe doesn't carry ~58 MB of
// unreachable build artifacts.
console.log("\n▶ Trimming @signalapp/better-sqlite3 build artifacts…");
const stagedBs3 = resolve(standaloneNodeModules, "@signalapp", "better-sqlite3");
if (existsSync(stagedBs3)) {
  // Keep only build/Release/, drop every other build/ subdir.
  const buildDir = resolve(stagedBs3, "build");
  if (existsSync(buildDir)) {
    for (const entry of ["intermediate", "obj", "obj.target", "deps"]) {
      rmSync(resolve(buildDir, entry), { recursive: true, force: true });
    }
  }
  // Inside build/Release/, keep ONLY the .node binary. (gyp leaves
  // .pdb / .obj / Makefile / cache files behind that aren't needed
  // at load time.)
  const releaseDir = resolve(buildDir, "Release");
  if (existsSync(releaseDir)) {
    for (const name of readdirSync(releaseDir)) {
      if (name === "better_sqlite3.node") continue;
      rmSync(resolve(releaseDir, name), { recursive: true, force: true });
    }
  }
  // The C source + binding spec are only used by node-gyp at
  // compile time; nothing at runtime reads them.
  rmSync(resolve(stagedBs3, "src"), { recursive: true, force: true });
  rmSync(resolve(stagedBs3, "deps"), { recursive: true, force: true });
  rmSync(resolve(stagedBs3, "binding.gyp"), { force: true });
  // Vendored postinstall-only deps (the prebuild fetcher uses them
  // to download the .node binary on `npm install`; at app runtime
  // they're dead weight). Dockerfile lines 155-160.
  for (const name of ["tar", "minipass", "minizlib"]) {
    rmSync(resolve(stagedBs3, "node_modules", name), {
      recursive: true,
      force: true,
    });
  }
  console.log(`  trimmed: ${stagedBs3}`);
}

// Drizzle migrations are read at runtime by `runPendingMigrations()`
// in src/db/index.ts whenever the DB unlocks. Without them the
// migration runner finds no journal and skips every migration —
// the schema then lags behind the code as new releases land.
// The Dockerfile copies `/app/drizzle` into the runner image
// (line 134); we do the equivalent into the standalone root so
// the relative `./drizzle` path resolves at runtime.
console.log("\n▶ Copying drizzle migrations into standalone tree…");
const drizzleSrc = resolve(repoRoot, "drizzle");
const drizzleDst = resolve(standaloneDir, "drizzle");
copyDir(drizzleSrc, drizzleDst);

console.log("\n✓ Electron prepare complete.");
