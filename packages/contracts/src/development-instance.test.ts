import { describe, expect, test } from "bun:test";
import { isDevelopmentInstanceId } from "./development-instance";

describe("development instance contract", () => {
  test.each(["browser-0123456789ab", "electron-abcdef012345"])(
    "accepts development instance %s",
    (developmentInstanceId) => {
      expect(isDevelopmentInstanceId(developmentInstanceId)).toBe(true);
    },
  );

  test.each([
    "browser-0123456789a",
    "browser-0123456789abc",
    "browser-0123456789ag",
    "desktop-0123456789ab",
    "../browser-0123456789ab",
  ])("rejects development instance %s", (developmentInstanceId) => {
    expect(isDevelopmentInstanceId(developmentInstanceId)).toBe(false);
  });
});
