import { describe, expect, test } from "bun:test";
import { resolveNotificationCue } from "./notification-sound";

describe("notification sound", () => {
  test("resolves inherit, none, and a specific cue", () => {
    expect(resolveNotificationCue("inherit", "chime")).toBe("chime");
    expect(resolveNotificationCue("none", "chime")).toBeNull();
    expect(resolveNotificationCue("error", "chime")).toBe("error");
  });
});
