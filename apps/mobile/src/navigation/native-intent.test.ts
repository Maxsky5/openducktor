import { describe, expect, test } from "bun:test";
import { redirectSystemPath } from "@/app/+native-intent";

describe("redirectSystemPath", () => {
  test("opens the start screen for every launch URL", () => {
    expect(redirectSystemPath({ path: "openducktor://scan-host", initial: true })).toBe("/");
    expect(
      redirectSystemPath({ path: "openducktor://session?workspaceId=other", initial: true }),
    ).toBe("/");
  });

  test("ignores a URL that arrives while the app runs", () => {
    expect(redirectSystemPath({ path: "openducktor://work/terminals", initial: false })).toBeNull();
  });
});
