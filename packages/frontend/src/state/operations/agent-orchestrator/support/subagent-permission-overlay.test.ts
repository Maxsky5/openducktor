import { describe, expect, test } from "bun:test";
import {
  mergeSubagentPendingPermissionOverlay,
  mergeSubagentPendingQuestionOverlay,
} from "./subagent-permission-overlay";

describe("subagent-permission-overlay", () => {
  test("merges hydrated permissions without dropping live child entries", () => {
    const livePermission = { requestId: "perm-live", permission: "write", patterns: ["src/**"] };
    const sharedPermission = {
      requestId: "perm-shared",
      permission: "read",
      patterns: ["docs/**"],
    };
    const hydratedPermission = {
      requestId: "perm-hydrated",
      permission: "read",
      patterns: ["tests/**"],
    };

    const merged = mergeSubagentPendingPermissionOverlay({
      current: {
        "child-live": [livePermission],
        "child-merge": [sharedPermission],
      },
      scannedChildExternalSessionIds: ["child-merge"],
      pendingPermissionsByChildExternalSessionId: {
        "child-merge": [
          {
            ...sharedPermission,
            patterns: ["stale/**"],
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
