import { describe, expect, test } from "bun:test";
import type { AgentSessionHistoryMessage } from "@openducktor/core";
import { createReadonlyTranscriptSession } from "./readonly-transcript-session";

const createHistoryMessage = (): AgentSessionHistoryMessage => ({
  messageId: "message-1",
  role: "user",
  timestamp: "2026-02-22T12:00:00.000Z",
  text: "Inspect this",
  displayParts: [],
  state: "read",
  parts: [],
});

describe("createReadonlyTranscriptSession", () => {
  test("preserves transcript target session scope", () => {
    const sessionScope = { kind: "workflow" as const, taskId: "task-1", role: "spec" as const };

    expect(
      createReadonlyTranscriptSession({
        externalSessionId: "session-1",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        sessionScope,
        history: [createHistoryMessage()],
      }).sessionScope,
    ).toEqual(sessionScope);
  });
});
