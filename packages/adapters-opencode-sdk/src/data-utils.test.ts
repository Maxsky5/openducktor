import { describe, expect, test } from "bun:test";
import { AgentRuntimeQueryError } from "@openducktor/core";
import { unwrapData } from "./data-utils";

describe("data-utils", () => {
  test("unwrapData returns non-null data", () => {
    const payload = { data: { id: "ok" }, error: undefined };
    const result = unwrapData(payload, "test action");
    expect(result).toEqual({ id: "ok" });
  });

  test("unwrapData throws API error message when present", () => {
    expect(() =>
      unwrapData({ data: undefined, error: { message: "Bad request" } }, "load"),
    ).toThrow("Bad request");
  });

  test("unwrapData throws fallback message when no error message provided", () => {
    expect(() => unwrapData({ data: undefined, error: {} }, "load session")).toThrow(
      "OpenCode request failed: load session",
    );
  });

  test("unwrapData reports a transport loss as an unreachable runtime", () => {
    let thrown: unknown;
    try {
      unwrapData(
        { data: undefined, error: new TypeError("fetch failed"), response: undefined },
        "list configured providers",
      );
    } catch (cause) {
      thrown = cause;
    }

    expect(thrown).toBeInstanceOf(AgentRuntimeQueryError);
    expect(thrown).toMatchObject({
      code: "runtime_unavailable",
      message:
        "The OpenCode runtime did not answer the list configured providers request. Start the runtime and retry.",
    });
  });

  test("unwrapData keeps an API error with no response metadata as a surface failure", () => {
    expect(() =>
      unwrapData({ data: undefined, error: { message: "Bad request" } }, "load"),
    ).toThrow("Bad request");
  });
});
