import { describe, expect, test } from "./bun-test";
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
});
