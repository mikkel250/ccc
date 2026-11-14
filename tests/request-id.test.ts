import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  REQUEST_ID_HEADER,
  REQUEST_ID_MAX_CHARS,
  generateRequestId,
  resolveRequestId,
} from "../app/api/lib/request-id";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8]{1}[0-9a-f]{3}-[89ab]{1}[0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("generateRequestId", () => {
  it("returns a UUID v4-shaped id", () => {
    assert.match(generateRequestId(), UUID_RE);
  });

  it("returns a distinct id on each call", () => {
    assert.notEqual(generateRequestId(), generateRequestId());
  });
});

describe("resolveRequestId", () => {
  it("honors a safe inbound X-Request-Id", () => {
    assert.equal(resolveRequestId("bff-session-abc_123"), "bff-session-abc_123");
  });

  it("honors a UUID inbound id", () => {
    const id = "550e8400-e29b-41d4-a716-446655440000";
    assert.equal(resolveRequestId(id), id);
  });

  it("generates when inbound is missing", () => {
    assert.match(resolveRequestId(null), UUID_RE);
    assert.match(resolveRequestId(undefined), UUID_RE);
    assert.match(resolveRequestId(""), UUID_RE);
  });

  it("rejects log-injection and oversize inbound values", () => {
    assert.match(resolveRequestId("ok\ninjected"), UUID_RE);
    assert.match(resolveRequestId("has space"), UUID_RE);
    assert.match(resolveRequestId("bad/slash"), UUID_RE);
    assert.match(resolveRequestId("a".repeat(REQUEST_ID_MAX_CHARS + 1)), UUID_RE);
  });

  it("trims surrounding whitespace before accepting", () => {
    assert.equal(resolveRequestId("  inbound-id  "), "inbound-id");
  });
});

describe("REQUEST_ID_HEADER", () => {
  it("is the lowercase HTTP header name", () => {
    assert.equal(REQUEST_ID_HEADER, "x-request-id");
  });
});
