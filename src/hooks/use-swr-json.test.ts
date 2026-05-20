import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonFetcher } from "./use-swr-json";

const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = vi.fn();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("jsonFetcher", () => {
  it("returns parsed JSON on a 2xx response", async () => {
    const payload = { id: "abc", value: 42 };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => payload,
    });
    await expect(jsonFetcher<typeof payload>("/api/x")).resolves.toEqual(
      payload,
    );
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/x");
  });

  it("throws on non-2xx — message embeds url + status so SWR's error surface is useful", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: "not found" }),
    });
    await expect(jsonFetcher("/api/missing")).rejects.toThrow(
      "/api/missing → 404",
    );
  });

  it("throws on 500 too — any non-ok status fails the fetch", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    });
    await expect(jsonFetcher("/api/oops")).rejects.toThrow("/api/oops → 500");
  });

  it("propagates network failures (fetch itself rejecting)", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new TypeError("network down"),
    );
    await expect(jsonFetcher("/api/unreachable")).rejects.toThrow(
      "network down",
    );
  });
});
