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
    createSession(
      mergeHistoryMessages(
        EXTERNAL_SESSION_ID,
        createSessionMessagesState(EXTERNAL_SESSION_ID, historyMessages),
        createSessionMessagesState(EXTERNAL_SESSION_ID, currentMessages),
      ),
    ),
  );
};

describe("agent-orchestrator/support/history-message-merge", () => {
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

  test("absorbs a fallback-matched subagent session row only once", () => {
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
