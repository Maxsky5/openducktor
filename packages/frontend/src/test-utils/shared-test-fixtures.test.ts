import { describe, expect, test } from "bun:test";
import { getSessionMessageCount } from "@/state/operations/agent-orchestrator/support/messages";
import { createAgentSessionFixture, createTaskCardFixture } from "./shared-test-fixtures";

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

    first.pendingPermissions.push({
      requestId: "permission-1",
      permission: "read",
      patterns: [".env"],
    });
    first.messages = [
      {
        id: "message-1",
        role: "assistant",
        content: "hello",
        timestamp: "2026-03-23T10:00:00.000Z",
      },
    ];

    expect(second.pendingPermissions).toEqual([]);
    expect(getSessionMessageCount(second)).toBe(0);
  });

  test("createAgentSessionFixture keeps repo identity explicit", () => {
    const session = createAgentSessionFixture({}, { repoPath: "/repo-b" });

    expect(session.repoPath).toBe("/repo-b");
  });
});
