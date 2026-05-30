import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve as resolvePath, sep } from "node:path";

/** Static guard against the 0.295.0-class regression: a `"use client"`
 *  component (directly or transitively) importing `@/db`, which drags
 *  `better-sqlite3` + the backup subsystem into the browser bundle and
 *  fails `next build` with "Module not found".
 *
 *  `pnpm tsc --noEmit` doesn't catch it (no type-level constraint
 *  expresses "no server modules in the client bundle"). `pnpm test`
 *  doesn't either — vitest runs in node, so server imports work
 *  fine there. Only the production Next build hits the error, which
 *  is too late to catch in a pre-release loop.
 *
 *  This test walks the import graph from every `"use client"` file in
 *  `src/` and asserts that no chain reaches a forbidden module. It's
 *  pure static analysis — regex-based import extraction, no AST, no
 *  Next build — so it adds well under a second to the suite.
 *
 *  Forbidden prefixes are deliberately tight: just `@/db` and
 *  `@/lib/backup/`, the two modules that triggered 0.295. Extend if
 *  a new leak shape emerges. */

const SRC_ROOT = resolvePath(__dirname, "..");
const FORBIDDEN_PREFIXES = ["@/db", "@/lib/backup/"] as const;

// Match both `import … from "x"` and `export … from "x"`. Captures the
// specifier. Doesn't try to handle `import("x")` dynamic imports — the
// codebase uses one intentional dynamic require in unlock() to AVOID
// static `@/db` cycles, and flagging it would be a false positive.
const FROM_RE = /(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/g;
// Side-effect-only imports: `import "x"`.
const BARE_IMPORT_RE = /^\s*import\s+["']([^"']+)["']/gm;

/** Walk every .ts/.tsx file under `src/`, skipping node_modules-ish
 *  paths and the test files themselves (the guard isn't trying to
 *  police test/fixture imports). */
function walkSrcFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      walkSrcFiles(full, out);
    } else if (
      (entry.endsWith(".ts") || entry.endsWith(".tsx")) &&
      !entry.endsWith(".test.ts") &&
      !entry.endsWith(".test.tsx") &&
      !entry.endsWith(".integration.test.ts") &&
      !entry.endsWith(".bench.ts")
    ) {
      out.push(full);
    }
  }
  return out;
}

/** True when the file begins with a `"use client"` directive (after
 *  optional shebang / comments / blank lines). */
function isClientFile(absPath: string): boolean {
  const src = readFileSync(absPath, "utf8");
  // The directive must be the first STATEMENT in the file. Strip
  // leading shebang + block / line comments + whitespace, then check
  // the first non-empty token.
  const stripped = src
    .replace(/^#!.*\n/, "")
    .replace(/^\s*\/\*[\s\S]*?\*\/\s*/, "")
    .replace(/^(?:\s*\/\/[^\n]*\n)+/, "")
    .trimStart();
  return (
    stripped.startsWith('"use client"') ||
    stripped.startsWith("'use client'")
  );
}

function extractImports(src: string): string[] {
  // Strip type-only imports/exports — these are erased at compile
  // time, never bundled, so they can't leak server modules into the
  // client.
  //   import type { Foo } from "..."
  //   import type Foo from "..."
  //   export type { Foo } from "..."
  // Components legitimately reach into `@/db/schema` for Drizzle row
  // types (Account, Category, etc.) — those are pure type imports.
  // Without this strip, every such component would false-positive.
  const stripped = src.replace(
    /^[ \t]*(?:import|export)\s+type\s[^;]*?(?:;|$)/gm,
    "",
  );
  // Also strip `import { type X, type Y } from "..."` — when EVERY
  // named import inside the braces is prefixed with `type`, the
  // whole statement is type-only at runtime.
  //
  // The previous regex used a nested `+` over a sub-pattern that
  // started AND ended with `\s*`, which CodeQL flagged as a ReDoS
  // (js/redos #18 — exponential backtracking on inputs like
  // `import {{type $type $type $…`). Split into a flat capture of
  // the braces' content plus a plain-JS all-`type` check; no
  // nested quantifiers, no backtracking.
  const importLine = /^[ \t]*(?:import|export)\s+\{([^}]*)\}\s+from\s+["'][^"']+["'];?\s*$/gm;
  const fullyTyped = stripped.replace(importLine, (full, inside: string) => {
    const parts = inside
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    if (parts.length === 0) return full;
    const allType = parts.every((p) =>
      /^type\s+[A-Za-z_$][\w$]*(?:\s+as\s+[A-Za-z_$][\w$]*)?$/.test(p),
    );
    return allType ? "" : full;
  });
  const out = new Set<string>();
  for (const m of fullyTyped.matchAll(FROM_RE)) out.add(m[1]);
  for (const m of fullyTyped.matchAll(BARE_IMPORT_RE)) out.add(m[1]);
  return Array.from(out);
}

