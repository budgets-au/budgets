import { describe, expect, it } from "vitest";
import { looksPersisted } from "./_monkey-helpers";

describe("looksPersisted", () => {
  it("returns false for undefined / empty body", () => {
    expect(looksPersisted(undefined)).toBe(false);
    expect(looksPersisted("")).toBe(false);
  });

  it("returns false for unparseable / non-JSON body", () => {
    expect(looksPersisted("not json")).toBe(false);
    expect(looksPersisted("<!doctype html><html>")).toBe(false);
  });

  it("returns false for null / non-object JSON values", () => {
    expect(looksPersisted("null")).toBe(false);
    expect(looksPersisted('"a string"')).toBe(false);
    expect(looksPersisted("42")).toBe(false);
    expect(looksPersisted("true")).toBe(false);
  });

  it("returns false for empty objects + arrays", () => {
    expect(looksPersisted("{}")).toBe(false);
    expect(looksPersisted("[]")).toBe(false);
  });

  it("returns false for {ok:true} — the canonical bare-OK regression shape", () => {
    expect(looksPersisted('{"ok":true}')).toBe(false);
    expect(looksPersisted('{"ok":false}')).toBe(false);
  });

  it("returns false for bulk-result shapes ({updated:N}, {count:N})", () => {
    // These are legitimate bulk endpoints, but the crawl can't tell
    // them apart from a regression that stopped persisting — leave
    // them flagged so the operator triages.
    expect(looksPersisted('{"updated":5}')).toBe(false);
    expect(looksPersisted('{"count":3}')).toBe(false);
    expect(looksPersisted('{"deleted":2}')).toBe(false);
  });

  it("returns true for a top-level id (uuid-shaped or otherwise)", () => {
    expect(
      looksPersisted(
        '{"id":"550e8400-e29b-41d4-a716-446655440000","payee":"x"}',
      ),
    ).toBe(true);
    expect(looksPersisted('{"id":"any-non-empty-id"}')).toBe(true);
  });

  it("returns false when id is empty / non-string", () => {
    expect(looksPersisted('{"id":""}')).toBe(false);
    expect(looksPersisted('{"id":null}')).toBe(false);
    expect(looksPersisted('{"id":42}')).toBe(false);
  });

  it("returns true for non-empty arrays (list-of-rows shape)", () => {
    expect(looksPersisted('[{"id":"a"},{"id":"b"}]')).toBe(true);
    expect(looksPersisted("[1,2,3]")).toBe(true);
  });

  it("returns true for envelope shapes ({data:{id:...}}, {row:{id:...}}, {entry:{id:...}})", () => {
    expect(looksPersisted('{"data":{"id":"abc","name":"x"}}')).toBe(true);
    expect(looksPersisted('{"row":{"id":"abc"}}')).toBe(true);
    expect(looksPersisted('{"entry":{"id":"abc"}}')).toBe(true);
  });

  it("returns true for array envelope shapes ({data:[...]})", () => {
    expect(looksPersisted('{"data":[{"id":"a"}]}')).toBe(true);
  });

  it("returns false for envelope shapes with empty inner object / array", () => {
    expect(looksPersisted('{"data":{}}')).toBe(false);
    expect(looksPersisted('{"data":[]}')).toBe(false);
    expect(looksPersisted('{"row":{"name":"no id here"}}')).toBe(false);
  });

  it("tolerates extra fields alongside id", () => {
    expect(
      looksPersisted(
        '{"id":"abc","payee":"x","amount":"-25","accountId":"y","date":"2026-01-01"}',
      ),
    ).toBe(true);
  });
});
