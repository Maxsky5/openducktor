import { describe, expect, test } from "bun:test";
import { sessionMessagesToArray } from "@/test-utils/session-message-test-helpers";
import type { AgentChatMessage, AgentSessionState } from "@/types/agent-orchestrator";
import { mergeHydratedMessages } from "./hydrated-message-merge";

const SESSION_ID = "session-1";

const createSession = (messages: AgentSessionState["messages"]) => ({
  sessionId: SESSION_ID,
  messages,
});

const mergedMessages = (
  hydratedMessages: AgentChatMessage[],
  currentMessages: AgentChatMessage[],
): AgentChatMessage[] => {
  return sessionMessagesToArray(
    createSession(mergeHydratedMessages(SESSION_ID, hydratedMessages, currentMessages)),
  );
};

describe("agent-orchestrator/support/hydrated-message-merge", () => {
  test("prefers hydrated final assistant messages while preserving current metadata", () => {
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

  test("keeps completed current reasoning when hydrated reasoning is still incomplete", () => {
    const merged = mergedMessages(
      [
        {
          id: "thinking:assistant-1:reasoning-1",
          role: "thinking",
          content: "Hydrated reasoning",
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

  test("preserves a current terminal tool row and hydrates identity from the hydrated row", () => {
    const merged = mergedMessages(
      [
        {
          id: "tool:assistant-1:hydrated-tool",
          role: "tool",
          content: "Hydrated running output",
          timestamp: "2026-03-01T09:00:02.000Z",
          meta: {
            kind: "tool",
            partId: "tool-part-1",
            callId: "call-123",
            tool: "bash",
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
          content: "Hydrated running output",
          timestamp: "2026-03-01T09:00:02.000Z",
          meta: {
            kind: "tool",
            partId: "tool-part-1",
            callId: "call-123",
            tool: "bash",
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
          id: "tool:assistant-1:hydrated-part",
          role: "tool",
          content: "Hydrated completed output",
          timestamp: "2026-03-01T09:00:02.000Z",
          meta: {
            kind: "tool",
            partId: "tool-part-1",
            callId: "",
            tool: "bash",
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
            status: "running",
            observedStartedAtMs: 101,
          },
        },
      ],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      id: "tool:assistant-1:hydrated-part",
      role: "tool",
      content: "Hydrated completed output",
      meta: {
        kind: "tool",
        partId: "tool-part-1",
        status: "completed",
        output: "done",
        observedStartedAtMs: 101,
      },
    });
  });

  test("appends unmatched current messages after hydrated history", () => {
    const merged = mergedMessages(
      [
        {
          id: "assistant-1",
          role: "assistant",
          content: "Hydrated history",
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
            sessionId: "child-a",
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
            sessionId: "child-a",
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
        sessionId: "child-a",
        startedAtMs: 95,
        endedAtMs: 320,
      },
    });
  });

  test("absorbs a current subagent session row into only one hydrated part row", () => {
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
            sessionId: "child-a",
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
            sessionId: "child-a",
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
            sessionId: "child-a",
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
            sessionId: "child-a",
            startedAtMs: 90,
          },
        },
      ],
    );

    expect(merged).toHaveLength(2);
    expect(merged[0]?.meta?.kind === "subagent" ? merged[0].meta.sessionId : null).toBe("child-a");
    expect(merged[1]?.meta?.kind === "subagent" ? merged[1].meta.sessionId : null).toBeUndefined();
    expect(merged[0]?.meta?.kind === "subagent" ? merged[0].meta.startedAtMs : null).toBe(90);
    expect(merged[1]?.meta?.kind === "subagent" ? merged[1].meta.startedAtMs : null).toBe(110);
  });

  test("absorbs a matching current tool row only once", () => {
    const merged = mergedMessages(
      [
        {
          id: "tool:assistant-1:hydrated-tool-a",
          role: "tool",
          content: "Hydrated running A",
          timestamp: "2026-03-01T09:00:02.000Z",
          meta: {
            kind: "tool",
            partId: "tool-part-1",
            callId: "",
            tool: "bash",
            status: "running",
          },
        },
        {
          id: "tool:assistant-1:hydrated-tool-b",
          role: "tool",
          content: "Hydrated running B",
          timestamp: "2026-03-01T09:00:03.000Z",
          meta: {
            kind: "tool",
            partId: "tool-part-1",
            callId: "",
            tool: "bash",
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
      id: "tool:assistant-1:hydrated-tool-b",
      content: "Hydrated running B",
      meta: { kind: "tool", status: "running" },
    });
  });

  test("keeps hydrated terminal subagent status and description over stale current state", () => {
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
            sessionId: "child-a",
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
            sessionId: "child-a",
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
});
