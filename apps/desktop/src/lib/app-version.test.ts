import { describe, expect, test } from "bun:test";
import { getAppVersion } from "./app-version";

describe("getAppVersion", () => {
  test("returns a string or null", () => {
    const version = getAppVersion();
    expect(version === null || typeof version === "string").toBe(true);
  });

  test("returns null when Vite define is absent", () => {
    expect(getAppVersion()).toBeNull();
  });
});
