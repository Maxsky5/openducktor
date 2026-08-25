import { describe, expect, test } from "bun:test";
import { runtimeTypeName } from "./runtime-type";

describe("runtime type guards", () => {
  test("narrows primitive unions without losing the selected member", () => {
    const value: number | string = "ready";

    if (typeof value !== "string") {
      throw new Error("Expected a string value.");
    }

    const narrowed: string = value;
    expect(narrowed.toUpperCase()).toBe("READY");
  });

  test("preserves an existing function signature", () => {
    const invokeIfFunction = (value: string | ((input: string) => number)): number => {
      if (typeof value !== "function") {
        throw new Error("Expected a function value.");
      }

      return value("duck");
    };

    expect(invokeIfFunction((input) => input.length)).toBe(4);
  });

  test("reports every JavaScript runtime type, including null as object", () => {
    expect([
      runtimeTypeName(1n),
      runtimeTypeName(true),
      runtimeTypeName(() => {}),
      runtimeTypeName(1),
      runtimeTypeName(null),
      runtimeTypeName("value"),
      runtimeTypeName(Symbol("value")),
      runtimeTypeName(undefined),
    ]).toEqual([
      "bigint",
      "boolean",
      "function",
      "number",
      "object",
      "string",
      "symbol",
      "undefined",
    ]);
  });
});
