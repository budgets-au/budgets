# Stage 1: Dependencies
FROM node:22-alpine AS deps
WORKDIR /app
# better-sqlite3-multiple-ciphers (aliased to `better-sqlite3` in
# package.json) ships prebuilt `.node` binaries for `linuxmusl-x64`
# and `linuxmusl-arm64` — the alpine base loads them directly. No
# native compile step, so no python3/make/g++ needed here.
# pnpm via Corepack — the `packageManager` field in package.json pins
# the exact version. `corepack prepare` pre-fetches that version so the
# subsequent `pnpm install` doesn't pause the build to download.
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN corepack prepare --activate \
 && pnpm install --frozen-lockfile

# Stage 2: Build
FROM node:22-alpine AS builder
# `TARGETARCH` is set automatically by `docker buildx` to the
# target platform's arch tag (`amd64`, `arm64`, …). We use it to
# strip the OPPOSITE-arch sharp prebuilds — keeping both would
# bloat the image, removing the wrong one would break the runtime.
# When building outside buildx (`docker build`, `podman build`)
# the arg defaults to amd64; override with `--build-arg TARGETARCH=arm64`
# if you need a single-arch arm build via plain `docker build`.
ARG TARGETARCH=amd64
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# `:memory:` rather than a file path: Next's "Collecting page data"
# step spawns ~7 workers that each evaluate src/db/index.ts and run
# the auto-unlock + runPendingMigrations dance against whatever
# SQLITE_PATH points at. A single file would have all 7 workers
# locking it concurrently → SQLITE_BUSY. `:memory:` gives each
# worker process its own private throwaway DB.
ENV SQLITE_PATH=":memory:"
ENV AUTH_SECRET=build-time-placeholder
ENV NEXTAUTH_SECRET=build-time-placeholder
# Build-time placeholder so module-eval at compile time doesn't trip
# the unlock guard. The runner image overrides this with the real
# key supplied by the operator.
ENV SQLITE_KEY=build-time-placeholder
RUN corepack enable && pnpm build

# Slim the dependencies the runner stage will copy. CRITICAL that
# this happens here in the builder, not in the runner: a `rm` in a
# later layer only hides files via overlay, the bytes still ship.
# Trimming BEFORE the runner's COPY actually shrinks the layer
# transferred across.
#
# better-sqlite3-multiple-ciphers ships prebuild-only (no `src/`,
# `deps/`, `binding.gyp`, or object-file build tree — that's the
# whole point of the migration off @signalapp/better-sqlite3 which
# vendored a 62 MB source tree we had to prune). So no
# better-sqlite3 prune block is needed here.
#
# Sharp ships per-libc prebuilt libvips bundles. The container's
# Alpine base is musl, so the glibc variants are pure dead weight.
# Only the standalone bundle ships sharp at runtime, so that's the
# only path we need to slim.
RUN set -e \
 && if [ -d ./.next/standalone/node_modules/@img ]; then \
      # Strip the OTHER arch's sharp prebuild bundles so the image
      # only ships the one that matches TARGETARCH. The mapping is
      # the literal arch tag for amd64 (`x64`) and the libvips
      # variant suffix for arm64 (`arm64v8`). The amd64 directory
      # name uses `linux-x64` because npm's prebuild tarballs
      # historically tracked Node's process.arch which reports `x64`
      # rather than `amd64` on 64-bit Intel.
      case "$TARGETARCH" in \
        amd64) \
          rm -rf ./.next/standalone/node_modules/@img/sharp-libvips-linux-arm64v8 \
                 ./.next/standalone/node_modules/@img/sharp-linux-arm64 ;; \
        arm64) \
          rm -rf ./.next/standalone/node_modules/@img/sharp-libvips-linux-x64 \
                 ./.next/standalone/node_modules/@img/sharp-linux-x64 ;; \
        *) \
          echo "WARN: unrecognised TARGETARCH=$TARGETARCH; skipping sharp prebuild trim" >&2 ;; \
      esac; \
    fi

# Stage the SQLCipher driver + its native-resolver deps into a flat
# layout the runner can COPY without knowing pnpm's version-hashed
# sub-dir names. Under the isolated linker each package's
# transitives live alongside it in .pnpm/<pkg>@<ver>/node_modules/,
# NOT hoisted to the top-level node_modules. bindings is a peer of
# better-sqlite3, and file-uri-to-path is a peer of bindings
# (different sub-dir again) — hand-walking that chain with
# realpath/dirname is fragile, so use Node's own resolver
# (`require.resolve`) which already understands pnpm's layout.
# `fs.cpSync` with `dereference:true` flattens the symlinks the
# same way `cp -RL` would.
#
# `better-sqlite3` is a package.json alias to
# `better-sqlite3-multiple-ciphers`; require.resolve returns the
# real package directory under .pnpm/<hash>/, and we stage it
# under `better-sqlite3/` so the runtime `import Database from
# "better-sqlite3"` resolves.
RUN node -e ' \
  const fs = require("fs"); \
  const path = require("path"); \
  const out = "/app/runtime-deps"; \
  fs.mkdirSync(out, { recursive: true }); \
  function stage(pkg, dest, fromPaths) { \
    const opts = fromPaths ? { paths: fromPaths } : undefined; \
    const pkgJson = require.resolve(pkg + "/package.json", opts); \
    const srcDir = path.dirname(pkgJson); \
    fs.cpSync(srcDir, path.join(out, dest), { recursive: true, dereference: true }); \
    return srcDir; \
  } \
  const bs3      = stage("better-sqlite3",   "better-sqlite3"); \
  const bindings = stage("bindings",         "bindings",         [bs3]); \
  /**/             stage("file-uri-to-path", "file-uri-to-path", [bindings]); \
'

