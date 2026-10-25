import { describe, expect, test } from "bun:test";
import { RemoteConnectionError } from "@openducktor/host-client/remote";
import { isOutcomeUnknown } from "./command-outcome";

describe("isOutcomeUnknown", () => {
  test("is true only for a lost command result", () => {
    const lost = new RemoteConnectionError({
      code: "outcome_unknown",
      message: "The result of task_close was lost.",
      nextAction: "Read current host state to check the outcome.",
    });
    const refused = new RemoteConnectionError({
      code: "unavailable",
      message: "The host is not reachable.",
      nextAction: "Check the network.",
    });
    expect(isOutcomeUnknown(lost)).toBe(true);
    expect(isOutcomeUnknown(refused)).toBe(false);
    expect(isOutcomeUnknown(new Error("Task not found."))).toBe(false);
  });
});
