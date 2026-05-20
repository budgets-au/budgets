import { describe, expect, it } from "vitest";
import { z } from "zod";
import { badRequest, parseJsonBody, type BadRequestBody } from "./parse-body";

const schema = z.object({
  name: z.string().min(1),
  count: z.number().int().min(1).max(31),
});

/** Build a minimal `Request` whose `.json()` resolves to `body`,
 *  or rejects when `body === "INVALID"` — lets us exercise the
 *  json-parse branch without spinning up a real fetch. */
function fakeRequest(body: unknown): Request {
  return {
    json: async () => {
      if (body === "INVALID") {
        throw new SyntaxError("Unexpected token in JSON");
      }
      return body;
    },
  } as unknown as Request;
}

describe("parseJsonBody", () => {
  it("returns ok=true + parsed data on a valid body", async () => {
    const res = await parseJsonBody(
      fakeRequest({ name: "Rent", count: 5 }),
      schema,
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data).toEqual({ name: "Rent", count: 5 });
    }
  });

  it("returns ok=false + 400 NextResponse with the zod issue tree on schema failure", async () => {
    const res = await parseJsonBody(
      fakeRequest({ name: "", count: 99 }),
      schema,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.response.status).toBe(400);
      const body = (await res.response.json()) as BadRequestBody;
      expect(body.error).toBe("Invalid request body");
      // Both fields tripped — name (min 1) and count (max 31).
      const paths = body.issues.map((i) => i.path).sort();
      expect(paths).toContain("count");
      expect(paths).toContain("name");
      // Each issue carries a machine-readable code + a message.
      for (const issue of body.issues) {
        expect(typeof issue.code).toBe("string");
        expect(issue.message.length).toBeGreaterThan(0);
      }
    }
  });

  it("flattens nested paths into dot-form (path: 'nested.field')", async () => {
    const nested = z.object({ outer: z.object({ inner: z.number() }) });
    const res = await parseJsonBody(
      fakeRequest({ outer: { inner: "not-a-number" } }),
      nested,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      const body = (await res.response.json()) as BadRequestBody;
      expect(body.issues[0].path).toBe("outer.inner");
    }
  });

  it("returns a 400 when the request body isn't valid JSON", async () => {
    const res = await parseJsonBody(fakeRequest("INVALID"), schema);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.response.status).toBe(400);
      const body = (await res.response.json()) as BadRequestBody;
      expect(body.error).toBe("Invalid JSON body");
      expect(body.issues[0].code).toBe("invalid_json");
    }
  });
});

describe("badRequest", () => {
  it("emits the same BadRequestBody shape as schema rejections so clients can render both uniformly", async () => {
    const res = badRequest("accountId is required", "accountId");
    expect(res.status).toBe(400);
    const body = (await res.json()) as BadRequestBody;
    expect(body.error).toBe("accountId is required");
    expect(body.issues).toEqual([
      {
        path: "accountId",
        message: "accountId is required",
        code: "cross_field",
      },
    ]);
  });

  it("works without an explicit field — defaults the path to empty", async () => {
    const res = badRequest("transfer-out needs a destination");
    const body = (await res.json()) as BadRequestBody;
    expect(body.issues[0].path).toBe("");
  });
});