# Stage 3: Runner
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Pull any newer apk revisions of the base packages — covers the Alpine
# security tracker's busybox / openssl / etc. between the time the
# `node:22-alpine` tag was cut and now. No-op when nothing newer is
# published.
RUN apk update && apk upgrade --no-cache && rm -rf /var/cache/apk/*

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# /data holds the SQLite file (mount as a docker volume); created at boot
# by the migrate runner if missing.
RUN mkdir -p /data && chown nextjs:nodejs /data

# Self-contained Next.js server. Has its own minimal NFT-traced
# node_modules + server.js + package.json — that's all `node
# server.js` reads. Skipping the full deps-stage node_modules cuts
# the image from ~1.2 GB down to ~280 MB.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Drizzle migrations — read at runtime by `runPendingMigrations()`
# in src/db/index.ts whenever the DB unlocks. The migrator itself
# (drizzle-orm/better-sqlite3) is in the standalone NFT trace.
COPY --from=builder --chown=nextjs:nodejs /app/drizzle ./drizzle

# SQLCipher driver — Next's NFT marks better-sqlite3 as a
# serverExternalPackage (Turbopack can't bundle the .node binary)
# but its standalone trace STILL ships a partial stub at
# ./node_modules/better-sqlite3 (a pnpm-style symlink into the
# deps store), plus bindings + file-uri-to-path. Those stubs are
# useless without the real native module and they break the
# subsequent `COPY` because:
#   - On classic docker / podman, COPY into an existing symlink
#     silently overwrites it with the directory contents (we
#     relied on this).
#   - On buildkit's overlayfs driver (used by buildx for
#     multi-arch) the same COPY errors with "cannot copy to
#     non-directory" because the cache-mount overlay refuses to
#     replace the symlink with a directory.
# Solving by deleting the stubs first, then COPY'ing the staged
# runtime-deps. Works under both driver families.
RUN rm -rf ./node_modules/better-sqlite3 ./node_modules/bindings ./node_modules/file-uri-to-path
COPY --from=builder --chown=nextjs:nodejs /app/runtime-deps/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=builder --chown=nextjs:nodejs /app/runtime-deps/bindings ./node_modules/bindings
COPY --from=builder --chown=nextjs:nodejs /app/runtime-deps/file-uri-to-path ./node_modules/file-uri-to-path

# Slim the image to just what `node server.js` actually reads. The
# Next.js `output: "standalone"` bundle copies a chunk of the source
# tree (Dockerfile, docker-compose.yml, src/, configs, lockfile) and
# the full root package.json — none of which is required at runtime.
# Container scanners read package-lock.json and the full deps list
# and report CVEs against transitive packages we don't actually ship,
# so removing these silences ~all of the noise without behaviour
# change.
#
# The tar/minipass/minizlib strip that used to sit here (vendored
# by @signalapp/better-sqlite3's postinstall prebuild fetcher) is
# gone with the migration to better-sqlite3-multiple-ciphers — that
# fork ships prebuild-only, no tar dep anywhere in the tree. Still
# strip next/dist/compiled/tar (Next's internal helper) — safe to
# drop, verified by smoke-test that `node server.js` boots.
# next/dist/compiled/cross-spawn is NOT safe to drop: Next 16's CLI
# config-schema chain (server.js → start-server → config-schema →
# next-test → install-dependencies) loads it at boot.
RUN set -e \
 && rm -f ./package-lock.json ./pnpm-lock.yaml ./Dockerfile ./docker-compose.yml \
          ./components.json ./drizzle.config.ts ./eslint.config.mjs \
          ./next.config.ts ./postcss.config.mjs ./tsconfig.json \
 && rm -rf ./src ./scripts \
 && rm -rf ./node_modules/next/dist/compiled/tar \
 && printf '%s\n' '{' \
      '  "name": "budgets",' \
      '  "version": "0.1.0",' \
      '  "private": true' \
      '}' > ./package.json

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV SQLITE_PATH=/data/budget.db
# SQLITE_KEY is optional at run time. If unset the app comes up locked
# and the proxy redirects every request to /unlock until the operator
# enters a passphrase (the first POST creates the DB if missing).
# Set it in the container env to auto-unlock on boot. The build-stage
# placeholder above only exists so the Next.js compiler can import the
# db module during build; it never reaches runtime.

# Liveness probe — /api/unlock answers without auth or an unlocked
# DB, so it's the safest "is the server reachable?" endpoint. busybox
# wget ships with the alpine base, so no extra packages.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/unlock >/dev/null || exit 1

# Next.js's standalone output writes the server entrypoint to
# /app/server.js. Without an explicit CMD the base node image falls
# back to `node` (REPL on stdin) and exits 0 immediately when there's
# no TTY — the original "container starts then disappears" symptom.
CMD ["node", "server.js"]
