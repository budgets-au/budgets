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
import { cpSync, existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

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

console.log("\n✓ Electron prepare complete.");
