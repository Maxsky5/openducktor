import { describe, expect, test } from "bun:test";
import { errorMessageFromUnknown } from "./runtime-transcript-error";

describe("errorMessageFromUnknown", () => {
  test("preserves Error and string messages", () => {
    expect(errorMessageFromUnknown(new Error("runtime unavailable"), "fallback")).toBe(
      "runtime unavailable",
    );
    expect(errorMessageFromUnknown("runtime unavailable", "fallback")).toBe("runtime unavailable");
  });

  test("uses the fallback for blank Error and string messages", () => {
    expect(errorMessageFromUnknown(new Error(""), "fallback")).toBe("fallback");
    expect(errorMessageFromUnknown("   ", "fallback")).toBe("fallback");
  });

  test("uses canonical unknown-error formatting for object payloads", () => {
    expect(errorMessageFromUnknown({ code: "runtime_unavailable" }, "fallback")).toBe(
      '{"code":"runtime_unavailable"}',
    );
  });
});
