import { describe, expect, test } from "bun:test";
import { createAgentSessionFixture } from "@/pages/agents/agent-studio-test-utils";
import { createAgentSessionCollection } from "./agent-session-collection";
import { getAgentSessionVisiblePendingInput } from "./agent-session-visible-pending-input";

const createSubagentApprovalFixture = ({
  childExternalSessionId,
  parentExternalSessionId,
}: {
  childExternalSessionId: string;
  parentExternalSessionId: string;
}) => ({
  requestId: "approval-1",
  requestType: "permission_grant" as const,
  title: "Approve permission: read",
  summary: "Approval request for read.",
  action: { name: "read" },
  mutation: "read_only" as const,
  supportedReplyOutcomes: ["approve_once" as const, "reject" as const],
  source: {
    kind: "subagent" as const,
    parentExternalSessionId,
    childExternalSessionId,
  },
});

describe("agent-session-visible-pending-input", () => {
  test("returns parent-mirrored subagent pending input for the child session identity", () => {
    const childSession = createAgentSessionFixture({
      externalSessionId: "child-session",
      runtimeKind: "opencode",
      workingDirectory: "/repo-a",
      pendingApprovals: [],
      pendingQuestions: [],
    });
    const mirroredApproval = {
      ...createSubagentApprovalFixture({
        childExternalSessionId: "child-session",
        parentExternalSessionId: "parent-session",
      }),
      responseSession: childSession,
    };
    const parentSession = createAgentSessionFixture({
      externalSessionId: "parent-session",
      runtimeKind: "opencode",
      workingDirectory: "/repo-a",
      pendingApprovals: [mirroredApproval],
      pendingQuestions: [],
    });
    const collection = createAgentSessionCollection([parentSession]);

    expect(getAgentSessionVisiblePendingInput(collection, childSession)).toEqual({
      pendingApprovals: [mirroredApproval],
      pendingQuestions: [],
    });
  });

  test("keeps child-owned pending input authoritative when the parent also mirrors it", () => {
    const childApproval = createSubagentApprovalFixture({
      childExternalSessionId: "child-session",
      parentExternalSessionId: "parent-session",
    });
    const childSession = createAgentSessionFixture({
      externalSessionId: "child-session",
      runtimeKind: "opencode",
      workingDirectory: "/repo-a",
      pendingApprovals: [childApproval],
      pendingQuestions: [],
    });
    const parentSession = createAgentSessionFixture({
      externalSessionId: "parent-session",
      runtimeKind: "opencode",
      workingDirectory: "/repo-a",
      pendingApprovals: [
        {
          ...childApproval,
          responseSession: childSession,
        },
      ],
      pendingQuestions: [],
    });
    const collection = createAgentSessionCollection([parentSession, childSession]);

    expect(getAgentSessionVisiblePendingInput(collection, childSession).pendingApprovals).toEqual([
      childApproval,
    ]);
  });
});
