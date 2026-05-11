import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Permit cross-origin requests during `next dev` from any LAN
  // address — the dev server binds to 0.0.0.0 so phones / other
  // boxes on the same network can hit it. Next matches each `*` to
  // a single hostname label, so IP patterns have to spell out every
  // octet. Production builds ignore this setting; tighten or replace
  // if you want to lock dev down.
  allowedDevOrigins: ["10.*.*.*", "172.16.*.*", "192.168.*.*"],
  // Native module — Turbopack/Webpack can't bundle the `.node` binary,
  // so opt out and let Node's runtime `require` resolve it normally.
  // (Upstream `better-sqlite3` is in Next's built-in allowlist, but
  // `@signalapp/better-sqlite3` is not.)
  serverExternalPackages: ["@signalapp/better-sqlite3"],
};

export default nextConfig;
