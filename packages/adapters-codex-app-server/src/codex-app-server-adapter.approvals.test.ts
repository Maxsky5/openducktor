import { describe, expect, mock, test } from "bun:test";
import {
  codexSessionRef,
  codexSessionRuntimeRef,
  codexUserMessageInput,
  createDeferred,
  createHarness,
  waitForEvent,
} from "./codex-app-server-adapter.test-harness";

describe("CodexAppServerAdapter approvals", () => {
  test("emits a session error for streamed server requests missing threadId", async () => {
    const streamListeners: Array<
      (event: { runtimeId: string; kind: "server_request"; message: unknown }) => void
    > = [];
    const subscribeEvents = mock((_runtimeId: string, listener) => {
      streamListeners.push(listener);
      return () => {};
    });
    const { adapter } = createHarness({ subscribeEvents });

    await adapter.startSession({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      taskId: "task-1",
      role: "build",
      systemPrompt: "Use the repo rules.",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });

    const events: unknown[] = [];
    const unsubscribe = adapter.subscribeEvents(
      codexSessionRuntimeRef("thread/start-runtime-ensure"),
      (event) => events.push(event),
    );

    streamListeners[0]?.({
      runtimeId: "runtime-ensure",
      kind: "server_request",
      message: { id: 71, method: "approval/request", params: { tool: "network" } },
    });

    await waitForEvent(
      events,
      (event) =>
        typeof event === "object" &&
        event !== null &&
        (event as { type?: unknown; message?: unknown }).type === "session_error" &&
        typeof (event as { message?: unknown }).message === "string" &&
        (event as { message: string }).message.includes("missing params.threadId"),
    );
    unsubscribe();
  });

  test("rejects Codex dynamic tool calls because workflow tools use MCP", async () => {
    const streamListeners: Array<
      (event: { runtimeId: string; kind: "server_request"; message: unknown }) => void
    > = [];
    const subscribeEvents = mock((_runtimeId: string, listener) => {
      streamListeners.push(listener);
      return () => {};
    });
    const drainServerRequests = mock(async () => [] as unknown[]);
    const { adapter, respondServerRequest } = createHarness({
      drainServerRequests,
      subscribeEvents,
    });

    await adapter.startSession({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      taskId: "task-1",
      role: "spec",
      systemPrompt: "Use the repo rules.",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });

    const request = {
      id: 17,
      method: "item/tool/call",
      params: {
        threadId: "thread/start-runtime-ensure",
        turnId: "turn-1",
        callId: "call-1",
        tool: "odt_set_spec",
        arguments: { taskId: "task-1", markdown: "# Spec" },
      },
    };
    const events: unknown[] = [];
    const unsubscribe = adapter.subscribeEvents(
      codexSessionRuntimeRef("thread/start-runtime-ensure"),
      (event) => events.push(event),
    );
    streamListeners[0]?.({ runtimeId: "runtime-ensure", kind: "server_request", message: request });
    await waitForEvent(
      events,
      (event) =>
        typeof event === "object" &&
        event !== null &&
        (event as { type?: unknown; message?: unknown }).type === "session_error" &&
        typeof (event as { message?: unknown }).message === "string" &&
        (event as { message: string }).message.includes("must use MCP"),
    );

    expect(respondServerRequest).toHaveBeenCalledWith(
      "runtime-ensure",
      17,
      {
        contentItems: [
          {
            type: "inputText",
            text: "OpenDucktor workflow tools are provided through the openducktor MCP server, not Codex dynamic tools.",
          },
        ],
        success: false,
      },
      undefined,
    );
    expect(drainServerRequests).not.toHaveBeenCalled();
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "session_error",
        message: expect.stringContaining("must use MCP"),
      }),
    );
    unsubscribe();
  });

  test("surfaces unknown Codex server methods as approval requests", async () => {
    const { adapter, transports, drainServerRequests, respondServerRequest } = createHarness(
      {},
      { deferTurnStart: true },
    );

    await adapter.startSession({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      taskId: "task-1",
      role: "build",
      systemPrompt: "Use the repo rules.",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });

    const transport = transports.get("runtime-ensure");
    drainServerRequests.mockImplementationOnce(async () => [
      {
        id: 19,
        method: "item/unknown",
        params: {
          threadId: "thread/start-runtime-ensure",
          turnId: "turn-3",
          callId: "call-3",
          tool: "odt_read_task",
          arguments: { taskId: "task-1" },
        },
      },
    ]);
    const events: unknown[] = [];
    adapter.subscribeEvents(codexSessionRuntimeRef("thread/start-runtime-ensure"), (event) =>
      events.push(event),
    );

    await expect(
      adapter.sendUserMessage(
        codexUserMessageInput({
          externalSessionId: "thread/start-runtime-ensure",
          parts: [{ kind: "text", text: "Read the task" }],
          model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
        }),
      ),
    ).resolves.toBeUndefined();

    expect(respondServerRequest).not.toHaveBeenCalled();
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "approval_required",
        requestId: "19",
        requestType: "runtime_tool",
        title: "Codex item/unknown",
      }),
    );
    await adapter.replyApproval({
      externalSessionId: "thread/start-runtime-ensure",
      requestId: "19",
      outcome: "reject",
    });
    expect(respondServerRequest).toHaveBeenCalledWith(
      "runtime-ensure",
      19,
      expect.objectContaining({ approved: false, outcome: "reject" }),
      undefined,
    );
    transport?.turnStartDeferred.resolve({});
  });

  test("preserves initial-turn approvals for late listeners and presence snapshots", async () => {
    const { adapter, drainServerRequests } = createHarness({}, { deferTurnStart: true });
    drainServerRequests.mockImplementationOnce(async () => [
      {
        id: 31,
        method: "approval/request",
        params: { tool: "network", url: "https://example.com" },
      },
    ]);

    await adapter.startSession({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      taskId: "task-1",
      role: "build",
      systemPrompt: "Use the repo rules.",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });
    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: "thread/start-runtime-ensure",
        parts: [{ kind: "text", text: "Start now" }],
      }),
    );

    await expect(
      adapter.readSessionPresence({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread/start-runtime-ensure",
      }),
    ).resolves.toMatchObject({
      presence: "runtime",
      classification: "waiting_for_permission",
      pendingApprovals: [expect.objectContaining({ requestId: "31" })],
    });

    const replayedEvents: unknown[] = [];
    adapter.subscribeEvents(codexSessionRuntimeRef("thread/start-runtime-ensure"), (event) =>
      replayedEvents.push(event),
    );
    expect(replayedEvents).toContainEqual(
      expect.objectContaining({ type: "approval_required", requestId: "31" }),
    );
  });

  test("surfaces and resolves Codex user-input question requests", async () => {
    const { adapter, drainServerRequests, respondServerRequest } = createHarness(
      {},
      { deferTurnStart: true },
    );
    const events: unknown[] = [];
    drainServerRequests.mockImplementationOnce(async () => [
      {
        id: 32,
        method: "item/tool/requestUserInput",
        params: {
          threadId: "thread/start-runtime-ensure",
          turnId: "turn-question",
          itemId: "item-1",
          questions: [
            {
              id: "question-1",
              header: "Mode",
              question: "Pick a mode",
              isOther: true,
              options: [{ label: "Safe", description: "Use safe mode" }],
            },
          ],
        },
      },
    ]);

    await adapter.startSession({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      taskId: "task-1",
      role: "build",
      systemPrompt: "Use the repo rules.",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });
    adapter.subscribeEvents(codexSessionRuntimeRef("thread/start-runtime-ensure"), (event) =>
      events.push(event),
    );
    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: "thread/start-runtime-ensure",
        parts: [{ kind: "text", text: "Start now" }],
      }),
    );

    await expect(
      waitForEvent(
        events,
        (event) =>
          typeof event === "object" &&
          event !== null &&
          (event as { type?: unknown }).type === "assistant_part" &&
          (event as { part?: { tool?: unknown; status?: unknown } }).part?.tool ===
            "request_user_input" &&
          (event as { part?: { tool?: unknown; status?: unknown } }).part?.status === "running",
      ),
    ).resolves.toMatchObject({
      part: expect.objectContaining({
        callId: "32",
        tool: "request_user_input",
        title: "Question",
        preview: "Pick a mode",
        input: {
          requestId: "32",
          questions: [
            expect.objectContaining({ header: "Mode", question: "Pick a mode", custom: true }),
          ],
        },
      }),
    });

    await expect(
      adapter.readSessionPresence({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread/start-runtime-ensure",
      }),
    ).resolves.toMatchObject({
      presence: "runtime",
      classification: "waiting_for_question",
      pendingQuestions: [
        expect.objectContaining({
          requestId: "32",
          questions: [
            expect.objectContaining({
              header: "Mode",
              question: "Pick a mode",
              custom: true,
              options: [{ label: "Safe", description: "Use safe mode" }],
            }),
          ],
        }),
      ],
    });

    await adapter.replyQuestion({
      externalSessionId: "thread/start-runtime-ensure",
      requestId: "32",
      answers: [["Safe"]],
    });

    expect(respondServerRequest).toHaveBeenCalledWith(
      "runtime-ensure",
      32,
      { answers: { "question-1": { answers: ["Safe"] } } },
      undefined,
    );
    await expect(
      waitForEvent(
        events,
        (event) =>
          typeof event === "object" &&
          event !== null &&
          (event as { type?: unknown }).type === "assistant_part" &&
          (event as { part?: { tool?: unknown; status?: unknown } }).part?.tool ===
            "request_user_input" &&
          (event as { part?: { tool?: unknown; status?: unknown } }).part?.status === "completed",
      ),
    ).resolves.toMatchObject({
      part: expect.objectContaining({
        callId: "32",
        tool: "request_user_input",
        status: "completed",
        output: JSON.stringify({ answers: { "question-1": { answers: ["Safe"] } } }),
        metadata: expect.objectContaining({
          requestId: "32",
          answers: { "question-1": { answers: ["Safe"] } },
        }),
      }),
    });
  });

  test("clears pending Codex input state when local stop cleanup runs", async () => {
    const { adapter, drainServerRequests } = createHarness({}, { deferTurnStart: true });
    drainServerRequests.mockImplementationOnce(async () => [
      {
        id: 36,
        method: "item/tool/requestUserInput",
        params: {
          threadId: "thread/start-runtime-ensure",
          turnId: "turn-question",
          itemId: "item-1",
          questions: [{ id: "question-1", header: "Confirm", question: "Continue?" }],
        },
      },
    ]);

    await adapter.startSession({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      taskId: "task-1",
      role: "build",
      systemPrompt: "Use the repo rules.",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });
    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: "thread/start-runtime-ensure",
        parts: [{ kind: "text", text: "Start now" }],
      }),
    );

    await expect(
      adapter.readSessionPresence({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread/start-runtime-ensure",
      }),
    ).resolves.toMatchObject({
      classification: "waiting_for_question",
      pendingQuestions: [expect.objectContaining({ requestId: "36" })],
    });

    await adapter.stopSession(codexSessionRef("thread/start-runtime-ensure"));

    await expect(
      adapter.replyQuestion({
        ...codexSessionRuntimeRef("thread/start-runtime-ensure"),
        externalSessionId: "thread/start-runtime-ensure",
        requestId: "36",
        answers: [["yes"]],
      }),
    ).rejects.toThrow("Unknown Codex question request '36'.");
  });

  test("steers active Codex turns for queued user messages", async () => {
    const { adapter, drainServerRequests, transports } = createHarness(
      {},
      { deferTurnStart: true },
    );
    drainServerRequests.mockImplementationOnce(async () => [
      {
        id: 33,
        method: "item/tool/requestUserInput",
        params: {
          threadId: "thread/start-runtime-ensure",
          turnId: "turn-active",
          itemId: "item-1",
          questions: [{ id: "question-1", header: "Confirm", question: "Continue?" }],
        },
      },
    ]);

    await adapter.startSession({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      taskId: "task-1",
      role: "build",
      systemPrompt: "Use the repo rules.",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });
    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: "thread/start-runtime-ensure",
        parts: [{ kind: "text", text: "Start now" }],
      }),
    );

    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: "thread/start-runtime-ensure",
        parts: [{ kind: "text", text: "Also inspect failing tests" }],
      }),
    );

    expect(transports.get("runtime-ensure")?.calls).toContainEqual({
      method: "turn/steer",
      params: {
        threadId: "thread/start-runtime-ensure",
        input: [{ type: "text", text: "Also inspect failing tests" }],
        expectedTurnId: "turn-active",
      },
    });
  });

  test("rejects malformed approval request ids before replying to the Codex server", async () => {
    const { adapter, respondServerRequest } = createHarness();

    await expect(
      adapter.replyApproval({
        externalSessionId: "thread/start-runtime-ensure",
        requestId: "not-a-number",
        outcome: "approve_once",
      }),
    ).rejects.toThrow("Codex approval request id 'not-a-number' must be numeric.");

    expect(respondServerRequest).toHaveBeenCalledTimes(0);
  });

  test("rejects malformed question request ids before replying to the Codex server", async () => {
    const { adapter, respondServerRequest } = createHarness();

    await expect(
      adapter.replyQuestion({
        externalSessionId: "thread/start-runtime-ensure",
        requestId: "32.5",
        answers: [["yes"]],
      }),
    ).rejects.toThrow("Codex question request id '32.5' must be numeric.");

    expect(respondServerRequest).toHaveBeenCalledTimes(0);
  });

  test("continues a paused turn from streamed requests after approval replies", async () => {
    const dynamicToolRejected = createDeferred<void>();
    const respondServerRequest = mock(async (_runtimeId: string, requestId: number) => {
      if (requestId === 42) {
        dynamicToolRejected.resolve();
      }
    });
    const streamListeners: Array<
      (event: { runtimeId: string; kind: "server_request"; message: unknown }) => void
    > = [];
    const subscribeEvents = mock((_runtimeId: string, listener) => {
      streamListeners.push(listener);
      return () => {};
    });
    const drainServerRequests = mock(async () => [] as unknown[]);
    const { adapter } = createHarness({
      respondServerRequest,
      drainServerRequests,
      subscribeEvents,
    });
    const approvalRequest = {
      id: 41,
      method: "approval/request",
      params: {
        threadId: "thread/start-runtime-ensure",
        tool: "network",
        url: "https://example.com",
      },
    };
    const toolRequest = {
      id: 42,
      method: "item/tool/call",
      params: {
        threadId: "thread/start-runtime-ensure",
        turnId: "turn-4",
        callId: "call-4",
        tool: "odt_read_task",
        arguments: { taskId: "task-1" },
      },
    };

    await adapter.startSession({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      taskId: "task-1",
      role: "build",
      systemPrompt: "Use the repo rules.",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });
    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: "thread/start-runtime-ensure",
        parts: [{ kind: "text", text: "Start now" }],
      }),
    );
    const events: unknown[] = [];
    const unsubscribe = adapter.subscribeEvents(
      codexSessionRuntimeRef("thread/start-runtime-ensure"),
      (event) => events.push(event),
    );
    streamListeners[0]?.({
      runtimeId: "runtime-ensure",
      kind: "server_request",
      message: approvalRequest,
    });
    await waitForEvent(
      events,
      (event) =>
        typeof event === "object" &&
        event !== null &&
        (event as { type?: unknown; requestId?: unknown }).type === "approval_required" &&
        (event as { requestId?: unknown }).requestId === "41",
    );

    await adapter.replyApproval({
      externalSessionId: "thread/start-runtime-ensure",
      requestId: "41",
      outcome: "approve_once",
    });
    streamListeners[0]?.({
      runtimeId: "runtime-ensure",
      kind: "server_request",
      message: toolRequest,
    });
    await Promise.resolve();
    await dynamicToolRejected.promise;

    expect(respondServerRequest).toHaveBeenCalledWith(
      "runtime-ensure",
      41,
      expect.objectContaining({ approved: true, outcome: "approve_once" }),
      undefined,
    );
    expect(respondServerRequest).toHaveBeenCalledWith(
      "runtime-ensure",
      42,
      expect.objectContaining({
        success: false,
        contentItems: [
          expect.objectContaining({
            type: "inputText",
            text: expect.stringContaining("openducktor MCP server"),
          }),
        ],
      }),
      undefined,
    );
    unsubscribe();
  });

  test("auto-rejects mutating Codex requests for read-only roles", async () => {
    const dynamicToolRejected = createDeferred<void>();
    const respondServerRequest = mock(async (_runtimeId: string, requestId: number) => {
      if (requestId === 24) {
        dynamicToolRejected.resolve();
      }
    });
    const streamListeners: Array<
      (event: { runtimeId: string; kind: "server_request"; message: unknown }) => void
    > = [];
    const subscribeEvents = mock((_runtimeId: string, listener) => {
      streamListeners.push(listener);
      return () => {};
    });
    const drainServerRequests = mock(async () => [] as unknown[]);
    const { adapter } = createHarness({
      respondServerRequest,
      drainServerRequests,
      subscribeEvents,
    });

    await adapter.startSession({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      taskId: "task-1",
      role: "qa",
      systemPrompt: "Review only.",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });
    const events: unknown[] = [];
    const unsubscribe = adapter.subscribeEvents(
      codexSessionRuntimeRef("thread/start-runtime-ensure"),
      (event) => events.push(event),
    );
    const execRequest = {
      id: 23,
      method: "command/exec",
      params: { threadId: "thread/start-runtime-ensure", command: "rm -rf tmp" },
    };
    const toolRequest = {
      id: 24,
      method: "item/tool/call",
      params: {
        threadId: "thread/start-runtime-ensure",
        turnId: "turn-5",
        callId: "call-5",
        tool: "odt_read_task",
        arguments: { taskId: "task-1" },
      },
    };

    streamListeners[0]?.({
      runtimeId: "runtime-ensure",
      kind: "server_request",
      message: execRequest,
    });
    streamListeners[0]?.({
      runtimeId: "runtime-ensure",
      kind: "server_request",
      message: toolRequest,
    });

    await dynamicToolRejected.promise;

    expect(respondServerRequest).toHaveBeenCalledWith(
      "runtime-ensure",
      23,
      expect.objectContaining({ approved: false, outcome: "reject" }),
      undefined,
    );
    expect(respondServerRequest).toHaveBeenCalledWith(
      "runtime-ensure",
      24,
      expect.objectContaining({
        success: false,
        contentItems: [
          expect.objectContaining({
            type: "inputText",
            text: expect.stringContaining("openducktor MCP server"),
          }),
        ],
      }),
      undefined,
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "session_error",
        message: expect.stringContaining("Rejected mutating Codex request"),
      }),
    );
    expect(drainServerRequests).not.toHaveBeenCalled();
    unsubscribe();
  });
});
