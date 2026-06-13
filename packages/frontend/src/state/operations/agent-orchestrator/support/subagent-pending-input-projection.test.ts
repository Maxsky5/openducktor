import { describe, expect, test } from "bun:test";
import { createAgentSessionFixture } from "@/test-utils/shared-test-fixtures";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import {
  addSubagentPendingApprovalRequestId,
  addSubagentPendingQuestionRequestId,
  clearSubagentPendingApprovalFromSessions,
  clearSubagentPendingQuestionFromSessions,
} from "./subagent-pending-input-projection";

const createSession = (externalSessionId: string, overrides: Partial<AgentSessionState> = {}) =>
  createAgentSessionFixture({
    externalSessionId,
    ...overrides,
  });

describe("subagent pending input projection", () => {
  test("adds approval and question request ids without duplicating repeated runtime events", () => {
    const approvalIds = addSubagentPendingApprovalRequestId(
      addSubagentPendingApprovalRequestId(undefined, "child-1", "approval-1"),
      "child-1",
      "approval-1",
    );
    const questionIds = addSubagentPendingQuestionRequestId(
      addSubagentPendingQuestionRequestId(undefined, "child-1", "question-1"),
      "child-1",
      "question-2",
    );

    expect(approvalIds).toEqual({ "child-1": ["approval-1"] });
    expect(questionIds).toEqual({ "child-1": ["question-1", "question-2"] });
  });

  test("clears approval request ids from every parent projection for the target child", () => {
    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        parent: createSession("parent", {
          subagentPendingApprovalRequestIdsByExternalSessionId: {
            child: ["approval-1", "approval-2"],
            other: ["approval-1"],
          },
        }),
        child: createSession("child"),
      },
    };
    const updateSession = (
      externalSessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
    ): void => {
      const current = sessionsRef.current[externalSessionId];
      if (!current) {
        return;
      }
      sessionsRef.current = {
        ...sessionsRef.current,
        [externalSessionId]: updater(current),
      };
    };

    clearSubagentPendingApprovalFromSessions({
      sessionsRef,
      updateSession,
      targetExternalSessionId: "child",
      requestId: "approval-1",
    });

    const parent = sessionsRef.current.parent;
    if (!parent) {
      throw new Error("Expected parent session to exist after clearing approval projection");
    }
    expect(parent.subagentPendingApprovalRequestIdsByExternalSessionId).toEqual({
      child: ["approval-2"],
      other: ["approval-1"],
    });
  });

  test("clears question request ids and removes empty child entries", () => {
    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        parent: createSession("parent", {
          subagentPendingQuestionRequestIdsByExternalSessionId: {
            child: ["question-1"],
          },
        }),
        child: createSession("child"),
      },
    };
    const updateSession = (
      externalSessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
    ): void => {
      const current = sessionsRef.current[externalSessionId];
      if (!current) {
        return;
      }
      sessionsRef.current = {
        ...sessionsRef.current,
        [externalSessionId]: updater(current),
      };
    };

    clearSubagentPendingQuestionFromSessions({
      sessionsRef,
      updateSession,
      targetExternalSessionId: "child",
      requestId: "question-1",
    });

    const parent = sessionsRef.current.parent;
    if (!parent) {
      throw new Error("Expected parent session to exist after clearing question projection");
    }
    expect(parent.subagentPendingQuestionRequestIdsByExternalSessionId).toBe(undefined);
  });
});
