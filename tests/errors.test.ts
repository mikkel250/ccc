import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { RateLimitError, ServiceError } from "../app/api/lib/errors";

describe("RateLimitError", () => {
  it("constructor propagates message", () => {
    const error = new RateLimitError("Too many requests. Please wait.");
    assert.equal(error.message, "Too many requests. Please wait.");
  });

  it("instanceof RateLimitError is true", () => {
    const error = new RateLimitError("burst exceeded");
    assert.equal(error instanceof RateLimitError, true);
    assert.equal(error instanceof Error, true);
  });
});

describe("ServiceError", () => {
  it("instanceof ServiceError is true", () => {
    const error = new ServiceError("Knowledge base file experience.md is missing or unreadable");
    assert.equal(error instanceof ServiceError, true);
    assert.equal(error instanceof Error, true);
  });

  it("preserves message through Error prototype chain", () => {
    const message = "Knowledge base file skills.md is missing or unreadable";
    const error = new ServiceError(message);
    assert.equal(error.message, message);
    assert.equal(Object.getPrototypeOf(error), ServiceError.prototype);
  });
});
