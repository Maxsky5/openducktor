import { describe, expect, test } from "bun:test";
import type { AgentSessionHistoryMessage } from "@openducktor/core";
import { createSessionMessagesState } from "@/state/operations/agent-orchestrator/support/messages";
import { createSubagentMessage } from "@/state/operations/agent-orchestrator/support/subagent-messages";
import {
  createEmptyReadonlyRuntimeSessionState,
  createReadonlyTranscriptSession,
  mergeReadonlyRuntimeHistory,
} from "./readonly-transcript-session";

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

  test("versions readonly transcripts when timestamp accuracy changes", () => {
    const exact = createReadonlyTranscriptSession({
      externalSessionId: "session-1",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      history: [createHistoryMessage()],
    });
    const approximate = createReadonlyTranscriptSession({
      externalSessionId: "session-1",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      history: [{ ...createHistoryMessage(), timestampIsApproximate: true }],
    });

    expect(approximate.messages.version).not.toBe(exact.messages.version);
  });

  test("versions system context messages without a notice", () => {
    expect(() =>
      createReadonlyTranscriptSession({
        externalSessionId: "session-1",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        history: [
          {
            messageId: "system-context-1",
            role: "system",
            timestamp: "2026-07-10T12:00:00.000Z",
            text: "System context",
            parts: [],
          },
        ],
      }),
    ).not.toThrow();
  });

  test("reconciles runtime and history subagent rows by child session identity", () => {
    const emptySession = createEmptyReadonlyRuntimeSessionState({
      externalSessionId: "parent-thread",
      runtimeKind: "codex",
      workingDirectory: "/repo",
    });
    const liveSubagent = createSubagentMessage({
      timestamp: "2026-07-10T12:00:01.000Z",
      meta: {
        kind: "subagent",
        partId: "session:child-thread",
        correlationKey: "session:child-thread",
        externalSessionId: "child-thread",
        prompt: "Inspect the repository",
        status: "running",
      },
    });
    const liveSession = {
      ...emptySession,
      messages: createSessionMessagesState("parent-thread", [liveSubagent], 1),
    };
    const history: AgentSessionHistoryMessage[] = [
      {
        messageId: "assistant-1",
        role: "assistant",
        timestamp: "2026-07-10T12:00:00.000Z",
        text: "",
        parts: [
          {
            kind: "subagent",
            messageId: "assistant-1",
            partId: "spawn-1",
            correlationKey: "codex-subagent:parent-thread:child-thread",
            externalSessionId: "child-thread",
            prompt: "Inspect the repository",
            status: "completed",
          },
        ],
      },
    ];

    const merged = mergeReadonlyRuntimeHistory(liveSession, history);
    const subagents = merged.messages.items.filter(
      (message) => message.role === "system" && message.meta?.kind === "subagent",
    );

    expect(subagents).toHaveLength(1);
    expect(subagents[0]?.meta).toMatchObject({
      kind: "subagent",
      externalSessionId: "child-thread",
      status: "completed",
    });
  });
});
