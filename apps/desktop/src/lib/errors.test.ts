import { describe, expect, test } from "bun:test";
import { NON_ERROR_THROWN_PREFIX } from "@/types/constants";
import { errorMessage } from "./errors";

describe("errorMessage", () => {
  test("returns a fallback string when JSON serialization yields undefined", () => {
    expect(errorMessage(undefined)).toBe(`${NON_ERROR_THROWN_PREFIX} undefined`);
    expect(errorMessage(Symbol("branch"))).toBe(`${NON_ERROR_THROWN_PREFIX} Symbol(branch)`);
    expect(errorMessage(() => {})).toBe(`${NON_ERROR_THROWN_PREFIX} () => {}`);
  });

  test("returns a fallback string when JSON serialization throws", () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;

    expect(errorMessage(circular)).toContain(NON_ERROR_THROWN_PREFIX);
  });
});
