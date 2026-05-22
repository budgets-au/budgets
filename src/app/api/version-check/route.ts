import { NextResponse } from "next/server";
import { compareSemver } from "@/lib/semver-compare";
import { parseNextLink } from "./parse-next-link";
import { withAuth } from "@/lib/api/route-guards";

const GHCR_PACKAGE = "budgets-au/budgets";
const TOKEN_URL = `https://ghcr.io/token?service=ghcr.io&scope=repository:${GHCR_PACKAGE}:pull`;
const TAGS_URL = `https://ghcr.io/v2/${GHCR_PACKAGE}/tags/list`;

interface SuccessResp {
  latest: string;
}

interface ErrorResp {
  error: string;
}

/** Polls GHCR for the latest semver tag of the budgets image.
 *
 * Auth dance:
 *   1. GET the anonymous token endpoint — works for public
 *      packages without any operator-supplied credentials.
 *   2. Use the token on the tags/list endpoint.
 *
 * If the package is private (token endpoint refuses anonymous
 * access), retry with `Bearer $GITHUB_TOKEN` from the env. When
 * neither path works the route returns a 200 with `{ error }` so
 * the UI's SWR loop doesn't surface a transient infra issue as a
 * scary error to the operator; the indicator just stays hidden.
 *
 * Response is `revalidate`d for an hour so SWR's poll + Next's
 * fetch cache de-dupe to one upstream hit per hour per node.
 */
export const revalidate = 3600;

export const GET = withAuth(async () => {
  // Issue #52: every branch now returns a stable
  // `{ latest: string | null }` shape with status 200. Previously
  // success was `{ latest }` and failure was `{ error }` both at 200,
  // letting `if (res.ok) data.latest.split(...)` blow up on undefined.
  // Detail strings for upstream / parse failures go to the server log
  // only (no operator-facing toast for a transient registry blip).
  try {
    const latest = await fetchLatestTag();
    return NextResponse.json({ latest: latest ?? null });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[version-check]", message);
    return NextResponse.json({ latest: null });
  }
});

async function fetchLatestTag(): Promise<string | null> {
  // Try anonymous first. GHCR public packages always honour the
  // anonymous token grant; if the response carries usable creds,
  // great.
  const anonToken = await tokenFetch();
  if (anonToken) {
    const tags = await listTags(anonToken);
    if (tags != null) return pickLatest(tags);
  }
  // Fall through to authed retry when an env token is available.
  const githubToken = process.env.GITHUB_TOKEN?.trim();
  if (!githubToken) throw new Error("private package - set GITHUB_TOKEN");
  const authedTags = await listTags(githubToken);
  if (authedTags == null) {
    throw new Error("GHCR rejected GITHUB_TOKEN");
  }
  return pickLatest(authedTags);
}

async function tokenFetch(): Promise<string | null> {
  const res = await fetch(TOKEN_URL, { cache: "no-store" });
  if (!res.ok) return null;
  const body = (await res.json()) as { token?: string };
  return body.token ?? null;
}

async function listTags(token: string): Promise<string[] | null> {
  // GHCR caps tags/list at 100 entries per response and signals
  // "more available" via a `Link: <...?last=X&n=100>; rel="next"`
  // header (per the OCI distribution spec). Without following it
  // the indicator silently stops seeing new releases once the
  // tag count crosses 100, which surfaces as "new release not
  // detected". Walk pages until the next-link is absent. Cap at
  // 50 pages so a broken registry loop can't hang the request —
  // at 100/page that's 5000 tags before we give up, which is
  // well past any realistic release history.
  const all: string[] = [];
  let url: string | null = TAGS_URL;
  for (let i = 0; i < 50 && url; i++) {
    const res: Response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      // Outer Next route segment cache handles repeat hits; the
      // fetch call itself shouldn't be cached again at this layer.
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { tags?: string[] };
    all.push(...(body.tags ?? []));
    url = parseNextLink(res.headers.get("link"));
  }
  return all;
}


function pickLatest(tags: string[]): string | null {
  const semverOnly = tags.filter((t) => /^\d+\.\d+\.\d+$/.test(t));
  if (semverOnly.length === 0) return null;
  semverOnly.sort((a, b) => -compareSemver(a, b));
  return semverOnly[0];
}
