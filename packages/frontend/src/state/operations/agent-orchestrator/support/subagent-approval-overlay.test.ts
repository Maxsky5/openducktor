import { describe, expect, test } from "bun:test";
import {
  mergeSubagentPendingApprovalOverlay,
  mergeSubagentPendingQuestionOverlay,
} from "./subagent-approval-overlay";

describe("subagent-approval-overlay", () => {
  test("merges hydrated approvals without dropping live child entries", () => {
    const liveApproval = {
      requestId: "perm-live",
      requestType: "permission_grant" as const,
      title: `Approve permission: ${"write"}`,
      summary: `Approval request for ${"write"}.`,
      affectedPaths: ["src/**"],
      action: { name: "write" },
      mutation: "mutating" as const,
      supportedReplyOutcomes: [
        "approve_once" as const,
        "approve_session" as const,
        "reject" as const,
      ],
    };
    const sharedApproval = {
      requestId: "perm-shared",
      requestType: "permission_grant" as const,
      title: `Approve permission: ${"read"}`,
      summary: `Approval request for ${"read"}.`,
      affectedPaths: ["docs/**"],
      action: { name: "read" },
      mutation: "read_only" as const,
      supportedReplyOutcomes: [
        "approve_once" as const,
        "approve_session" as const,
        "reject" as const,
      ],
    };
    const hydratedApproval = {
      requestId: "perm-hydrated",
      requestType: "permission_grant" as const,
      title: `Approve permission: ${"read"}`,
      summary: `Approval request for ${"read"}.`,
      affectedPaths: ["tests/**"],
      action: { name: "read" },
      mutation: "read_only" as const,
      supportedReplyOutcomes: [
        "approve_once" as const,
        "approve_session" as const,
        "reject" as const,
      ],
    };

    const merged = mergeSubagentPendingApprovalOverlay({
      current: {
        "child-live": [liveApproval],
        "child-merge": [sharedApproval],
      },
      scannedChildExternalSessionIds: ["child-merge"],
      pendingApprovalsByChildExternalSessionId: {
        "child-merge": [
          {
            ...sharedApproval,
            affectedPaths: ["stale/**"],
          },
          hydratedApproval,
        ],
      },
    });

    expect(merged).toEqual({
      "child-live": [liveApproval],
      "child-merge": [sharedApproval, hydratedApproval],
    });
  });

  test("merges hydrated questions without dropping live child entries", () => {
    const liveQuestion = {
      requestId: "question-live",
      questions: [{ header: "Live", question: "Keep this", options: [] }],
    };
    const sharedQuestion = {
      requestId: "question-shared",
      questions: [{ header: "Shared", question: "Prefer live", options: [] }],
    };
    const hydratedQuestion = {
      requestId: "question-hydrated",
      questions: [{ header: "Hydrated", question: "Append this", options: [] }],
    };

    const merged = mergeSubagentPendingQuestionOverlay({
      current: {
        "child-live": [liveQuestion],
        "child-merge": [sharedQuestion],
      },
      scannedChildExternalSessionIds: ["child-merge"],
      pendingQuestionsByChildExternalSessionId: {
        "child-merge": [
          {
            ...sharedQuestion,
            questions: [{ header: "Shared", question: "Stale hydrated value", options: [] }],
          },
          hydratedQuestion,
        ],
      },
    });

    expect(merged).toEqual({
      "child-live": [liveQuestion],
      "child-merge": [sharedQuestion, hydratedQuestion],
    });
  });
});
