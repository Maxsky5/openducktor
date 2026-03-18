import { describe, expect, test } from "bun:test";
import { errorMessage } from "./errors";

describe("errorMessage", () => {
  test("returns a fallback string when JSON serialization yields undefined", () => {
    expect(errorMessage(undefined)).toBe("Non-Error thrown: undefined");
    expect(errorMessage(Symbol("branch"))).toBe("Non-Error thrown: Symbol(branch)");
    expect(errorMessage(() => {})).toBe("Non-Error thrown: () => {}");
  });

  test("returns a fallback string when JSON serialization throws", () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;

    expect(errorMessage(circular)).toContain("Non-Error thrown:");
  });
});