/** Resolve a specifier to an absolute file path under `src/` if
 *  possible, returning null for externals (`react`, `lucide-react`,
 *  `drizzle-orm`, etc.). Tries the usual `.ts` / `.tsx` /
 *  `/index.ts` / `/index.tsx` resolutions; doesn't follow the
 *  full Node resolution dance. */
function resolveSpecifier(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) {
    base = join(SRC_ROOT, spec.slice(2));
  } else if (spec.startsWith(".")) {
    base = resolvePath(dirname(fromFile), spec);
  } else {
    return null; // external module
  }
  for (const cand of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    try {
      const st = statSync(cand);
      if (st.isFile()) return cand;
    } catch {
      /* not a file */
    }
  }
  return null;
}

function relSrc(absPath: string): string {
  return relative(SRC_ROOT, absPath).split(sep).join("/");
}

/** BFS the import graph from `entry`. Returns the first chain
 *  (list of relative-to-src paths) that ends at a forbidden
 *  specifier, or null if no chain reaches one. */
function findForbiddenChain(
  entry: string,
  forbidden: ReadonlyArray<string>,
  importsCache: Map<string, string[]>,
): string[] | null {
  // BFS so the chain we return is the shortest one; easier to read
  // when there are multiple paths to the same leak.
  const queue: { file: string; chain: string[] }[] = [
    { file: entry, chain: [relSrc(entry)] },
  ];
  const seen = new Set<string>([entry]);
  while (queue.length > 0) {
    const { file, chain } = queue.shift()!;
    let specifiers = importsCache.get(file);
    if (!specifiers) {
      specifiers = extractImports(readFileSync(file, "utf8"));
      importsCache.set(file, specifiers);
    }
    for (const spec of specifiers) {
      // The forbidden check runs on the SPECIFIER, not the resolved
      // path, so we catch `@/db/index.ts` AND `@/lib/backup/anything`
      // by their alias-prefix shape — same shape the caller wrote.
      for (const bad of forbidden) {
        if (spec === bad || spec.startsWith(bad)) {
          return [...chain, spec];
        }
      }
      const resolved = resolveSpecifier(spec, file);
      if (resolved && !seen.has(resolved)) {
        seen.add(resolved);
        queue.push({ file: resolved, chain: [...chain, relSrc(resolved)] });
      }
    }
  }
  return null;
}

const ENTRYPOINTS = walkSrcFiles(SRC_ROOT).filter(isClientFile);
// Share an imports cache across the it.each rows — most "use client"
// files end up traversing the same lib/* sub-tree, so a 2nd pass
// shouldn't re-read + re-regex every file.
const importsCache = new Map<string, string[]>();

describe("client bundle stays free of server-only modules", () => {
  it("finds at least one 'use client' entrypoint to scan (sanity)", () => {
    // If the walker breaks or the heuristic stops matching `"use
    // client"`, every entrypoint test would skip and the suite would
    // silently lose its safety net. This guard makes that scream.
    expect(ENTRYPOINTS.length).toBeGreaterThan(10);
  });

  it.each(ENTRYPOINTS.map((p) => [relSrc(p), p] as const))(
    "%s does not transitively import @/db or @/lib/backup",
    (_label, entry) => {
      const chain = findForbiddenChain(
        entry,
        FORBIDDEN_PREFIXES,
        importsCache,
      );
      if (chain) {
        throw new Error(
          `Client-bundle leak detected.\n` +
            `  ${chain.join("\n  → ")}\n` +
            `\nThis chain pulls a server-only module into the browser bundle.\n` +
            `Next.js will fail \`pnpm build\` on it. Break the chain by\n` +
            `splitting the offending lib file into a pure (no-DB) module —\n` +
            `see src/lib/category-tree.ts for the canonical pattern.`,
        );
      }
    },
  );
});
