import { describe, expect, test } from "bun:test";
import { NON_ERROR_THROWN_PREFIX } from "@/types/constants";
import { errorMessage, hasErrorToastShown, markErrorToastShown } from "./errors";

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

  test("tracks when an error toast was already shown", () => {
    const error = new Error("already shown");

    expect(hasErrorToastShown(error)).toBe(false);
    expect(markErrorToastShown(error)).toBe(error);
    expect(hasErrorToastShown(error)).toBe(true);
    expect(hasErrorToastShown("plain string")).toBe(false);
  });
});
