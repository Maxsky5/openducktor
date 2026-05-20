import { describe, expect, test } from "bun:test";
import {
  createIntent,
  createRecord,
  createSession,
  createStateHarness,
  getSessionMessageCount,
  mergeHydratedMessages,
  preparePersistedSessionMergeStage,
  type SessionStateMap,
  type SetStateAction,
  sessionMessageAt,
} from "./load-sessions-stages-test-harness";

describe("load-sessions-stages", () => {
  test("prefers hydrated final assistant messages over stale local streamed rows with the same id", () => {
    const merged = mergeHydratedMessages(
      "external-1",
      [
        {
          id: "assistant-1",
          role: "assistant",
          content: "Final complete response",
          timestamp: "2026-03-01T09:00:02.000Z",
          meta: {
            kind: "assistant",
            agentRole: "build",
            isFinal: true,
            providerId: "openai",
            modelId: "gpt-5",
          },
        },
      ],
      [
        {
          id: "assistant-1",
          role: "assistant",
          content: "Partial streamed response",
          timestamp: "2026-03-01T09:00:02.000Z",
          meta: {
            kind: "assistant",
            agentRole: "build",
            isFinal: false,
          },
        },
      ],
    );

    expect(getSessionMessageCount({ externalSessionId: "external-1", messages: merged })).toBe(1);
    expect(
      sessionMessageAt({ externalSessionId: "external-1", messages: merged }, 0)?.content,
    ).toBe("Final complete response");
    expect(
      sessionMessageAt({ externalSessionId: "external-1", messages: merged }, 0)?.meta,
    ).toMatchObject({
      kind: "assistant",
      isFinal: true,
      providerId: "openai",
      modelId: "gpt-5",
    });
  });

  test("does not coerce a same-id non-assistant message into a final assistant row", () => {
    const merged = mergeHydratedMessages(
      "external-1",
      [
        {
          id: "shared-id",
          role: "assistant",
          content: "Final complete response",
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
          id: "shared-id",
          role: "tool",
          content: "Tool output",
          timestamp: "2026-03-01T09:00:02.000Z",
          meta: {
            kind: "tool",
            partId: "part-1",
            callId: "call-1",
            tool: "bash",
            toolType: "generic" as const,
            status: "completed",
          },
        },
      ],
    );

    expect(getSessionMessageCount({ externalSessionId: "external-1", messages: merged })).toBe(1);
    expect(
      sessionMessageAt({ externalSessionId: "external-1", messages: merged }, 0),
    ).toMatchObject({
      id: "shared-id",
      role: "tool",
      content: "Tool output",
      meta: {
        kind: "tool",
        tool: "bash",
        toolType: "generic" as const,
        status: "completed",
      },
    });
  });

  test("absorbs live reasoning and tool rows that duplicate hydrated history rows", () => {
    const merged = mergeHydratedMessages(
      "external-1",
      [
        {
          id: "thinking:assistant-1:thinking-1",
          role: "thinking",
          content: "Hydrated reasoning",
          timestamp: "2026-03-01T09:00:01.000Z",
          meta: {
            kind: "reasoning",
            partId: "thinking-1",
            completed: true,
          },
        },
        {
          id: "tool:assistant-1:call-1",
          role: "tool",
          content: "bash completed",
          timestamp: "2026-03-01T09:00:02.000Z",
          meta: {
            kind: "tool",
            partId: "tool-part-1",
            callId: "call-1",
            tool: "bash",
            toolType: "generic" as const,
            status: "completed",
            output: "done",
          },
        },
        {
          id: "assistant-1",
          role: "assistant",
          content: "Final answer",
          timestamp: "2026-03-01T09:00:03.000Z",
          meta: {
            kind: "assistant",
            agentRole: "build",
            isFinal: true,
          },
        },
      ],
      [
        {
          id: "assistant-1",
          role: "assistant",
          content: "Final answer",
          timestamp: "2026-03-01T09:00:03.000Z",
          meta: {
            kind: "assistant",
            agentRole: "build",
            isFinal: true,
          },
        },
        {
          id: "thinking:assistant-1:thinking-1",
          role: "thinking",
          content: "Live reasoning",
          timestamp: "2026-03-01T09:00:04.000Z",
          meta: {
            kind: "reasoning",
            partId: "thinking-1",
            completed: false,
          },
        },
        {
          id: "tool:assistant-1:call-1",
          role: "tool",
          content: "bash running",
          timestamp: "2026-03-01T09:00:05.000Z",
          meta: {
            kind: "tool",
            partId: "tool-part-1",
            callId: "call-1",
            tool: "bash",
            toolType: "generic" as const,
            status: "running",
            observedStartedAtMs: 100,
            inputReadyAtMs: 120,
          },
        },
      ],
    );

    expect(getSessionMessageCount({ externalSessionId: "external-1", messages: merged })).toBe(3);
    expect(
      sessionMessageAt({ externalSessionId: "external-1", messages: merged }, 0),
    ).toMatchObject({
      role: "thinking",
      content: "Hydrated reasoning",
      meta: { kind: "reasoning", completed: true },
    });
    expect(
      sessionMessageAt({ externalSessionId: "external-1", messages: merged }, 1),
    ).toMatchObject({
      role: "tool",
      content: "bash completed",
      meta: {
        kind: "tool",
        status: "completed",
        output: "done",
        observedStartedAtMs: 100,
        inputReadyAtMs: 120,
      },
    });
    expect(
      sessionMessageAt({ externalSessionId: "external-1", messages: merged }, 2),
    ).toMatchObject({
      id: "assistant-1",
      role: "assistant",
      content: "Final answer",
    });
  });

  test("preserves newer live reasoning rows when hydrated history is still non-terminal", () => {
    const merged = mergeHydratedMessages(
      "external-1",
      [
        {
          id: "thinking:assistant-1:thinking-1",
          role: "thinking",
          content: "Hydrated partial reasoning",
          timestamp: "2026-03-01T09:00:01.000Z",
          meta: {
            kind: "reasoning",
            partId: "thinking-1",
            completed: false,
          },
        },
      ],
      [
        {
          id: "thinking:assistant-1:thinking-1",
          role: "thinking",
          content: "Live reasoning has continued",
          timestamp: "2026-03-01T09:00:02.000Z",
          meta: {
            kind: "reasoning",
            partId: "thinking-1",
            completed: false,
          },
        },
      ],
    );

    expect(getSessionMessageCount({ externalSessionId: "external-1", messages: merged })).toBe(1);
    expect(
      sessionMessageAt({ externalSessionId: "external-1", messages: merged }, 0),
    ).toMatchObject({
      role: "thinking",
      content: "Live reasoning has continued",
      meta: { kind: "reasoning", completed: false },
    });
  });

  test("keeps cross-id reasoning rows separate under canonical ids", () => {
    const merged = mergeHydratedMessages(
      "external-1",
      [
        {
          id: "thinking:assistant-1:thinking-1",
          role: "thinking",
          content: "Hydrated reasoning",
          timestamp: "2026-03-01T09:00:01.000Z",
          meta: {
            kind: "reasoning",
            partId: "thinking-1",
            completed: false,
          },
        },
      ],
      [
        {
          id: "thinking:assistant-1:alternate-thinking-key",
          role: "thinking",
          content: "Different live reasoning row",
          timestamp: "2026-03-01T09:00:02.000Z",
          meta: {
            kind: "reasoning",
            partId: "thinking-1",
            completed: false,
          },
        },
      ],
    );

    expect(getSessionMessageCount({ externalSessionId: "external-1", messages: merged })).toBe(2);
  });

  test("does not downgrade live running tool rows to stale hydrated pending rows", () => {
    const merged = mergeHydratedMessages(
      "external-1",
      [
        {
          id: "tool:assistant-1:call-1",
          role: "tool",
          content: "pending",
          timestamp: "2026-03-01T09:00:01.000Z",
          meta: {
            kind: "tool",
            partId: "tool-part-1",
            callId: "call-1",
            tool: "bash",
            toolType: "generic" as const,
            status: "pending",
          },
        },
      ],
      [
        {
          id: "tool:assistant-1:call-1",
          role: "tool",
          content: "running output",
          timestamp: "2026-03-01T09:00:02.000Z",
          meta: {
            kind: "tool",
            partId: "tool-part-1",
            callId: "call-1",
            tool: "bash",
            toolType: "generic" as const,
            status: "running",
            output: "newer output",
          },
        },
      ],
    );

    expect(getSessionMessageCount({ externalSessionId: "external-1", messages: merged })).toBe(1);
    expect(
      sessionMessageAt({ externalSessionId: "external-1", messages: merged }, 0),
    ).toMatchObject({
      role: "tool",
      content: "running output",
      meta: {
        kind: "tool",
        status: "running",
        output: "newer output",
      },
    });
  });

  test("preserves live running tool output over stale hydrated running rows", () => {
    const merged = mergeHydratedMessages(
      "external-1",
      [
        {
          id: "tool:assistant-1:call-1",
          role: "tool",
          content: "older running output",
          timestamp: "2026-03-01T09:00:01.000Z",
          meta: {
            kind: "tool",
            partId: "tool-part-1",
            callId: "call-1",
            tool: "bash",
            toolType: "generic" as const,
            status: "running",
            output: "older output",
          },
        },
      ],
      [
        {
          id: "tool:assistant-1:call-1",
          role: "tool",
          content: "newer running output",
          timestamp: "2026-03-01T09:00:02.000Z",
          meta: {
            kind: "tool",
            partId: "tool-part-1",
            callId: "call-1",
            tool: "bash",
            toolType: "generic" as const,
            status: "running",
            output: "newer output",
          },
        },
      ],
    );

    expect(getSessionMessageCount({ externalSessionId: "external-1", messages: merged })).toBe(1);
    expect(
      sessionMessageAt({ externalSessionId: "external-1", messages: merged }, 0),
    ).toMatchObject({
      role: "tool",
      content: "newer running output",
      meta: {
        kind: "tool",
        status: "running",
        output: "newer output",
      },
    });
  });

  test("keeps separate same-tool rows with different call ids", () => {
    const merged = mergeHydratedMessages(
      "external-1",
      [
        {
          id: "tool:assistant-1:call-1",
          role: "tool",
          content: "first",
          timestamp: "2026-03-01T09:00:01.000Z",
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
          id: "tool:assistant-1:call-2",
          role: "tool",
          content: "second",
          timestamp: "2026-03-01T09:00:02.000Z",
          meta: {
            kind: "tool",
            partId: "tool-part-2",
            callId: "call-2",
            tool: "bash",
            toolType: "generic" as const,
            status: "completed",
          },
        },
      ],
    );

    expect(getSessionMessageCount({ externalSessionId: "external-1", messages: merged })).toBe(2);
  });

  test("prefers hydrated completed tool rows over same-id live running rows", () => {
    const merged = mergeHydratedMessages(
      "external-1",
      [
        {
          id: "tool:assistant-1:call-1",
          role: "tool",
          content: "completed output",
          timestamp: "2026-03-01T09:00:01.000Z",
          meta: {
            kind: "tool",
            partId: "tool-part-1",
            callId: "call-1",
            tool: "bash",
            toolType: "generic" as const,
            status: "completed",
            output: "done",
          },
        },
      ],
      [
        {
          id: "tool:assistant-1:call-1",
          role: "tool",
          content: "still running",
          timestamp: "2026-03-01T09:00:02.000Z",
          meta: {
            kind: "tool",
            partId: "tool-part-1",
            callId: "call-1",
            tool: "bash",
            toolType: "generic" as const,
            status: "running",
            observedStartedAtMs: 100,
          },
        },
      ],
    );

    expect(getSessionMessageCount({ externalSessionId: "external-1", messages: merged })).toBe(1);
    expect(
      sessionMessageAt({ externalSessionId: "external-1", messages: merged }, 0),
    ).toMatchObject({
      role: "tool",
      content: "completed output",
      meta: {
        kind: "tool",
        status: "completed",
        output: "done",
        observedStartedAtMs: 100,
      },
    });
  });

  test("absorbs live tool rows created before a call id is available", () => {
    const merged = mergeHydratedMessages(
      "external-1",
      [
        {
          id: "tool:assistant-1:call-1",
          role: "tool",
          content: "completed output",
          timestamp: "2026-03-01T09:00:01.000Z",
          meta: {
            kind: "tool",
            partId: "tool-part-1",
            callId: "call-1",
            tool: "bash",
            toolType: "generic" as const,
            status: "completed",
            output: "done",
          },
        },
      ],
      [
        {
          id: "tool:assistant-1:tool-part-1",
          role: "tool",
          content: "still running",
          timestamp: "2026-03-01T09:00:02.000Z",
          meta: {
            kind: "tool",
            partId: "tool-part-1",
            callId: "",
            tool: "bash",
            toolType: "generic" as const,
            status: "running",
            observedStartedAtMs: 100,
          },
        },
      ],
    );

    expect(getSessionMessageCount({ externalSessionId: "external-1", messages: merged })).toBe(1);
    expect(
      sessionMessageAt({ externalSessionId: "external-1", messages: merged }, 0),
    ).toMatchObject({
      id: "tool:assistant-1:call-1",
      role: "tool",
      content: "completed output",
      meta: {
        kind: "tool",
        partId: "tool-part-1",
        callId: "call-1",
        status: "completed",
        observedStartedAtMs: 100,
      },
    });
  });

  test("matches tool rows with missing call ids without throwing", () => {
    const merged = mergeHydratedMessages(
      "external-1",
      [
        {
          id: "tool:assistant-1:hydrated-part-key",
          role: "tool",
          content: "completed output",
          timestamp: "2026-03-01T09:00:01.000Z",
          meta: {
            kind: "tool",
            partId: "tool-part-1",
            callId: undefined as unknown as string,
            tool: "bash",
            toolType: "generic" as const,
            status: "completed",
            output: "done",
          },
        },
      ],
      [
        {
          id: "tool:assistant-1:current-part-key",
          role: "tool",
          content: "still running",
          timestamp: "2026-03-01T09:00:02.000Z",
          meta: {
            kind: "tool",
            partId: "tool-part-1",
            callId: undefined as unknown as string,
            tool: "bash",
            toolType: "generic" as const,
            status: "running",
          },
        },
      ],
    );

    expect(getSessionMessageCount({ externalSessionId: "external-1", messages: merged })).toBe(1);
    expect(
      sessionMessageAt({ externalSessionId: "external-1", messages: merged }, 0),
    ).toMatchObject({
      id: "tool:assistant-1:hydrated-part-key",
      role: "tool",
      content: "completed output",
      meta: {
        kind: "tool",
        partId: "tool-part-1",
        status: "completed",
        output: "done",
      },
    });
  });

  test("absorbs current subagent rows when hydrated history has the same child session id", () => {
    const merged = mergeHydratedMessages(
      "external-1",
      [
        {
          id: "subagent:part:msg-200:subtask-a",
          role: "system",
          content: "Subagent (build): Finished A",
          timestamp: "2026-03-01T09:00:02.000Z",
          meta: {
            kind: "subagent",
            partId: "part-a-completed",
            correlationKey: "part:msg-200:subtask-a",
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
          content: "Subagent (build): Starting A",
          timestamp: "2026-03-01T09:00:01.000Z",
          meta: {
            kind: "subagent",
            partId: "session-a-running",
            correlationKey: "session:msg-200:child-a",
            status: "running",
            agent: "build",
            prompt: "Inspect repo",
            description: "Starting A",
            externalSessionId: "child-a",
            startedAtMs: 100,
          },
        },
      ],
    );

    expect(getSessionMessageCount({ externalSessionId: "external-1", messages: merged })).toBe(1);
    expect(
      sessionMessageAt({ externalSessionId: "external-1", messages: merged }, 0),
    ).toMatchObject({
      id: "subagent:part:msg-200:subtask-a",
      role: "system",
      content: "Subagent (build): Finished A",
      meta: {
        kind: "subagent",
        correlationKey: "part:msg-200:subtask-a",
        status: "completed",
        externalSessionId: "child-a",
        startedAtMs: 100,
        endedAtMs: 300,
      },
    });
  });

  test("absorbs a unique current completed session row when hydrated history still has the unresolved part row", () => {
    const merged = mergeHydratedMessages(
      "external-1",
      [
        {
          id: "subagent:part:msg-200:subtask-a",
          role: "system",
          content: "Subagent (build): Starting A",
          timestamp: "2026-03-01T09:00:01.000Z",
          meta: {
            kind: "subagent",
            partId: "part-a-running",
            correlationKey: "part:msg-200:subtask-a",
            status: "running",
            agent: "build",
            prompt: "Inspect repo",
            description: "Starting A",
            startedAtMs: 100,
          },
        },
      ],
      [
        {
          id: "subagent:session:msg-201:child-a",
          role: "system",
          content: "Subagent (build): Finished A",
          timestamp: "2026-03-01T09:00:02.000Z",
          meta: {
            kind: "subagent",
            partId: "session-a-completed",
            correlationKey: "session:msg-201:child-a",
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
    );

    expect(getSessionMessageCount({ externalSessionId: "external-1", messages: merged })).toBe(1);
    expect(
      sessionMessageAt({ externalSessionId: "external-1", messages: merged }, 0),
    ).toMatchObject({
      id: "subagent:part:msg-200:subtask-a",
      role: "system",
      content: "Subagent (build): Finished A",
      meta: {
        kind: "subagent",
        correlationKey: "part:msg-200:subtask-a",
        status: "completed",
        agent: "build",
        prompt: "Inspect repo",
        description: "Finished A",
        externalSessionId: "child-a",
        startedAtMs: 100,
        endedAtMs: 300,
      },
    });
  });

  test("absorbs a unique current cancelled session row when hydrated history still has the unresolved part row", () => {
    const merged = mergeHydratedMessages(
      "external-1",
      [
        {
          id: "subagent:part:msg-200:subtask-a",
          role: "system",
          content: "Subagent (build): Starting A",
          timestamp: "2026-03-01T09:00:01.000Z",
          meta: {
            kind: "subagent",
            partId: "part-a-running",
            correlationKey: "part:msg-200:subtask-a",
            status: "running",
            agent: "build",
            prompt: "Inspect repo",
            description: "Starting A",
            startedAtMs: 100,
          },
        },
      ],
      [
        {
          id: "subagent:session:msg-201:child-a",
          role: "system",
          content: "Subagent (build): Cancelled A",
          timestamp: "2026-03-01T09:00:02.000Z",
          meta: {
            kind: "subagent",
            partId: "session-a-cancelled",
            correlationKey: "session:msg-201:child-a",
            status: "cancelled",
            agent: "build",
            prompt: "Inspect repo",
            description: "Cancelled A",
            externalSessionId: "child-a",
            startedAtMs: 100,
            endedAtMs: 280,
          },
        },
      ],
    );

    expect(getSessionMessageCount({ externalSessionId: "external-1", messages: merged })).toBe(1);
    expect(
      sessionMessageAt({ externalSessionId: "external-1", messages: merged }, 0),
    ).toMatchObject({
      id: "subagent:part:msg-200:subtask-a",
      role: "system",
      content: "Subagent (build): Cancelled A",
      meta: {
        kind: "subagent",
        correlationKey: "part:msg-200:subtask-a",
        status: "cancelled",
        agent: "build",
        prompt: "Inspect repo",
        description: "Cancelled A",
        externalSessionId: "child-a",
        startedAtMs: 100,
        endedAtMs: 280,
      },
    });
  });

  test("keeps same-prompt current session rows separate when the hydration fallback is ambiguous", () => {
    const merged = mergeHydratedMessages(
      "external-1",
      [
        {
          id: "subagent:part:msg-200:subtask-a",
          role: "system",
          content: "Subagent (build): Starting A",
          timestamp: "2026-03-01T09:00:01.000Z",
          meta: {
            kind: "subagent",
            partId: "part-a-running",
            correlationKey: "part:msg-200:subtask-a",
            status: "running",
            agent: "build",
            prompt: "Inspect repo",
            description: "Starting A",
            startedAtMs: 100,
          },
        },
      ],
      [
        {
          id: "subagent:session:msg-201:child-a",
          role: "system",
          content: "Subagent (build): Finished A",
          timestamp: "2026-03-01T09:00:02.000Z",
          meta: {
            kind: "subagent",
            partId: "session-a-completed",
            correlationKey: "session:msg-201:child-a",
            status: "completed",
            agent: "build",
            prompt: "Inspect repo",
            description: "Finished A",
            externalSessionId: "child-a",
            startedAtMs: 100,
            endedAtMs: 300,
          },
        },
        {
          id: "subagent:session:msg-202:child-b",
          role: "system",
          content: "Subagent (build): Finished B",
          timestamp: "2026-03-01T09:00:03.000Z",
          meta: {
            kind: "subagent",
            partId: "session-b-completed",
            correlationKey: "session:msg-202:child-b",
            status: "completed",
            agent: "build",
            prompt: "Inspect repo",
            description: "Finished B",
            externalSessionId: "child-b",
            startedAtMs: 110,
            endedAtMs: 320,
          },
        },
      ],
    );

    expect(getSessionMessageCount({ externalSessionId: "external-1", messages: merged })).toBe(3);
    expect(
      sessionMessageAt({ externalSessionId: "external-1", messages: merged }, 0),
    ).toMatchObject({
      id: "subagent:part:msg-200:subtask-a",
      meta: {
        kind: "subagent",
        correlationKey: "part:msg-200:subtask-a",
        status: "running",
      },
    });
  });

  test("does not absorb descriptor-less rows through the hydration fallback", () => {
    const merged = mergeHydratedMessages(
      "external-1",
      [
        {
          id: "subagent:part:msg-200:subtask-a",
          role: "system",
          content: "Subagent (subagent): Subagent activity",
          timestamp: "2026-03-01T09:00:01.000Z",
          meta: {
            kind: "subagent",
            partId: "part-a-running",
            correlationKey: "part:msg-200:subtask-a",
            status: "running",
            startedAtMs: 100,
          },
        },
      ],
      [
        {
          id: "subagent:session:msg-201:child-a",
          role: "system",
          content: "Subagent (subagent): Session child-a",
          timestamp: "2026-03-01T09:00:02.000Z",
          meta: {
            kind: "subagent",
            partId: "session-a-completed",
            correlationKey: "session:msg-201:child-a",
            status: "completed",
            externalSessionId: "child-a",
            startedAtMs: 100,
            endedAtMs: 300,
          },
        },
      ],
    );

    expect(getSessionMessageCount({ externalSessionId: "external-1", messages: merged })).toBe(2);
    expect(
      sessionMessageAt({ externalSessionId: "external-1", messages: merged }, 0),
    ).toMatchObject({
      id: "subagent:part:msg-200:subtask-a",
      meta: {
        kind: "subagent",
        correlationKey: "part:msg-200:subtask-a",
        status: "running",
      },
    });
    expect(
      sessionMessageAt({ externalSessionId: "external-1", messages: merged }, 1),
    ).toMatchObject({
      id: "subagent:session:msg-201:child-a",
      meta: {
        kind: "subagent",
        correlationKey: "session:msg-201:child-a",
        status: "completed",
        externalSessionId: "child-a",
      },
    });
  });

  test("uses the in-memory requested session record without reloading persisted sessions", async () => {
    const existingSession = createSession();
    const stateHarness = createStateHarness({ "external-1": existingSession });
    let persistedLoads = 0;
    let setCalls = 0;

    const output = await preparePersistedSessionMergeStage({
      intent: createIntent({
        mode: "requested_history",
        requestedSessionId: "external-1",
        requestedHistoryKey: "/tmp/repo::task-1::external-1",
        shouldHydrateRequestedSession: true,
        historyPolicy: "requested_only",
      }),
      sessionsRef: stateHarness.sessionsRef,
      setSessionsById: (updater: SetStateAction<SessionStateMap>) => {
        setCalls += 1;
        stateHarness.setSessionsById(updater);
      },
      isStaleRepoOperation: () => false,
      loadPersistedRecords: async () => {
        persistedLoads += 1;
        return [createRecord()];
      },
      loadRepoPromptOverrides: async () => ({}),
    });

    expect(persistedLoads).toBe(0);
    expect(setCalls).toBe(0);
    expect(output.recordsToHydrate).toHaveLength(1);
    expect(output.recordsToHydrate[0]?.externalSessionId).toBe("external-1");
    expect(output.historyHydrationSessionIds.has("external-1")).toBe(true);
  });

  test("merges persisted records while preserving in-memory pending input", async () => {
    const existingSession = createSession({
      pendingApprovals: [
        {
          requestId: "perm-current",
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
        },
      ],
      pendingQuestions: [
        {
          requestId: "question-current",
          questions: [{ header: "Confirm", question: "Ship it?", options: [] }],
        },
      ],
    });
    const stateHarness = createStateHarness({ "external-1": existingSession });

    await preparePersistedSessionMergeStage({
      intent: createIntent(),
      sessionsRef: stateHarness.sessionsRef,
      setSessionsById: stateHarness.setSessionsById,
      isStaleRepoOperation: () => false,
      loadPersistedRecords: async () => [
        createRecord({
          startedAt: "2026-03-01T10:00:00.000Z",
          workingDirectory: "/tmp/repo/updated-worktree",
        }),
      ],
      loadRepoPromptOverrides: async () => ({}),
    });

    const nextSession = stateHarness.getState()["external-1"];
    expect(nextSession?.startedAt).toBe("2026-03-01T10:00:00.000Z");
    expect(nextSession?.pendingApprovals).toEqual(existingSession.pendingApprovals);
    expect(nextSession?.pendingQuestions).toEqual(existingSession.pendingQuestions);
  });

  test("preserves transcript-purpose sessions on non-requested loads", async () => {
    const existingSession = createSession({
      purpose: "transcript",
      role: "spec",
    });
    const stateHarness = createStateHarness({ "external-1": existingSession });

    await preparePersistedSessionMergeStage({
      intent: createIntent({
        mode: "bootstrap",
        shouldHydrateRequestedSession: false,
      }),
      sessionsRef: stateHarness.sessionsRef,
      setSessionsById: stateHarness.setSessionsById,
      isStaleRepoOperation: () => false,
      loadPersistedRecords: async () => [createRecord()],
      loadRepoPromptOverrides: async () => ({}),
    });

    const nextSession = stateHarness.getState()["external-1"];
    expect(nextSession?.purpose).toBe("transcript");
    expect(nextSession?.role).toBe("spec");
  });

  test("keeps requested-history persisted workflow records as primary sessions", async () => {
    const stateHarness = createStateHarness({
      "external-1": createSession({
        purpose: "transcript",
        role: null,
      }),
    });

    await preparePersistedSessionMergeStage({
      intent: createIntent({
        mode: "requested_history",
        requestedSessionId: "external-1",
        shouldHydrateRequestedSession: true,
        historyPolicy: "requested_only",
      }),
      sessionsRef: stateHarness.sessionsRef,
      setSessionsById: stateHarness.setSessionsById,
      isStaleRepoOperation: () => false,
      loadPersistedRecords: async () => [createRecord()],
      loadRepoPromptOverrides: async () => ({}),
    });

    const requestedSession = stateHarness.getState()["external-1"];
    expect(requestedSession?.purpose).toBe("primary");
    expect(requestedSession?.role).toBe("build");
  });

  test("keeps recovered workflow records primary when runtime attachment is retried", async () => {
    const stateHarness = createStateHarness({
      "external-1": createSession({
        purpose: "transcript",
        role: null,
      }),
    });

    await preparePersistedSessionMergeStage({
      intent: createIntent({
        mode: "recover_runtime_attachment",
        requestedSessionId: "external-1",
        historyPolicy: "none",
        shouldReconcileLiveSessions: true,
      }),
      sessionsRef: stateHarness.sessionsRef,
      setSessionsById: stateHarness.setSessionsById,
      isStaleRepoOperation: () => false,
      loadPersistedRecords: async () => [createRecord()],
      loadRepoPromptOverrides: async () => ({}),
    });

    const recoveredSession = stateHarness.getState()["external-1"];
    expect(recoveredSession?.purpose).toBe("primary");
    expect(recoveredSession?.role).toBe("build");
  });
});
