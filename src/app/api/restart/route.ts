import { NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/api/route-guards";

/**
 * Ask the container orchestrator to restart this process by exiting
 * cleanly. Docker / podman / k8s all restart a container whose main
 * process exits when the restart policy is `unless-stopped` /
 * `always` / `on-failure` — the operator needs one of those set on
 * the container. Without a restart policy this endpoint is a
 * one-way "stop" button; document that expectation in the response.
 *
 * Admin-only — a restart drops every live session on the LAN,
 * flushes the SQLCipher key from memory (the next request will
 * bounce to /unlock), and briefly makes the app unreachable while
 * the runtime comes back up. That's a household-wide action, not
 * a personal one.
 *
 * The response flushes BEFORE `process.exit()` fires via a
 * short setTimeout — otherwise the client sees the connection
 * die mid-response body.
 */
export const POST = withAdminAuth(async () => {
  // Schedule the exit for the next event-loop tick + a small
  // fudge factor so the response has a chance to serialise
  // through Next.js's outbound stream. Node process.exit() is
  // synchronous and doesn't wait on the HTTP response pipe.
  setTimeout(() => {
    // 0 = clean shutdown; the container's restart policy will
    // relaunch us. If no restart policy is set, the container
    // stays stopped — see the note above.
    process.exit(0);
  }, 250);
  return NextResponse.json({
    ok: true,
    message:
      "Restart scheduled. If the container has no restart policy set, it will stay stopped instead of coming back up.",
  });
});
