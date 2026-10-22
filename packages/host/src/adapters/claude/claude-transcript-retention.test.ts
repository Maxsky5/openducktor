import { describe, expect, test } from "bun:test";
import { retainClaudeTranscriptRecord } from "./claude-transcript-retention";

describe("Claude transcript record retention", () => {
  test.each([
    "task_started",
    "task_progress",
    "task_updated",
    "task_notification",
    "background_tasks_changed",
    "compact_boundary",
    "local_command",
    "local_command_output",
    "model_refusal_fallback",
  ])("retains consumed system records: %s", (subtype) => {
    const record = { type: "system", subtype, uuid: "system-1", content: "Runtime event" };
    expect(retainClaudeTranscriptRecord(record)).toEqual(record);
  });

  test("keeps unconsumed branch nodes and retractions with only their graph fields", () => {
    expect(
      retainClaudeTranscriptRecord({
        type: "progress",
        uuid: "progress-1",
        parentUuid: "assistant-1",
        sessionId: "session-1",
        data: { agentId: "child-1", type: "agent_progress" },
        snapshots: { unused: true },
      }),
    ).toEqual({
      type: "progress",
      uuid: "progress-1",
      parentUuid: "assistant-1",
      sessionId: "session-1",
    });
    expect(
      retainClaudeTranscriptRecord({
        type: "unused",
        supersedes: ["retracted-1"],
        payload: "unused",
      }),
    ).toEqual({ type: "unused", supersedes: ["retracted-1"] });
    expect(
      retainClaudeTranscriptRecord({ type: "file-history-snapshot", snapshot: "unused" }),
    ).toBeNull();
  });

  test("retains queue admission and result records", () => {
    expect(
      retainClaudeTranscriptRecord({
        type: "queue-operation",
        operation: "enqueue",
        content: "/compact",
      }),
    ).toEqual({ type: "queue-operation", operation: "enqueue", content: "/compact" });
    expect(
      retainClaudeTranscriptRecord({
        type: "result",
        subtype: "error_during_execution",
        is_error: true,
        errors: ["Tool failed"],
      }),
    ).toEqual({
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      errors: ["Tool failed"],
    });
    expect(
      retainClaudeTranscriptRecord({
        type: "queue-operation",
        operation: "remove",
        content: "unused",
      }),
    ).toEqual({ type: "queue-operation", operation: "remove" });
  });
});
