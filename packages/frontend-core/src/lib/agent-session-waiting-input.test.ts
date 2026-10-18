import { describe, expect, test } from "bun:test";
import {
  getAgentSessionWaitingInputPlaceholder,
  hasAgentSessionPendingApprovals,
  hasAgentSessionPendingQuestions,
  isAgentSessionWaitingInput,
} from "./agent-session-waiting-input";

describe("agent-session-waiting-input", () => {
  test("returns false and no placeholder when nothing is pending", () => {
    const session = {
      pendingApprovals: [],
      pendingQuestions: [],
    };

    expect(isAgentSessionWaitingInput(session)).toBe(false);
    expect(hasAgentSessionPendingApprovals(session)).toBe(false);
    expect(hasAgentSessionPendingQuestions(session)).toBe(false);
    expect(getAgentSessionWaitingInputPlaceholder(session)).toBeNull();
  });

  test("returns a question-specific placeholder when questions are pending", () => {
    const session = {
      pendingApprovals: [],
      pendingQuestions: [{ requestId: "question-1", questions: [] }],
    };

    expect(isAgentSessionWaitingInput(session)).toBe(true);
    expect(hasAgentSessionPendingApprovals(session)).toBe(false);
    expect(hasAgentSessionPendingQuestions(session)).toBe(true);
    expect(getAgentSessionWaitingInputPlaceholder(session)).toBe(
      "Answer the pending question above to continue",
    );
  });

  test("returns a permission-specific placeholder when permissions are pending", () => {
    const session = {
      pendingApprovals: [
        {
          requestId: "permission-1",
          requestType: "permission_grant" as const,
          title: `Approve permission: ${"read"}`,
          summary: `Approval request for ${"read"}.`,
          affectedPaths: ["**/*"],
          action: { name: "read" },
          mutation: "read_only" as const,
          supportedReplyOutcomes: [
            "approve_once" as const,
            "approve_session" as const,
            "reject" as const,
          ],
        },
      ],
      pendingQuestions: [],
    };

    expect(isAgentSessionWaitingInput(session)).toBe(true);
    expect(hasAgentSessionPendingApprovals(session)).toBe(true);
    expect(hasAgentSessionPendingQuestions(session)).toBe(false);
    expect(getAgentSessionWaitingInputPlaceholder(session)).toBe(
      "Respond to the pending approval request above to continue",
    );
  });

  test("returns a combined placeholder when questions and permissions are pending", () => {
    const session = {
      pendingApprovals: [
        {
          requestId: "permission-1",
          requestType: "permission_grant" as const,
          title: `Approve permission: ${"read"}`,
          summary: `Approval request for ${"read"}.`,
          affectedPaths: ["**/*"],
          action: { name: "read" },
          mutation: "read_only" as const,
          supportedReplyOutcomes: [
            "approve_once" as const,
            "approve_session" as const,
            "reject" as const,
          ],
        },
      ],
      pendingQuestions: [{ requestId: "question-1", questions: [] }],
    };

    expect(isAgentSessionWaitingInput(session)).toBe(true);
    expect(hasAgentSessionPendingApprovals(session)).toBe(true);
    expect(hasAgentSessionPendingQuestions(session)).toBe(true);
    expect(getAgentSessionWaitingInputPlaceholder(session)).toBe(
      "Resolve the pending questions and approval requests above to continue",
    );
  });
});
