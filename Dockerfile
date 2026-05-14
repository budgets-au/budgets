# Stage 1: Dependencies
FROM node:22-alpine AS deps
WORKDIR /app
# @signalapp/better-sqlite3 ships native modules — needs python3 + a C++
# toolchain to compile against the alpine image's libc when the prebuilt
# binary doesn't match. These are deps-stage-only; the runner image
# stays small.
RUN apk add --no-cache python3 make g++
# pnpm via Corepack — the `packageManager` field in package.json pins
# the exact version. `corepack prepare` pre-fetches that version so the
# subsequent `pnpm install` doesn't pause the build to download.
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN corepack prepare --activate \
 && pnpm install --frozen-lockfile

# Stage 2: Build
FROM node:22-alpine AS builder
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
# @signalapp/better-sqlite3 ships ~62 MB of native-build artefacts
# (object files, gyp targets, the SQLite C source tree) that
# node-gyp uses to compile and the runtime never re-reads. Only
# `build/Release/better_sqlite3.node` is loaded via the require-
# hook in lib/database.js.
#
# Sharp ships per-libc prebuilt libvips bundles. The container's
# Alpine base is musl, so the glibc variants are pure dead weight.
# Slimmed in both ./node_modules (the explicit COPY path) and the
# Next standalone bundle (the path that ships sharp at runtime).
RUN set -e \
 && find ./node_modules/@signalapp/better-sqlite3/build \
      -mindepth 1 -maxdepth 1 \
      -not -name 'Release' \
      -exec rm -rf {} + \
 && find ./node_modules/@signalapp/better-sqlite3/build/Release \
      -mindepth 1 -maxdepth 1 \
      -not -name 'better_sqlite3.node' \
      -exec rm -rf {} + \
 && rm -rf ./node_modules/@signalapp/better-sqlite3/src \
           ./node_modules/@signalapp/better-sqlite3/deps \
           ./node_modules/@signalapp/better-sqlite3/binding.gyp \
 && rm -rf ./node_modules/@img/sharp-libvips-linux-x64 \
           ./node_modules/@img/sharp-linux-x64 \
 && if [ -d ./.next/standalone/node_modules/@img ]; then \
      rm -rf ./.next/standalone/node_modules/@img/sharp-libvips-linux-x64 \
             ./.next/standalone/node_modules/@img/sharp-linux-x64; \
    fi

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

# SQLCipher driver — Next's NFT skips it (next.config.ts marks
# @signalapp/better-sqlite3 as a serverExternalPackage because
# Turbopack can't bundle the .node binary), so it's NOT in the
# standalone's traced node_modules. Copy explicitly along with its
# `bindings` resolver. If any future serverExternalPackage gets
# added in next.config.ts, it needs an equivalent COPY here too.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@signalapp ./node_modules/@signalapp
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/bindings ./node_modules/bindings
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/file-uri-to-path ./node_modules/file-uri-to-path

# Slim the image to just what `node server.js` actually reads. The
# Next.js `output: "standalone"` bundle copies a chunk of the source
# tree (Dockerfile, docker-compose.yml, src/, configs, lockfile) and
# the full root package.json — none of which is required at runtime.
# Container scanners read package-lock.json and the full deps list
# and report CVEs against transitive packages we don't actually ship,
# so removing these silences ~all of the noise without behaviour
# change.
#
# We also strip vendored bundles inside @signalapp/better-sqlite3 that
# only the postinstall prebuild fetcher uses (tar / minipass /
# minizlib). next/dist/compiled/tar is similarly safe to drop —
# verified by smoke-test that `node server.js` boots without it.
# next/dist/compiled/cross-spawn is NOT safe to drop: Next 16's CLI
# config-schema chain (server.js → start-server → config-schema →
# next-test → install-dependencies) loads it at boot.
RUN set -e \
 && rm -f ./package-lock.json ./pnpm-lock.yaml ./Dockerfile ./docker-compose.yml \
          ./components.json ./drizzle.config.ts ./eslint.config.mjs \
          ./next.config.ts ./postcss.config.mjs ./tsconfig.json \
 && rm -rf ./src ./scripts \
 && rm -rf ./node_modules/next/dist/compiled/tar \
           ./node_modules/@signalapp/better-sqlite3/node_modules/tar \
           ./node_modules/@signalapp/better-sqlite3/node_modules/minipass \
           ./node_modules/@signalapp/better-sqlite3/node_modules/minizlib \
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
