import { describe, expect, test } from "bun:test";
import { sessionMessagesToArray } from "@/test-utils/session-message-test-helpers";
import type { AgentChatMessage, SessionMessagesState } from "@/types/agent-orchestrator";
import { mergeHistoryMessages } from "./history-message-merge";
import { createSessionMessagesState } from "./messages";

const EXTERNAL_SESSION_ID = "session-1";

const createSession = (messages: SessionMessagesState) => ({
  externalSessionId: EXTERNAL_SESSION_ID,
  messages,
});

const mergedMessages = (
  historyMessages: AgentChatMessage[],
  currentMessages: AgentChatMessage[],
): AgentChatMessage[] => {
  return sessionMessagesToArray(
    createSession(mergedMessageState(historyMessages, currentMessages)),
  );
};

const mergedMessageState = (
  historyMessages: AgentChatMessage[],
  currentMessages: AgentChatMessage[],
  currentVersion = 0,
): SessionMessagesState => {
  return mergeHistoryMessages(
    EXTERNAL_SESSION_ID,
    createSessionMessagesState(EXTERNAL_SESSION_ID, historyMessages),
    createSessionMessagesState(EXTERNAL_SESSION_ID, currentMessages, currentVersion),
  );
};

describe("agent-orchestrator/support/history-message-merge", () => {
  test("commits loaded history as one transcript revision", () => {
    const merged = mergedMessageState(
      [
        {
          id: "history-user",
          role: "user",
          content: "History user message",
          timestamp: "2026-03-01T09:00:00.000Z",
        },
        {
          id: "history-assistant",
          role: "assistant",
          content: "History assistant message",
          timestamp: "2026-03-01T09:00:01.000Z",
        },
      ],
      [
        {
          id: "live-user",
          role: "user",
          content: "Live message still pending",
          timestamp: "2026-03-01T09:00:02.000Z",
        },
      ],
      41,
    );

    expect(merged.version).toBe(42);
    expect(sessionMessagesToArray(createSession(merged)).map((message) => message.id)).toEqual([
      "history-user",
      "history-assistant",
      "live-user",
    ]);
  });

  test("inserts unmatched current subagent messages by timestamp during hydration", () => {
    const merged = mergedMessages(
      [
        {
          id: "history-user",
          role: "user",
          content: "Start",
          timestamp: "2026-03-01T09:00:00.000Z",
        },
        {
          id: "history-assistant",
          role: "assistant",
          content: "Done",
          timestamp: "2026-03-01T09:00:10.000Z",
          meta: {
            kind: "assistant",
            agentRole: "build",
            isFinal: true,
          },
        },
      ],
      [
        {
          id: "subagent:task-1",
          role: "system",
          content: "Subagent (general-purpose): Run affected web tests",
          timestamp: "2026-03-01T09:00:04.000Z",
          meta: {
            kind: "subagent",
            partId: "claude-subagent:task-1",
            correlationKey: "task-1",
            status: "completed",
            agent: "general-purpose",
            description: "Run affected web tests",
          },
        },
      ],
    );

    expect(merged.map((message) => message.id)).toEqual([
      "history-user",
      "subagent:task-1",
      "history-assistant",
    ]);
  });

  test("prefers history final assistant messages while preserving current metadata", () => {
    const merged = mergedMessages(
      [
        {
          id: "assistant-1",
          role: "assistant",
          content: "Final answer",
          timestamp: "2026-03-01T09:00:02.000Z",
          meta: {
            kind: "assistant",
            agentRole: "build",
            isFinal: true,
            modelId: "gpt-5",
            totalTokens: 120,
          },
        },
      ],
      [
        {
          id: "assistant-1",
          role: "assistant",
          content: "Still streaming",
          timestamp: "2026-03-01T09:00:01.000Z",
          meta: {
            kind: "assistant",
            agentRole: "build",
            isFinal: false,
            providerId: "anthropic",
            variant: "sonnet-stream",
            durationMs: 44,
          },
        },
      ],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      id: "assistant-1",
      role: "assistant",
      content: "Final answer",
      meta: {
        kind: "assistant",
        agentRole: "build",
        isFinal: true,
        providerId: "anthropic",
        modelId: "gpt-5",
        variant: "sonnet-stream",
        durationMs: 44,
        totalTokens: 120,
      },
    });
  });

  test("updates current final assistant metadata from history duration", () => {
    const merged = mergedMessages(
      [
        {
          id: "assistant-1",
          role: "assistant",
          content: "Final answer",
          timestamp: "2026-03-01T09:00:02.000Z",
          meta: {
            kind: "assistant",
            agentRole: "build",
            isFinal: true,
            durationMs: 12_000,
          },
        },
      ],
      [
        {
          id: "assistant-1",
          role: "assistant",
          content: "Final answer",
          timestamp: "2026-03-01T09:00:02.000Z",
          meta: {
            kind: "assistant",
            agentRole: "build",
            isFinal: true,
          },
        },
      ],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      id: "assistant-1",
      role: "assistant",
      content: "Final answer",
      meta: {
        kind: "assistant",
        agentRole: "build",
        isFinal: true,
        durationMs: 12_000,
      },
    });
  });

  test("keeps completed current reasoning when history reasoning is still incomplete", () => {
    const merged = mergedMessages(
      [
        {
          id: "thinking:assistant-1:reasoning-1",
          role: "thinking",
          content: "History reasoning",
          timestamp: "2026-03-01T09:00:02.000Z",
          meta: {
            kind: "reasoning",
            partId: "reasoning-1",
            completed: false,
          },
        },
      ],
      [
        {
          id: "thinking:assistant-1:reasoning-1",
          role: "thinking",
          content: "Current completed reasoning",
          timestamp: "2026-03-01T09:00:03.000Z",
          meta: {
            kind: "reasoning",
            partId: "reasoning-1",
            completed: true,
          },
        },
      ],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      id: "thinking:assistant-1:reasoning-1",
      role: "thinking",
      content: "Current completed reasoning",
      meta: {
        kind: "reasoning",
        partId: "reasoning-1",
        completed: true,
      },
    });
  });

  test("keeps an exact current reasoning timestamp when completed history uses an approximate timestamp", () => {
    const merged = mergedMessages(
      [
        {
          id: "thinking:assistant-1:reasoning-1",
          role: "thinking",
          content: "Completed reasoning",
          timestamp: "2026-03-01T09:00:00.000Z",
          timestampIsApproximate: true,
          meta: {
            kind: "reasoning",
            partId: "reasoning-1",
            completed: true,
          },
        },
      ],
      [
        {
          id: "thinking:assistant-1:reasoning-1",
          role: "thinking",
          content: "Completed reasoning",
          timestamp: "2026-03-01T09:00:03.000Z",
          meta: {
            kind: "reasoning",
            partId: "reasoning-1",
            completed: true,
          },
        },
      ],
    );

    expect(merged[0]?.timestamp).toBe("2026-03-01T09:00:03.000Z");
    expect(merged[0]?.timestampIsApproximate).toBeUndefined();
  });

  test("preserves a current terminal tool row and loads identity from the history row", () => {
    const merged = mergedMessages(
      [
        {
          id: "tool:assistant-1:history-tool",
          role: "tool",
          content: "History running output",
          timestamp: "2026-03-01T09:00:02.000Z",
          meta: {
            kind: "tool",
            partId: "tool-part-1",
            callId: "call-123",
            tool: "bash",
            toolType: "generic" as const,
            status: "running",
            observedStartedAtMs: 100,
          },
        },
      ],
      [
        {
          id: "tool:assistant-1:current-tool",
          role: "tool",
          content: "Current completed output",
          timestamp: "2026-03-01T09:00:03.000Z",
          meta: {
            kind: "tool",
            partId: "tool-part-1",
            callId: "",
            tool: "bash",
            toolType: "generic" as const,
            status: "completed",
            output: "done",
          },
        },
      ],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      id: "tool:assistant-1:call-123",
      role: "tool",
      content: "Current completed output",
      meta: {
        kind: "tool",
        partId: "tool-part-1",
        callId: "call-123",
        tool: "bash",
        toolType: "generic" as const,
        status: "completed",
        output: "done",
      },
    });
  });

  test("canonicalizes a preserved terminal tool row that already learned its call id", () => {
    const merged = mergedMessages(
      [
        {
          id: "tool:assistant-1:call-123",
          role: "tool",
          content: "History running output",
          timestamp: "2026-03-01T09:00:02.000Z",
          meta: {
            kind: "tool",
            partId: "tool-part-1",
            callId: "call-123",
            tool: "bash",
            toolType: "generic" as const,
            status: "running",
          },
        },
      ],
      [
        {
          id: "tool:assistant-1:tool-part-1",
          role: "tool",
          content: "Current completed output",
          timestamp: "2026-03-01T09:00:03.000Z",
          meta: {
            kind: "tool",
            partId: "tool-part-1",
            callId: "call-123",
            tool: "bash",
            toolType: "generic" as const,
            status: "completed",
            output: "done",
          },
        },
      ],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      id: "tool:assistant-1:call-123",
      content: "Current completed output",
      meta: {
        kind: "tool",
        partId: "tool-part-1",
        callId: "call-123",
        status: "completed",
        output: "done",
      },
    });
  });

  test("matches tool rows without call ids by scoped part and avoids duplicate current rows", () => {
    const merged = mergedMessages(
      [
        {
          id: "tool:assistant-1:history-part",
          role: "tool",
          content: "History completed output",
          timestamp: "2026-03-01T09:00:02.000Z",
          meta: {
            kind: "tool",
            partId: "tool-part-1",
            callId: "",
            tool: "bash",
            toolType: "generic" as const,
            status: "completed",
            output: "done",
          },
        },
      ],
      [
        {
          id: "tool:assistant-1:current-part",
          role: "tool",
          content: "Current running output",
          timestamp: "2026-03-01T09:00:03.000Z",
          meta: {
            kind: "tool",
            partId: "tool-part-1",
            callId: " ",
            tool: "bash",
            toolType: "generic" as const,
            status: "running",
            observedStartedAtMs: 101,
          },
        },
      ],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      id: "tool:assistant-1:history-part",
      role: "tool",
      content: "History completed output",
      meta: {
        kind: "tool",
        partId: "tool-part-1",
        status: "completed",
        output: "done",
        observedStartedAtMs: 101,
      },
    });
  });

  test("keeps an exact current tool timestamp when terminal history uses an approximate timestamp", () => {
    const merged = mergedMessages(
      [
        {
          id: "tool:assistant-1:tool-part-1",
          role: "tool",
          content: "History completed output",
          timestamp: "2026-03-01T09:00:00.000Z",
          timestampIsApproximate: true,
          meta: {
            kind: "tool",
            partId: "tool-part-1",
            callId: "call-1",
            tool: "bash",
            toolType: "generic" as const,
            status: "completed",
          },
        },
      ],
      [
        {
          id: "tool:assistant-1:tool-part-1",
          role: "tool",
          content: "Current running output",
          timestamp: "2026-03-01T09:00:03.000Z",
          meta: {
            kind: "tool",
            partId: "tool-part-1",
            callId: "call-1",
            tool: "bash",
            toolType: "generic" as const,
            status: "running",
          },
        },
      ],
    );

    expect(merged[0]?.timestamp).toBe("2026-03-01T09:00:03.000Z");
    expect(merged[0]?.timestampIsApproximate).toBeUndefined();
  });

  test("keeps an exact current subagent timestamp when history uses an approximate timestamp", () => {
    const subagentMeta = {
      kind: "subagent" as const,
      partId: "subagent-part-1",
      correlationKey: "session:parent:child",
      externalSessionId: "child",
      status: "completed" as const,
    };
    const merged = mergedMessages(
      [
        {
          id: "subagent:session:parent:child",
          role: "system",
          content: "Subagent completed",
          timestamp: "2026-03-01T09:00:00.000Z",
          timestampIsApproximate: true,
          meta: subagentMeta,
        },
      ],
      [
        {
          id: "subagent:session:parent:child",
          role: "system",
          content: "Subagent completed",
          timestamp: "2026-03-01T09:00:03.000Z",
          meta: subagentMeta,
        },
      ],
    );

    expect(merged[0]?.timestamp).toBe("2026-03-01T09:00:03.000Z");
    expect(merged[0]?.timestampIsApproximate).toBeUndefined();
  });

  test("appends unmatched current messages after loaded history", () => {
    const merged = mergedMessages(
      [
        {
          id: "assistant-1",
          role: "assistant",
          content: "History history",
          timestamp: "2026-03-01T09:00:01.000Z",
          meta: {
            kind: "assistant",
            agentRole: "build",
            isFinal: true,
          },
        },
      ],
      [
        {
          id: "assistant-2",
          role: "assistant",
          content: "Unmatched current row",
          timestamp: "2026-03-01T09:00:02.000Z",
          meta: {
            kind: "assistant",
            agentRole: "build",
            isFinal: false,
          },
        },
      ],
    );

    expect(merged.map((message) => message.id)).toEqual(["assistant-1", "assistant-2"]);
  });

  test("preserves the local system prompt header when runtime history has not emitted it yet", () => {
    const merged = mergedMessages(
      [
        {
          id: "assistant-1",
          role: "assistant",
          content: "Runtime history answer",
          timestamp: "2026-03-01T09:00:02.000Z",
          meta: {
            kind: "assistant",
            agentRole: "build",
            isFinal: true,
          },
        },
      ],
      [
        {
          id: "history:system-prompt:session-1",
          role: "system",
          content: "System prompt:\n\nBuild the task from repo rules.",
          timestamp: "2026-03-01T09:00:00.000Z",
        },
      ],
    );

    expect(merged.map((message) => message.id)).toEqual([
      "history:system-prompt:session-1",
      "assistant-1",
    ]);
  });

  test("does not duplicate the local system prompt header when runtime history provides one", () => {
    const merged = mergedMessages(
      [
        {
          id: "codex-system-prompt:session-1",
          role: "system",
          content: "System prompt:\n\nRuntime-owned prompt.",
          timestamp: "2026-03-01T09:00:00.000Z",
        },
        {
          id: "assistant-1",
          role: "assistant",
          content: "Runtime history answer",
          timestamp: "2026-03-01T09:00:02.000Z",
          meta: {
            kind: "assistant",
            agentRole: "build",
            isFinal: true,
          },
        },
      ],
      [
        {
          id: "history:system-prompt:session-1",
          role: "system",
          content: "System prompt:\n\nLocal computed prompt.",
          timestamp: "2026-03-01T09:00:00.000Z",
        },
      ],
    );

    expect(merged.map((message) => message.id)).toEqual([
      "codex-system-prompt:session-1",
      "assistant-1",
    ]);
  });

  test("keeps runtime user messages that arrived after the loaded history snapshot", () => {
    const merged = mergedMessages(
      [
        {
          id: "runtime-user-older",
          role: "user",
          content: "Earlier request",
          timestamp: "2026-03-01T09:00:00.000Z",
          meta: {
            kind: "user",
            state: "read",
            parts: [{ kind: "text", text: "Earlier request" }],
          },
        },
      ],
      [
        {
          id: "runtime-user-kickoff",
          role: "user",
          content: "Resume the builder after QA rejection",
          timestamp: "2026-03-01T09:00:05.000Z",
          meta: {
            kind: "user",
            state: "queued",
            parts: [{ kind: "text", text: "Resume the builder after QA rejection" }],
          },
        },
      ],
    );

    expect(merged.map((message) => message.id)).toEqual([
      "runtime-user-older",
      "runtime-user-kickoff",
    ]);
  });

  test("keeps subagent terminal status and description consistent", () => {
    const merged = mergedMessages(
      [
        {
          id: "subagent:part:msg-200:child-a",
          role: "system",
          content: "Subagent (build): Finished A",
          timestamp: "2026-03-01T09:00:02.000Z",
          meta: {
            kind: "subagent",
            partId: "part-a-completed",
            correlationKey: "part:msg-200:child-a",
            status: "completed",
            agent: "build",
            prompt: "Inspect repo",
            description: "Finished A",
            externalSessionId: "child-a",
            startedAtMs: 100,
            endedAtMs: 300,
          },
        },
      ],
      [
        {
          id: "subagent:session:msg-200:child-a",
          role: "system",
          content: "Subagent (build): Error A",
          timestamp: "2026-03-01T09:00:03.000Z",
          meta: {
            kind: "subagent",
            partId: "session-a-error",
            correlationKey: "session:msg-200:child-a",
            status: "error",
            agent: "build",
            prompt: "Inspect repo",
            description: "Error A",
            externalSessionId: "child-a",
            startedAtMs: 95,
            endedAtMs: 320,
          },
        },
      ],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      id: "subagent:part:msg-200:child-a",
      role: "system",
      content: "Subagent (build): Error A",
      meta: {
        kind: "subagent",
        correlationKey: "part:msg-200:child-a",
        status: "error",
        agent: "build",
        prompt: "Inspect repo",
        description: "Error A",
        externalSessionId: "child-a",
        startedAtMs: 95,
        endedAtMs: 320,
      },
    });
  });

  test("absorbs a current subagent session row into only one history part row", () => {
    const merged = mergedMessages(
      [
        {
          id: "subagent:part:msg-200:child-a-1",
          role: "system",
          content: "Subagent (build): Part one",
          timestamp: "2026-03-01T09:00:02.000Z",
          meta: {
            kind: "subagent",
            partId: "part-a-1",
            correlationKey: "part:msg-200:child-a-1",
            status: "completed",
            agent: "build",
            prompt: "Inspect repo",
            description: "Part one",
            externalSessionId: "child-a",
            startedAtMs: 100,
            endedAtMs: 300,
          },
        },
        {
          id: "subagent:part:msg-200:child-a-2",
          role: "system",
          content: "Subagent (build): Part two",
          timestamp: "2026-03-01T09:00:03.000Z",
          meta: {
            kind: "subagent",
            partId: "part-a-2",
            correlationKey: "part:msg-200:child-a-2",
            status: "completed",
            agent: "build",
            prompt: "Inspect repo",
            description: "Part two",
            externalSessionId: "child-a",
            startedAtMs: 110,
            endedAtMs: 310,
          },
        },
      ],
      [
        {
          id: "subagent:session:msg-200:child-a",
          role: "system",
          content: "Subagent (build): Current session row",
          timestamp: "2026-03-01T09:00:01.000Z",
          meta: {
            kind: "subagent",
            partId: "session-a",
            correlationKey: "session:msg-200:child-a",
            status: "running",
            agent: "build",
            prompt: "Inspect repo",
            description: "Current session row",
            externalSessionId: "child-a",
            startedAtMs: 90,
          },
        },
      ],
    );

    expect(merged).toHaveLength(2);
    expect(merged.map((message) => message.id)).toEqual([
      "subagent:part:msg-200:child-a-1",
      "subagent:part:msg-200:child-a-2",
    ]);
    expect(merged.every((message) => message.meta?.kind === "subagent")).toBe(true);
    expect(merged[0]?.meta?.kind === "subagent" ? merged[0].meta.startedAtMs : null).toBe(90);
    expect(merged[1]?.meta?.kind === "subagent" ? merged[1].meta.startedAtMs : null).toBe(110);
  });

  test("bridges a unique current session-scoped subagent row only once", () => {
    const merged = mergedMessages(
      [
        {
          id: "subagent:part:msg-200:child-a-1",
          role: "system",
          content: "Subagent (build): Part one",
          timestamp: "2026-03-01T09:00:02.000Z",
          meta: {
            kind: "subagent",
            partId: "part-a-1",
            correlationKey: "part:msg-200:child-a-1",
            status: "completed",
            agent: "build",
            prompt: "Inspect repo",
            description: "Part one",
            startedAtMs: 100,
            endedAtMs: 300,
          },
        },
        {
          id: "subagent:part:msg-200:child-a-2",
          role: "system",
          content: "Subagent (build): Part two",
          timestamp: "2026-03-01T09:00:03.000Z",
          meta: {
            kind: "subagent",
            partId: "part-a-2",
            correlationKey: "part:msg-200:child-a-2",
            status: "completed",
            agent: "build",
            prompt: "Inspect repo",
            description: "Part two",
            startedAtMs: 110,
            endedAtMs: 310,
          },
        },
      ],
      [
        {
          id: "subagent:session:msg-200:child-a",
          role: "system",
          content: "Subagent (build): Current session row",
          timestamp: "2026-03-01T09:00:01.000Z",
          meta: {
            kind: "subagent",
            partId: "session-a",
            correlationKey: "session:msg-200:child-a",
            status: "running",
            agent: "build",
            prompt: "Inspect repo",
            description: "Current session row",
            externalSessionId: "child-a",
            startedAtMs: 90,
          },
        },
      ],
    );

    expect(merged).toHaveLength(2);
    expect(merged[0]?.meta?.kind === "subagent" ? merged[0].meta.externalSessionId : null).toBe(
      "child-a",
    );
    expect(
      merged[1]?.meta?.kind === "subagent" ? merged[1].meta.externalSessionId : null,
    ).toBeUndefined();
    expect(merged[0]?.meta?.kind === "subagent" ? merged[0].meta.startedAtMs : null).toBe(90);
    expect(merged[1]?.meta?.kind === "subagent" ? merged[1].meta.startedAtMs : null).toBe(110);
  });

  test("absorbs a matching current tool row only once", () => {
    const merged = mergedMessages(
      [
        {
          id: "tool:assistant-1:history-tool-a",
          role: "tool",
          content: "History running A",
          timestamp: "2026-03-01T09:00:02.000Z",
          meta: {
            kind: "tool",
            partId: "tool-part-1",
            callId: "",
            tool: "bash",
            toolType: "generic" as const,
            status: "running",
          },
        },
        {
          id: "tool:assistant-1:history-tool-b",
          role: "tool",
          content: "History running B",
          timestamp: "2026-03-01T09:00:03.000Z",
          meta: {
            kind: "tool",
            partId: "tool-part-1",
            callId: "",
            tool: "bash",
            toolType: "generic" as const,
            status: "running",
          },
        },
      ],
      [
        {
          id: "tool:assistant-1:current-tool",
          role: "tool",
          content: "Current completed output",
          timestamp: "2026-03-01T09:00:04.000Z",
          meta: {
            kind: "tool",
            partId: "tool-part-1",
            callId: "",
            tool: "bash",
            toolType: "generic" as const,
            status: "completed",
            output: "done",
          },
        },
      ],
    );

    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({
      id: "tool:assistant-1:tool-part-1",
      content: "Current completed output",
      meta: { kind: "tool", status: "completed", output: "done" },
    });
    expect(merged[1]).toMatchObject({
      id: "tool:assistant-1:history-tool-b",
      content: "History running B",
      meta: { kind: "tool", status: "running" },
    });
  });

  test("keeps history terminal subagent status and description over stale current state", () => {
    const merged = mergedMessages(
      [
        {
          id: "subagent:part:msg-200:child-a",
          role: "system",
          content: "Subagent (build): Failed A",
          timestamp: "2026-03-01T09:00:03.000Z",
          meta: {
            kind: "subagent",
            partId: "part-a-error",
            correlationKey: "part:msg-200:child-a",
            status: "error",
            agent: "build",
            prompt: "Inspect repo",
            description: "Failed A",
            externalSessionId: "child-a",
            startedAtMs: 100,
            endedAtMs: 300,
          },
        },
      ],
      [
        {
          id: "subagent:session:msg-200:child-a",
          role: "system",
          content: "Subagent (build): Still running A",
          timestamp: "2026-03-01T09:00:02.000Z",
          meta: {
            kind: "subagent",
            partId: "session-a-running",
            correlationKey: "session:msg-200:child-a",
            status: "running",
            agent: "build",
            prompt: "Inspect repo",
            description: "Still running A",
            externalSessionId: "child-a",
            startedAtMs: 95,
          },
        },
      ],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      content: "Subagent (build): Failed A",
      meta: {
        kind: "subagent",
        status: "error",
        description: "Failed A",
        startedAtMs: 95,
        endedAtMs: 300,
      },
    });
  });

  test("updates current user messages from loaded history by runtime id", () => {
    const merged = mergedMessages(
      [
        {
          id: "runtime-user-queued",
          role: "user",
          content: "Resume the builder after QA rejection",
          timestamp: "2026-03-01T09:00:02.000Z",
          meta: {
            kind: "user",
            state: "read",
            parts: [{ kind: "text", text: "Resume the builder after QA rejection" }],
          },
        },
      ],
      [
        {
          id: "runtime-user-queued",
          role: "user",
          content: "Resume the builder after QA rejection",
          timestamp: "2026-03-01T09:00:01.000Z",
          meta: {
            kind: "user",
            state: "queued",
            providerId: "openai",
            modelId: "gpt-5",
            parts: [{ kind: "text", text: "Resume the builder after QA rejection" }],
          },
        },
      ],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual(
      expect.objectContaining({
        id: "runtime-user-queued",
        role: "user",
        content: "Resume the builder after QA rejection",
        meta: {
          kind: "user",
          state: "read",
          providerId: "openai",
          modelId: "gpt-5",
          parts: [{ kind: "text", text: "Resume the builder after QA rejection" }],
        },
      }),
    );
  });

  test("keeps live user message content when history catches up with the same runtime id", () => {
    const merged = mergedMessages(
      [
        {
          id: "runtime-user-queued",
          role: "user",
          content: "",
          timestamp: "2026-03-01T09:00:02.000Z",
          meta: {
            kind: "user",
            state: "read",
          },
        },
      ],
      [
        {
          id: "runtime-user-queued",
          role: "user",
          content: "Resume the builder after QA rejection",
          timestamp: "2026-03-01T09:00:01.000Z",
          meta: {
            kind: "user",
            state: "queued",
            providerId: "openai",
            modelId: "gpt-5",
            parts: [{ kind: "text", text: "Resume the builder after QA rejection" }],
          },
        },
      ],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual(
      expect.objectContaining({
        id: "runtime-user-queued",
        role: "user",
        content: "Resume the builder after QA rejection",
        timestamp: "2026-03-01T09:00:01.000Z",
        meta: {
          kind: "user",
          state: "read",
          providerId: "openai",
          modelId: "gpt-5",
          parts: [{ kind: "text", text: "Resume the builder after QA rejection" }],
        },
      }),
    );
  });

  test("reconciles a local accepted user send when history confirms it with a nearby timestamp", () => {
    const merged = mergedMessages(
      [
        {
          id: "runtime-user-confirmed",
          role: "user",
          content: "Hi",
          timestamp: "2026-03-01T09:00:01.000Z",
          meta: {
            kind: "user",
            state: "read",
            parts: [{ kind: "text", text: "Hi" }],
          },
        },
      ],
      [
        {
          id: "codex-user-1772355601123-1",
          role: "user",
          content: "Hi",
          timestamp: "2026-03-01T09:00:01.123Z",
          meta: {
            kind: "user",
            state: "read",
            parts: [{ kind: "text", text: "Hi" }],
          },
        },
      ],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual(
      expect.objectContaining({
        id: "codex-user-1772355601123-1",
        role: "user",
        content: "Hi",
        timestamp: "2026-03-01T09:00:01.123Z",
      }),
    );
  });

  test("reconciles a local accepted user send when history confirms it after an approval delay", () => {
    const merged = mergedMessages(
      [
        {
          id: "runtime-user-confirmed",
          role: "user",
          content: "Check network with curl",
          timestamp: "2026-03-01T09:00:06.000Z",
          meta: {
            kind: "user",
            state: "read",
            parts: [{ kind: "text", text: "Check network with curl" }],
          },
        },
      ],
      [
        {
          id: "codex-user-1772355601123-1",
          role: "user",
          content: "Check network with curl",
          timestamp: "2026-03-01T09:00:01.123Z",
          meta: {
            kind: "user",
            state: "read",
            parts: [{ kind: "text", text: "Check network with curl" }],
          },
        },
      ],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual(
      expect.objectContaining({
        id: "codex-user-1772355601123-1",
        role: "user",
        content: "Check network with curl",
        timestamp: "2026-03-01T09:00:01.123Z",
      }),
    );
  });

  test("matches the nearest local accepted user send when repeated text exists", () => {
    const merged = mergedMessages(
      [
        {
          id: "runtime-user-confirmed",
          role: "user",
          content: "ok",
          timestamp: "2026-03-01T09:00:00.000Z",
          meta: {
            kind: "user",
            state: "read",
            parts: [{ kind: "text", text: "ok" }],
          },
        },
      ],
      [
        {
          id: "codex-user-1772355600120-1",
          role: "user",
          content: "ok",
          timestamp: "2026-03-01T09:00:00.120Z",
          meta: {
            kind: "user",
            state: "read",
            parts: [{ kind: "text", text: "ok" }],
          },
        },
        {
          id: "codex-user-1772355600900-1",
          role: "user",
          content: "ok",
          timestamp: "2026-03-01T09:00:00.900Z",
          meta: {
            kind: "user",
            state: "read",
            parts: [{ kind: "text", text: "ok" }],
          },
        },
      ],
    );

    expect(merged.map((message) => message.id)).toEqual([
      "codex-user-1772355600120-1",
      "codex-user-1772355600900-1",
    ]);
  });

  test("keeps different runtime user message ids distinct even when text matches", () => {
    const merged = mergedMessages(
      [
        {
          id: "runtime-user-older",
          role: "user",
          content: "ok",
          timestamp: "2026-03-01T09:00:00.000Z",
          meta: {
            kind: "user",
            state: "read",
            parts: [{ kind: "text", text: "ok" }],
          },
        },
      ],
      [
        {
          id: "runtime-user-newer",
          role: "user",
          content: "ok",
          timestamp: "2026-03-01T09:00:05.000Z",
          meta: {
            kind: "user",
            state: "queued",
            parts: [{ kind: "text", text: "ok" }],
          },
        },
      ],
    );

    expect(merged.map((message) => message.id)).toEqual([
      "runtime-user-older",
      "runtime-user-newer",
    ]);
  });
});
