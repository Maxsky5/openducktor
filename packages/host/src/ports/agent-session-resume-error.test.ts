import { describe, expect, test } from "bun:test";
import type { AgentSessionLiveRef } from "@openducktor/contracts";
import { interruptedTurnResumeError } from "@openducktor/core";
import { HostOperationError } from "../effect/host-errors";
import { AgentSessionResumeError, toAgentSessionResumeError } from "./agent-session-resume-error";

const sessionRef: AgentSessionLiveRef = {
  runtimeKind: "claude",
  repoPath: "/repo",
  workingDirectory: "/repo/worktree",
  externalSessionId: "session-1",
};

const operation = "claude-live-session.continue-interrupted-turn";

describe("toAgentSessionResumeError", () => {
  test("keeps a typed resume failure unchanged", () => {
    const failure = interruptedTurnResumeError({
      reason: "live_turn",
      message: "A turn is running.",
    });

    const mapped = toAgentSessionResumeError(failure, sessionRef, operation);

    expect(mapped).toBeInstanceOf(AgentSessionResumeError);
    expect(mapped.reason).toBe("live_turn");
    expect(mapped.message).toBe("A turn is running.");
  });

  test("unwraps the typed failure from a host operation wrapper", () => {
    const typed = interruptedTurnResumeError({
      reason: "waiting_input",
      message: "The session waits for an approval.",
    });
    const wrapped = new HostOperationError({
      operation: "claudeRuntime.continueInterruptedTurn",
      message: typed.message,
      cause: typed,
    });

    const mapped = toAgentSessionResumeError(wrapped, sessionRef, operation);

    expect(mapped.reason).toBe("waiting_input");
    expect(mapped.message).toBe("The session waits for an approval.");
    expect(mapped.nextAction).toBe("Answer the pending approval or question, then retry Resume.");
  });

  test("falls back to a continuation failure for an unknown cause", () => {
    const mapped = toAgentSessionResumeError(new Error("socket closed"), sessionRef, operation);

    expect(mapped.reason).toBe("continuation_failed");
    expect(mapped.message).toBe("socket closed");
    expect(mapped.sessionRef).toEqual(sessionRef);
  });
});
