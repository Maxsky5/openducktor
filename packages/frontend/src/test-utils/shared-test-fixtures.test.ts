import { describe, expect, test } from "bun:test";
import { getSessionMessageCount } from "@/state/operations/agent-orchestrator/support/messages";
import {
  createAgentSessionFixture,
  createChatSettingsFixture,
  createSettingsSnapshotFixture,
  createTaskCardFixture,
  TEST_EXTERNAL_SESSION_IDS,
} from "./shared-test-fixtures";

describe("shared test fixtures", () => {
  test("createTaskCardFixture returns isolated nested objects", () => {
    const first = createTaskCardFixture();
    const second = createTaskCardFixture();

    first.documentSummary.qaReport.verdict = "rejected";
    first.agentWorkflows.builder.completed = true;
    first.availableActions.push("build_start");

    expect(second.documentSummary.qaReport.verdict).toBe("not_reviewed");
    expect(second.agentWorkflows.builder.completed).toBe(false);
    expect(second.availableActions).toEqual([]);
  });

  test("createAgentSessionFixture returns isolated nested objects", () => {
    const first = createAgentSessionFixture();
    const second = createAgentSessionFixture();

    first.pendingApprovals.push({
      requestId: "permission-1",
      requestType: "permission_grant" as const,
      title: `Approve permission: ${"read"}`,
      summary: `Approval request for ${"read"}.`,
      affectedPaths: [".env"],
      action: { name: "read" },
      mutation: "read_only" as const,
      supportedReplyOutcomes: [
        "approve_once" as const,
        "approve_session" as const,
        "reject" as const,
      ],
    });
    first.messages = [
      {
        id: "message-1",
        role: "assistant",
        content: "hello",
        timestamp: "2026-03-23T10:00:00.000Z",
      },
    ];

    expect(second.pendingApprovals).toEqual([]);
    expect(getSessionMessageCount(second)).toBe(0);
  });

  test("createAgentSessionFixture keeps repo identity explicit", () => {
    const session = createAgentSessionFixture({}, { repoPath: "/repo-b" });

    expect(session.repoPath).toBe("/repo-b");
  });

  test("createAgentSessionFixture uses the canonical external id by default", () => {
    expect(createAgentSessionFixture().externalSessionId).toBe(TEST_EXTERNAL_SESSION_IDS.default);
  });

  test("createChatSettingsFixture derives from canonical defaults", () => {
    expect(createChatSettingsFixture({ expandFileDiffsByDefault: false })).toEqual({
      showThinkingMessages: false,
      expandFileDiffsByDefault: false,
    });
  });

  test("createSettingsSnapshotFixture returns isolated nested objects", () => {
    const first = createSettingsSnapshotFixture();
    const second = createSettingsSnapshotFixture();

    first.chat.showThinkingMessages = true;
    first.reusablePrompts.push({
      id: "prompt-1",
      name: "review",
      description: "Review",
      content: "Review this.",
    });

    expect(second.chat.showThinkingMessages).toBe(false);
    expect(second.reusablePrompts).toEqual([]);
  });
});
