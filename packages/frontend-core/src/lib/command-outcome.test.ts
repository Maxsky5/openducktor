import { describe, expect, test } from "bun:test";
import { RemoteConnectionError, RemoteReplyTooLargeError } from "@openducktor/host-client/remote";
import { isConnectionFailure, isOutcomeUnknown } from "./command-outcome";

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

describe("isConnectionFailure", () => {
  test("is false for a reply that is too large, because the connection is sound", () => {
    const lost = new RemoteConnectionError({
      code: "transport_failure",
      message: "The socket closed.",
      nextAction: "Reconnect.",
    });
    expect(isConnectionFailure(lost)).toBe(true);
    expect(isConnectionFailure(new RemoteReplyTooLargeError(32 * 1024 * 1024))).toBe(false);
    expect(isConnectionFailure(new Error("Task not found."))).toBe(false);
  });
});
