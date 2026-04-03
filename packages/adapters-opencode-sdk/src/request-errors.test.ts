import { describe, expect, test } from "bun:test";
import { OpenCodeRequestError, toOpenCodeRequestError } from "./request-errors";

describe("request-errors", () => {
  test("preserves structured metadata for already-prefixed errors", () => {
    const prefixedError = new Error(
      "OpenCode request failed: get mcp status (504 Gateway Timeout, code=ETIMEDOUT): socket closed",
    );
    Object.assign(prefixedError, {
      failureKind: "timeout",
      status: 504,
      statusText: "Gateway Timeout",
      code: "ETIMEDOUT",
    });

    const wrapped = toOpenCodeRequestError("get mcp status", prefixedError);

    expect(wrapped).toBeInstanceOf(OpenCodeRequestError);
    expect(wrapped.message).toBe(prefixedError.message);
    expect(wrapped.failureKind).toBe("timeout");
    expect(wrapped.status).toBe(504);
    expect(wrapped.statusText).toBe("Gateway Timeout");
    expect(wrapped.code).toBe("ETIMEDOUT");
  });

  test("classifies and preserves response metadata when wrapping plain errors", () => {
    const wrapped = toOpenCodeRequestError("get mcp status", new Error("socket closed"), {
      status: 504,
      statusText: "Gateway Timeout",
    });

    expect(wrapped).toBeInstanceOf(OpenCodeRequestError);
    expect(wrapped.message).toBe(
      "OpenCode request failed: get mcp status (504 Gateway Timeout): socket closed",
    );
    expect(wrapped.failureKind).toBe("timeout");
    expect(wrapped.status).toBe(504);
    expect(wrapped.statusText).toBe("Gateway Timeout");
  });
});
