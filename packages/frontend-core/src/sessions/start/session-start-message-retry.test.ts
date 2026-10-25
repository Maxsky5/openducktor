import { describe, expect, mock, test } from "bun:test";
import {
  SESSION_START_MESSAGE_FAILED_TITLE,
  SESSION_START_MESSAGE_RETRY_LABEL,
  SESSION_START_MESSAGE_UNKNOWN_DESCRIPTION,
  type SessionStartMessageRetry,
  sessionStartMessageRetry,
} from "./session-start-message-retry";
import type { SessionStartWorkflowResult } from "./session-start-workflow";

const sendAgain = (retry: SessionStartMessageRetry | null) => {
  if (retry?.kind !== "failed") throw new Error("Expected a retry of a failed message.");
  return retry.retry();
};

const startedSession = (
  overrides: Partial<SessionStartWorkflowResult> = {},
): SessionStartWorkflowResult => ({
  externalSessionId: "session-1",
  runtimeKind: "opencode",
  workingDirectory: "/repo/worktree",
  postStartActionError: new Error("The runtime rejected the message."),
  ...overrides,
});

describe("sessionStartMessageRetry", () => {
  test("has no retry when the first message reached the session", () => {
    expect(sessionStartMessageRetry(startedSession({ postStartActionError: null }))).toBeNull();
    expect(sessionStartMessageRetry(startedSession())).toBeNull();
  });

  test("names the failure and sends the first message again", async () => {
    const retryPostStartMessage = mock(async () => null);
    const retry = sessionStartMessageRetry(startedSession({ retryPostStartMessage }));

    expect(retry).toMatchObject({
      kind: "failed",
      title: SESSION_START_MESSAGE_FAILED_TITLE,
      description: "The runtime rejected the message.",
      actionLabel: SESSION_START_MESSAGE_RETRY_LABEL,
    });
    const next = await sendAgain(retry);

    expect(retryPostStartMessage).toHaveBeenCalledTimes(1);
    expect(next).toBeNull();
  });

  test("returns the next retry with the new cause when the send fails again", async () => {
    const retryPostStartMessage = mock(async () => {
      throw new Error("The session is not ready.");
    });
    const retry = sessionStartMessageRetry(startedSession({ retryPostStartMessage }));

    const next = await sendAgain(retry);

    expect(next?.description).toBe("The session is not ready.");
    expect(next?.title).toBe(SESSION_START_MESSAGE_FAILED_TITLE);
  });

  test("reports a lost send result as unknown and offers no retry", async () => {
    const retryPostStartMessage = mock(async () => ({
      outcome: "uncertain" as const,
      recipient: {
        externalSessionId: "session-1",
        runtimeKind: "opencode" as const,
        workingDirectory: "/repo/worktree",
      },
      submissionId: "submission-1",
    }));
    const retry = sessionStartMessageRetry(startedSession({ retryPostStartMessage }));

    expect(await sendAgain(retry)).toEqual({
      kind: "unknown",
      title: "Result unknown",
      description: SESSION_START_MESSAGE_UNKNOWN_DESCRIPTION,
    });
  });
});
