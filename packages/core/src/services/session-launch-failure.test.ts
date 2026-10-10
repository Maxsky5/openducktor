import { expect, test } from "bun:test";
import { sessionLaunchFailureMessage } from "./session-launch-failure";

test("keeps a launch failure without cleanup errors unchanged", () => {
  expect(sessionLaunchFailureMessage({ message: "Send failed", cleanupErrors: [] })).toBe(
    "Send failed",
  );
});

test("names every failed cleanup step", () => {
  expect(
    sessionLaunchFailureMessage({
      message: "Session launch cleanup failed.",
      cleanupErrors: ["Hold release failed.", "Stop failed; stop the session."],
    }),
  ).toBe(
    "Session launch cleanup failed. Cleanup failed: Hold release failed.; Stop failed; stop the session.",
  );
});
