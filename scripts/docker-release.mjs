#!/usr/bin/env node
/**
 * docker:release — build, tag (× 3), and push the budgets image.
 * Runtime-agnostic: prefers `docker` on PATH, falls back to
 * `podman`, or honours `CONTAINER_RUNTIME` if set explicitly. Both
 * engines accept the same build/tag/push args.
 *
 * Configuration via env vars:
 *   DOCKER_REGISTRY   — registry hostname or hub-shaped namespace.
 *                       Examples:
 *                         docker.io/your-username   (Docker Hub)
 *                         ghcr.io/your-username     (GitHub CR)
 *                         registry.example.lan      (private LAN)
 *                       Required — the script refuses to publish
 *                       without an explicit target so you can never
 *                       accidentally push to the wrong place.
 *   DOCKER_IMAGE      — image name within the registry. Default
 *                       `budgets`.
 *   CONTAINER_RUNTIME — force a specific binary (else auto-detect).
 *
 * Usage:
 *   DOCKER_REGISTRY=docker.io/you npm run docker:release
 *   npm run docker:release -- --allow-dirty   # emergency override
 *   npm run docker:release -- --dry-run       # print, don't run anything
 *
 * Tags published, all pointing at the same digest:
 *   <registry>/<image>:<semver>      # from package.json
 *   <registry>/<image>:<short-sha>   # immutable per commit
 *   <registry>/<image>:latest        # convenience pointer
 *
 * The SHA tag is the truth source for "what's running where" — pin
 * cluster manifests to it. Semver is the human handle. Latest is
 * mutable and overwritten on every push.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const REGISTRY = process.env.DOCKER_REGISTRY?.trim();
const IMAGE = process.env.DOCKER_IMAGE?.trim() || "budgets";
if (!REGISTRY) {
  console.error(
    "✗ DOCKER_REGISTRY is required — set it to e.g. docker.io/<your-username> or your private registry hostname.",
  );
  process.exit(1);
}
const FQN = `${REGISTRY}/${IMAGE}`;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(
  readFileSync(resolve(repoRoot, "package.json"), "utf8"),
);
const allowDirty = process.argv.includes("--allow-dirty");
const dryRun = process.argv.includes("--dry-run");

/** Pick a container runtime. Honour the env override first, then
 * prefer docker (most common in CI), then fall back to podman. The
 * resolved binary's CLI gets used uniformly via `runtime(...)` below. */
function resolveRuntime() {
  const explicit = process.env.CONTAINER_RUNTIME?.trim();
  if (explicit) return explicit;
  for (const candidate of ["docker", "podman"]) {
    const probe = spawnSync(candidate, ["--version"], { stdio: "ignore" });
    if (probe.status === 0) return candidate;
  }
  return null;
}

const runtimeName = resolveRuntime();
if (!runtimeName && !dryRun) {
  console.error(
    "✗ No container runtime found. Install docker or podman (or set CONTAINER_RUNTIME).",
  );
  process.exit(127);
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    stdio: opts.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: "utf8",
    cwd: repoRoot,
    ...opts,
  });
  if (res.error?.code === "ENOENT") {
    console.error(`✗ ${cmd} not found on PATH`);
    process.exit(127);
  }
  if (res.status !== 0) {
    if (opts.capture) {
      process.stderr.write(res.stderr ?? "");
    }
    process.exit(res.status ?? 1);
  }
  return (res.stdout ?? "").trim();
}

function git(...args) {
  return run("git", args, { capture: true });
}

function runtime(args, opts = {}) {
  const name = runtimeName ?? "docker";
  if (dryRun) {
    console.log(`  (dry-run) ${name} ${args.join(" ")}`);
    return "";
  }
  return run(name, args, opts);
}

const shortSha = git("rev-parse", "--short", "HEAD");
const dirty = git("status", "--porcelain");
if (dirty && !allowDirty) {
  console.error(
    `\n✗ Refusing to release: working tree is dirty.\n  Commit or stash, or pass --allow-dirty if you really mean it.\n\n${dirty}\n`,
  );
  process.exit(1);
}

const version = pkg.version;
if (!version) {
  console.error("✗ package.json is missing a version field.");
  process.exit(1);
}

const sha = dirty ? `${shortSha}-dirty` : shortSha;
const shaTag = `${FQN}:${sha}`;
const versionTag = `${FQN}:${version}`;
const latestTag = `${FQN}:latest`;

const rtLabel = runtimeName ?? "(no runtime)";
console.log(`\n▶ Releasing budgets${dryRun ? "  (dry-run)" : ""}`);
console.log(`  runtime  ${rtLabel}`);
console.log(`  version  ${version}`);
console.log(`  sha      ${sha}${dirty ? "  (dirty — only because --allow-dirty)" : ""}`);
console.log(`  tags     ${shaTag}`);
console.log(`           ${versionTag}`);
console.log(`           ${latestTag}\n`);

console.log(`▶ ${rtLabel} build…`);
runtime(["build", "-t", shaTag, "."]);

console.log(`\n▶ ${rtLabel} tag…`);
runtime(["tag", shaTag, versionTag]);
runtime(["tag", shaTag, latestTag]);

console.log(`\n▶ ${rtLabel} push…`);
runtime(["push", shaTag]);
runtime(["push", versionTag]);
runtime(["push", latestTag]);

console.log("\n▶ Resolving digest…");

/** Ask the registry directly for the manifest digest of a given tag.
 * podman's local RepoDigests has been observed to lag behind the
 * registry — re-pushing or re-tagging an image keeps the OLD push's
 * digest in podman's cache, which then gets reported here as the
 * "released" digest even though that hash 404s on the registry.
 * Pulling the Docker-Content-Digest header from /v2/.../manifests/
 * is the canonical answer the cluster will use. */
function fetchRegistryDigest(tag) {
  const reg = REGISTRY;
  const ref = tag.replace(`${FQN}:`, "");
  const accept = "application/vnd.oci.image.manifest.v1+json";
  // Try HTTPS first, fall back to HTTP. The LAN registry runs HTTP,
  // but a future TLS roll-out shouldn't need a script edit.
  for (const scheme of ["https", "http"]) {
    const res = spawnSync(
      "curl",
      ["-sIk", "-H", `Accept: ${accept}`, `${scheme}://${reg}/v2/${IMAGE}/manifests/${ref}`],
      { encoding: "utf8" },
    );
    if (res.status !== 0 || !res.stdout) continue;
    const m = res.stdout.match(/^Docker-Content-Digest:\s*(sha256:[0-9a-f]+)/im);
    if (m) return m[1];
  }
  return null;
}

const digest = dryRun
  ? "(dry-run) curl /v2/<image>/manifests/<tag> -> Docker-Content-Digest"
  : fetchRegistryDigest(shaTag) ?? "(not reported by registry)";

console.log(`\n${dryRun ? `✓ Dry-run complete — ${rtLabel} not invoked` : "✓ Released"}
  ${shaTag}
  ${versionTag}
  ${latestTag}
  digest: ${digest}\n`);
