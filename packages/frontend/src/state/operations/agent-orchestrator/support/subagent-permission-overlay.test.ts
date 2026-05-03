import { describe, expect, test } from "bun:test";
import {
  mergeSubagentPendingPermissionOverlay,
  mergeSubagentPendingQuestionOverlay,
} from "./subagent-permission-overlay";

describe("subagent-permission-overlay", () => {
  test("merges hydrated permissions without dropping live child entries", () => {
    const livePermission = {
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
    const sharedPermission = {
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
    const hydratedPermission = {
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

    const merged = mergeSubagentPendingPermissionOverlay({
      current: {
        "child-live": [livePermission],
        "child-merge": [sharedPermission],
      },
      scannedChildExternalSessionIds: ["child-merge"],
      pendingApprovalsByChildExternalSessionId: {
        "child-merge": [
          {
            ...sharedPermission,
            affectedPaths: ["stale/**"],
          },
          hydratedPermission,
        ],
      },
    });

    expect(merged).toEqual({
      "child-live": [livePermission],
      "child-merge": [sharedPermission, hydratedPermission],
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
