import { describe, expect, mock, test } from "bun:test";
import { CODEX_APP_SERVER_SERVER_REQUEST_METHOD } from "@openducktor/contracts";
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
    const unsubscribe = await adapter.subscribeEvents(
      codexSessionRuntimeRef("thread/start-runtime-live"),
      (event) => events.push(event),
    );

    streamListeners[0]?.({
      runtimeId: "runtime-live",
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
        threadId: "thread/start-runtime-live",
        turnId: "turn-1",
        callId: "call-1",
        tool: "odt_set_spec",
        arguments: { taskId: "task-1", markdown: "# Spec" },
      },
    };
    const events: unknown[] = [];
    const unsubscribe = await adapter.subscribeEvents(
      codexSessionRuntimeRef("thread/start-runtime-live"),
      (event) => events.push(event),
    );
    streamListeners[0]?.({ runtimeId: "runtime-live", kind: "server_request", message: request });
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
      "runtime-live",
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

    const transport = transports.get("runtime-live");
    drainServerRequests.mockImplementationOnce(async () => [
      {
        id: 19,
        method: "item/unknown",
        params: {
          threadId: "thread/start-runtime-live",
          turnId: "turn-3",
          callId: "call-3",
          tool: "odt_read_task",
          arguments: { taskId: "task-1" },
        },
      },
    ]);
    const events: unknown[] = [];
    await adapter.subscribeEvents(codexSessionRuntimeRef("thread/start-runtime-live"), (event) =>
      events.push(event),
    );

    await expect(
      adapter.sendUserMessage(
        codexUserMessageInput({
          externalSessionId: "thread/start-runtime-live",
          parts: [{ kind: "text", text: "Read the task" }],
          model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
        }),
      ),
    ).resolves.toMatchObject({
      type: "user_message",
      externalSessionId: "thread/start-runtime-live",
      message: "Read the task",
    });

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
      externalSessionId: "thread/start-runtime-live",
      requestId: "19",
      outcome: "reject",
    });
    expect(respondServerRequest).toHaveBeenCalledWith(
      "runtime-live",
      19,
      expect.objectContaining({ approved: false, outcome: "reject" }),
      undefined,
    );
    transport?.turnStartDeferred.resolve({});
  });

  test("rejects approval replies routed through another session", async () => {
    const { adapter, drainServerRequests, respondServerRequest } = createHarness(
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

    drainServerRequests.mockImplementationOnce(async () => [
      {
        id: 33,
        method: "approval/request",
        params: {
          threadId: "thread/start-runtime-live",
          turnId: "turn-approval-owner",
          tool: "network",
          url: "https://example.com",
        },
      },
    ]);

    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: "thread/start-runtime-live",
        parts: [{ kind: "text", text: "Need approval" }],
      }),
    );
    const unsubscribe = await adapter.subscribeEvents(
      codexSessionRuntimeRef("thread-saved"),
      () => {},
    );

    await expect(
      adapter.replyApproval({
        ...codexSessionRuntimeRef("thread-saved"),
        requestId: "33",
        outcome: "reject",
      }),
    ).rejects.toThrow(
      "Codex approval request '33' belongs to session 'thread/start-runtime-live', not 'thread-saved'.",
    );
    expect(respondServerRequest).not.toHaveBeenCalled();
    unsubscribe();
  });

  test("preserves initial-turn approvals for late listeners and runtime snapshots", async () => {
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
        externalSessionId: "thread/start-runtime-live",
        parts: [{ kind: "text", text: "Start now" }],
      }),
    );

    await expect(
      adapter.readSessionRuntimeSnapshot({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread/start-runtime-live",
      }),
    ).resolves.toMatchObject({
      availability: "runtime",
      classification: "waiting_for_permission",
      pendingApprovals: [expect.objectContaining({ requestId: "31" })],
    });

    const replayedEvents: unknown[] = [];
    await adapter.subscribeEvents(codexSessionRuntimeRef("thread/start-runtime-live"), (event) =>
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
          threadId: "thread/start-runtime-live",
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
    await adapter.subscribeEvents(codexSessionRuntimeRef("thread/start-runtime-live"), (event) =>
      events.push(event),
    );
    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: "thread/start-runtime-live",
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
      adapter.readSessionRuntimeSnapshot({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread/start-runtime-live",
      }),
    ).resolves.toMatchObject({
      availability: "runtime",
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
      externalSessionId: "thread/start-runtime-live",
      requestId: "32",
      answers: [["Safe"]],
    });

    expect(respondServerRequest).toHaveBeenCalledWith(
      "runtime-live",
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
          threadId: "thread/start-runtime-live",
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
        externalSessionId: "thread/start-runtime-live",
        parts: [{ kind: "text", text: "Start now" }],
      }),
    );

    await expect(
      adapter.readSessionRuntimeSnapshot({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread/start-runtime-live",
      }),
    ).resolves.toMatchObject({
      classification: "waiting_for_question",
      pendingQuestions: [expect.objectContaining({ requestId: "36" })],
    });

    await adapter.stopSession(codexSessionRef("thread/start-runtime-live"));

    await expect(
      adapter.replyQuestion({
        ...codexSessionRuntimeRef("thread/start-runtime-live"),
        externalSessionId: "thread/start-runtime-live",
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
          threadId: "thread/start-runtime-live",
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
        externalSessionId: "thread/start-runtime-live",
        parts: [{ kind: "text", text: "Start now" }],
      }),
    );

    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: "thread/start-runtime-live",
        parts: [{ kind: "text", text: "Also inspect failing tests" }],
      }),
    );

    expect(transports.get("runtime-live")?.calls).toContainEqual({
      method: "turn/steer",
      params: {
        threadId: "thread/start-runtime-live",
        input: [{ type: "text", text: "Also inspect failing tests" }],
        expectedTurnId: "turn-active",
      },
    });
  });

  test("rejects malformed approval request ids before replying to the Codex server", async () => {
    const { adapter, respondServerRequest } = createHarness();

    await expect(
      adapter.replyApproval({
        externalSessionId: "thread/start-runtime-live",
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
        externalSessionId: "thread/start-runtime-live",
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
        threadId: "thread/start-runtime-live",
        tool: "network",
        url: "https://example.com",
      },
    };
    const toolRequest = {
      id: 42,
      method: "item/tool/call",
      params: {
        threadId: "thread/start-runtime-live",
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
        externalSessionId: "thread/start-runtime-live",
        parts: [{ kind: "text", text: "Start now" }],
      }),
    );
    const events: unknown[] = [];
    const unsubscribe = await adapter.subscribeEvents(
      codexSessionRuntimeRef("thread/start-runtime-live"),
      (event) => events.push(event),
    );
    streamListeners[0]?.({
      runtimeId: "runtime-live",
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
      externalSessionId: "thread/start-runtime-live",
      requestId: "41",
      outcome: "approve_once",
    });
    streamListeners[0]?.({
      runtimeId: "runtime-live",
      kind: "server_request",
      message: toolRequest,
    });
    await Promise.resolve();
    await dynamicToolRejected.promise;

    expect(respondServerRequest).toHaveBeenCalledWith(
      "runtime-live",
      41,
      expect.objectContaining({ approved: true, outcome: "approve_once" }),
      undefined,
    );
    expect(respondServerRequest).toHaveBeenCalledWith(
      "runtime-live",
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
    const unsubscribe = await adapter.subscribeEvents(
      codexSessionRuntimeRef("thread/start-runtime-live"),
      (event) => events.push(event),
    );
    const fileChangeRequest = {
      id: 23,
      method: CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_FILE_CHANGE_REQUEST_APPROVAL,
      params: { threadId: "thread/start-runtime-live", path: "src/main.ts" },
    };
    const toolRequest = {
      id: 24,
      method: "item/tool/call",
      params: {
        threadId: "thread/start-runtime-live",
        turnId: "turn-5",
        callId: "call-5",
        tool: "odt_read_task",
        arguments: { taskId: "task-1" },
      },
    };

    streamListeners[0]?.({
      runtimeId: "runtime-live",
      kind: "server_request",
      message: fileChangeRequest,
    });
    streamListeners[0]?.({
      runtimeId: "runtime-live",
      kind: "server_request",
      message: toolRequest,
    });

    await dynamicToolRejected.promise;

    expect(respondServerRequest).toHaveBeenCalledWith(
      "runtime-live",
      23,
      { decision: "decline" },
      undefined,
    );
    expect(respondServerRequest).toHaveBeenCalledWith(
      "runtime-live",
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
