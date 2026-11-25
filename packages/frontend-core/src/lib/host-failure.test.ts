import { describe, expect, test } from "bun:test";
import { HostUnreachableError } from "@openducktor/host-client";
import { remoteError } from "@openducktor/host-client/remote";
import {
  failureText,
  HOST_CONNECTION_WAITING_MESSAGE,
  HOST_UNREACHABLE_FAILURE,
  toHostFeedbackFailure,
} from "./host-failure";

const lostResult = remoteError(
  "outcome_unknown",
  "The result of git_commit was lost.",
  "Read current host state to check the outcome.",
);

describe("toHostFeedbackFailure", () => {
  test("classifies a lost local or remote connection as a quiet wait for the host", () => {
    for (const cause of [new HostUnreachableError(new TypeError("x")), lostResult]) {
      const failure = toHostFeedbackFailure(cause, (message) => `Read failed: ${message}`);
      expect(failure).toBe(HOST_UNREACHABLE_FAILURE);
      expect(failureText(failure)).toBe(HOST_CONNECTION_WAITING_MESSAGE);
    }
  });

  test("keeps the described message of a failure with another cause", () => {
    const failure = toHostFeedbackFailure(new Error("Locked."), (message) => `Read: ${message}`);
    expect(failure).toEqual({ kind: "other", message: "Read: Locked." });
    expect(failureText(failure)).toBe("Read: Locked.");
  });
});
