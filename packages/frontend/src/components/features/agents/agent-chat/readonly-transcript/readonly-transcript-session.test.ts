import { describe, expect, test } from "bun:test";
import type { AgentSessionHistoryMessage } from "@openducktor/core";
import { createReadonlyTranscriptSession } from "./readonly-transcript-session";

type SystemHistoryMessage = Extract<AgentSessionHistoryMessage, { role: "system" }>;

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

  test("versions readonly transcripts when a system notice changes to a fork boundary", () => {
    const noticeBase: Omit<SystemHistoryMessage, "notice"> = {
      messageId: "boundary-1",
      role: "system" as const,
      timestamp: "2026-07-10T12:00:00.000Z",
      text: "Transcript boundary",
      parts: [],
    };
    const compacted = createReadonlyTranscriptSession({
      externalSessionId: "session-1",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      history: [
        {
          ...noticeBase,
          notice: {
            tone: "info",
            reason: "session_compacted",
            title: "Transcript boundary",
          },
        },
      ],
    });
    const forked = createReadonlyTranscriptSession({
      externalSessionId: "session-1",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      history: [
        {
          ...noticeBase,
          notice: {
            tone: "info",
            reason: "session_forked",
            title: "Transcript boundary",
            parentExternalSessionId: "parent-thread",
          },
        },
      ],
    });

    expect(forked.messages.version).not.toBe(compacted.messages.version);
  });
});
