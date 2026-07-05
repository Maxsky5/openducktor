import { describe, expect, mock, test } from "bun:test";
import { CODEX_APP_SERVER_SERVER_REQUEST_METHOD } from "@openducktor/contracts";
import {
  codexSessionRef,
  codexSessionRuntimeRef,
  codexStartSessionInput,
  codexUserMessageInput,
  createDeferred,
  createHarness,
  flushCodexAdapterWork,
  waitForEvent,
} from "./codex-app-server-adapter.test-harness";
import { codexServerRequestKey } from "./codex-app-server-approvals";

const CURL_NETWORK_COMMAND =
  "curl -I --max-time 5 https://example.com; curl -I --max-time 5 https://1.1.1.1";

const bufferedServerRequest = (message: unknown) => ({
  runtimeId: "runtime-live",
  kind: "server_request" as const,
  message,
});

describe("CodexAppServerAdapter approvals", () => {
  test("emits a session error for streamed server requests missing a thread identifier", async () => {
    const streamListeners: Array<
      (event: { runtimeId: string; kind: "server_request"; message: unknown }) => void
    > = [];
    const subscribeEvents = mock((_runtimeId: string, listener) => {
      streamListeners.push(listener);
      return () => {};
    });
    const { adapter } = createHarness({ subscribeEvents });

    await adapter.startSession(codexStartSessionInput());

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
        (event as { message: string }).message.includes("missing a thread identifier"),
    );
    unsubscribe();
  });

  test("surfaces legacy exec command approvals routed by conversationId", async () => {
    const streamListeners: Array<
      (event: { runtimeId: string; kind: "server_request"; message: unknown }) => void
    > = [];
    const subscribeEvents = mock((_runtimeId: string, listener) => {
      streamListeners.push(listener);
      return () => {};
    });
    const { adapter, respondServerRequest } = createHarness({ subscribeEvents });

    await adapter.startSession(codexStartSessionInput());

    const events: unknown[] = [];
    const unsubscribe = await adapter.subscribeEvents(
      codexSessionRuntimeRef("thread/start-runtime-live"),
      (event) => events.push(event),
    );

    streamListeners[0]?.({
      runtimeId: "runtime-live",
      kind: "server_request",
      message: {
        id: "legacy-exec-approval-1",
        method: CODEX_APP_SERVER_SERVER_REQUEST_METHOD.EXEC_COMMAND_APPROVAL,
        params: {
          conversationId: "thread/start-runtime-live",
          callId: "call-1",
          approvalId: null,
          command: ["curl", "-I", "https://example.com"],
          cwd: "/repo",
          reason: "Need network access.",
          parsedCmd: [],
        },
      },
    });

    const approval = await waitForEvent(
      events,
      (event) =>
        typeof event === "object" &&
        event !== null &&
        (event as { type?: unknown; requestId?: unknown }).type === "approval_required" &&
        (event as { requestId?: unknown }).requestId === "legacy-exec-approval-1",
    );
    expect(approval).toMatchObject({
      requestId: "legacy-exec-approval-1",
      requestType: "command_execution",
      title: "Bash approval requested",
      summary: "Need network access.",
      mutation: "unknown",
      action: { name: "Bash" },
      command: { command: "curl -I https://example.com", workingDirectory: "/repo" },
    });
    expect(approval).not.toHaveProperty("details");
    expect(respondServerRequest).not.toHaveBeenCalled();
    unsubscribe();
  });

  test("surfaces streamed network command approvals from structured command actions", async () => {
    const streamListeners: Array<
      (event: { runtimeId: string; kind: "server_request"; message: unknown }) => void
    > = [];
    const subscribeEvents = mock((_runtimeId: string, listener) => {
      streamListeners.push(listener);
      return () => {};
    });
    const takeBufferedEvents = mock(async () => [] as unknown[]);
    const { adapter, respondServerRequest } = createHarness({
      takeBufferedEvents,
      subscribeEvents,
    });

    await adapter.startSession(codexStartSessionInput());

    const events: unknown[] = [];
    const unsubscribe = await adapter.subscribeEvents(
      codexSessionRuntimeRef("thread/start-runtime-live"),
      (event) => events.push(event),
    );

    streamListeners[0]?.({
      runtimeId: "runtime-live",
      kind: "server_request",
      message: {
        id: "network-approval-1",
        method: CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_COMMAND_EXECUTION_REQUEST_APPROVAL,
        params: {
          threadId: "thread/start-runtime-live",
          turnId: "turn-1",
          itemId: "call-1",
          startedAtMs: 1,
          reason:
            "Do you want to allow a shell `curl` check so I can verify terminal network access directly?",
          command: `/bin/zsh -lc '${CURL_NETWORK_COMMAND}'`,
          cwd: "/repo",
          commandActions: [
            {
              type: "unknown",
              command: CURL_NETWORK_COMMAND,
            },
          ],
          networkApprovalContext: {
            host: "example.com",
            protocol: "https",
          },
        },
      },
    });

    const approval = await waitForEvent(
      events,
      (event) =>
        typeof event === "object" &&
        event !== null &&
        (event as { type?: unknown; requestId?: unknown }).type === "approval_required" &&
        (event as { requestId?: unknown }).requestId === "network-approval-1",
    );
    expect(approval).toMatchObject({
      requestId: "network-approval-1",
      requestType: "command_execution",
      title: "Network access approval requested",
      summary:
        "Do you want to allow a shell `curl` check so I can verify terminal network access directly?",
      mutation: "unknown",
      action: { name: "Network access" },
      command: {
        command: CURL_NETWORK_COMMAND,
        workingDirectory: "/repo",
      },
    });
    expect(approval).not.toHaveProperty("details");
    expect(takeBufferedEvents).not.toHaveBeenCalled();
    expect(respondServerRequest).not.toHaveBeenCalled();
    unsubscribe();
  });

  test("requires a server request to create command approvals", async () => {
    const streamListeners: Array<
      (event: {
        runtimeId: string;
        kind: "notification" | "server_request";
        message: unknown;
      }) => void
    > = [];
    const subscribeEvents = mock((_runtimeId: string, listener) => {
      streamListeners.push(listener);
      return () => {};
    });
    const takeBufferedEvents = mock(async () => [] as unknown[]);
    const { adapter } = createHarness(
      {
        takeBufferedEvents,
        subscribeEvents,
      },
      { deferTurnStart: true },
    );

    await adapter.startSession(codexStartSessionInput());

    const events: unknown[] = [];
    const unsubscribe = await adapter.subscribeEvents(
      codexSessionRuntimeRef("thread/start-runtime-live"),
      (event) => events.push(event),
    );

    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: "thread/start-runtime-live",
        parts: [{ kind: "text", text: "Check network with curl" }],
      }),
    );
    await flushCodexAdapterWork();

    streamListeners[0]?.({
      runtimeId: "runtime-live",
      kind: "notification",
      message: {
        method: "thread/status/changed",
        params: {
          threadId: "thread/start-runtime-live",
          status: {
            type: "active",
            activeFlags: ["waitingOnApproval"],
          },
        },
      },
    });

    await flushCodexAdapterWork();

    expect(events.some((event) => (event as { type?: unknown }).type === "approval_required")).toBe(
      false,
    );
    expect(takeBufferedEvents).not.toHaveBeenCalled();
    unsubscribe();
  });

  test("surfaces live command approvals before turn start settles", async () => {
    const streamListeners: Array<
      (event: { runtimeId: string; kind: "server_request"; message: unknown }) => void
    > = [];
    const subscribeEvents = mock((_runtimeId: string, listener) => {
      streamListeners.push(listener);
      return () => {};
    });
    const takeBufferedEvents = mock(async () => [] as unknown[]);
    const { adapter, transports, respondServerRequest } = createHarness(
      {
        takeBufferedEvents,
        subscribeEvents,
      },
      { deferTurnStart: true },
    );

    await adapter.startSession(codexStartSessionInput());

    const events: unknown[] = [];
    const unsubscribe = await adapter.subscribeEvents(
      codexSessionRuntimeRef("thread/start-runtime-live"),
      (event) => events.push(event),
    );

    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: "thread/start-runtime-live",
        parts: [{ kind: "text", text: "Check network with curl" }],
      }),
    );

    streamListeners[0]?.({
      runtimeId: "runtime-live",
      kind: "server_request",
      message: {
        id: "network-approval-live",
        method: CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_COMMAND_EXECUTION_REQUEST_APPROVAL,
        params: {
          threadId: "thread/start-runtime-live",
          turnId: "turn-1",
          itemId: "call-1",
          startedAtMs: 1,
          reason: "Allow terminal network access?",
          networkApprovalContext: {
            host: "example.com",
            protocol: "https",
          },
        },
      },
    });

    const approval = await waitForEvent(
      events,
      (event) =>
        typeof event === "object" &&
        event !== null &&
        (event as { type?: unknown; requestId?: unknown }).type === "approval_required" &&
        (event as { requestId?: unknown }).requestId === "network-approval-live",
    );

    expect(approval).toMatchObject({
      requestId: "network-approval-live",
      requestType: "command_execution",
      title: "Network access approval requested",
    });
    expect(takeBufferedEvents).not.toHaveBeenCalled();
    expect(respondServerRequest).not.toHaveBeenCalled();
    transports.get("runtime-live")?.turnStartDeferred.resolve({});
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
    const takeBufferedEvents = mock(async () => [] as unknown[]);
    const { adapter, respondServerRequest } = createHarness({
      takeBufferedEvents,
      subscribeEvents,
    });

    await adapter.startSession(
      codexStartSessionInput({
        sessionScope: { kind: "workflow", taskId: "task-1", role: "spec" },
      }),
    );

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
    expect(takeBufferedEvents).not.toHaveBeenCalled();
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "session_error",
        message: expect.stringContaining("must use MCP"),
      }),
    );
    unsubscribe();
  });

  test("surfaces unknown Codex server methods as approval requests", async () => {
    const { adapter, transports, takeBufferedEvents, respondServerRequest } = createHarness(
      {},
      { deferTurnStart: true },
    );

    await adapter.startSession(codexStartSessionInput());

    const transport = transports.get("runtime-live");
    takeBufferedEvents.mockImplementationOnce(async () => [
      bufferedServerRequest({
        id: 19,
        method: "item/unknown",
        params: {
          threadId: "thread/start-runtime-live",
          turnId: "turn-3",
          callId: "call-3",
          tool: "odt_read_task",
          arguments: { taskId: "task-1" },
        },
      }),
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
      ...codexSessionRuntimeRef("thread/start-runtime-live"),
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

  test("surfaces and resolves Codex permission approvals with string request ids", async () => {
    const requestResolved = createDeferred<void>();
    const respondServerRequest = mock(async (_runtimeId: string, requestId: string | number) => {
      if (requestId === "permission-request-1") {
        requestResolved.resolve();
      }
    });
    const streamListeners: Array<
      (event: { runtimeId: string; kind: "server_request"; message: unknown }) => void
    > = [];
    const subscribeEvents = mock((_runtimeId: string, listener) => {
      streamListeners.push(listener);
      return () => {};
    });
    const { adapter } = createHarness({ respondServerRequest, subscribeEvents });

    await adapter.startSession(codexStartSessionInput());
    const events: unknown[] = [];
    const unsubscribe = await adapter.subscribeEvents(
      codexSessionRuntimeRef("thread/start-runtime-live"),
      (event) => events.push(event),
    );

    streamListeners[0]?.({
      runtimeId: "runtime-live",
      kind: "server_request",
      message: {
        id: "permission-request-1",
        method: CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_PERMISSIONS_REQUEST_APPROVAL,
        params: {
          threadId: "thread/start-runtime-live",
          turnId: "turn-permission",
          itemId: "permission-item-1",
          startedAtMs: 1,
          cwd: "/repo",
          reason: "Need one-time network access.",
          permissions: {
            network: { enabled: true },
            fileSystem: null,
          },
        },
      },
    });

    const approval = await waitForEvent(
      events,
      (event) =>
        typeof event === "object" &&
        event !== null &&
        (event as { type?: unknown; requestId?: unknown }).type === "approval_required" &&
        (event as { requestId?: unknown }).requestId === "permission-request-1",
    );
    expect(approval).toMatchObject({
      requestId: "permission-request-1",
      requestType: "permission_grant",
      title: "Permission approval requested",
      summary: "Need one-time network access.",
      mutation: "unknown",
    });
    expect(approval).not.toHaveProperty("details");

    await adapter.replyApproval({
      ...codexSessionRuntimeRef("thread/start-runtime-live"),
      externalSessionId: "thread/start-runtime-live",
      requestId: "permission-request-1",
      outcome: "approve_once",
    });

    await requestResolved.promise;
    expect(respondServerRequest).toHaveBeenCalledWith(
      "runtime-live",
      "permission-request-1",
      { permissions: { network: { enabled: true } }, scope: "turn" },
      undefined,
    );
    unsubscribe();
  });

  test("rejects approval replies routed through another session", async () => {
    const { adapter, takeBufferedEvents, respondServerRequest } = createHarness(
      {},
      { deferTurnStart: true },
    );

    await adapter.startSession(codexStartSessionInput());

    takeBufferedEvents.mockImplementationOnce(async () => [
      bufferedServerRequest({
        id: 33,
        method: "approval/request",
        params: {
          threadId: "thread/start-runtime-live",
          turnId: "turn-approval-owner",
          tool: "network",
          url: "https://example.com",
        },
      }),
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

  test("preserves numeric string server request ids when replying to approvals", async () => {
    const { adapter, takeBufferedEvents, respondServerRequest } = createHarness(
      {},
      { deferTurnStart: true },
    );
    takeBufferedEvents.mockImplementationOnce(async () => [
      bufferedServerRequest({
        id: "53",
        method: "approval/request",
        params: {
          threadId: "thread/start-runtime-live",
          turnId: "turn-approval-string-id",
          tool: "network",
          url: "https://example.com",
        },
      }),
    ]);

    await adapter.startSession(codexStartSessionInput());
    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: "thread/start-runtime-live",
        parts: [{ kind: "text", text: "Need approval" }],
      }),
    );

    await adapter.replyApproval({
      ...codexSessionRuntimeRef("thread/start-runtime-live"),
      externalSessionId: "thread/start-runtime-live",
      requestId: codexServerRequestKey("53"),
      outcome: "reject",
    });

    expect(respondServerRequest.mock.calls[0]?.[1]).toBe("53");
  });

  test("preserves initial-turn approvals for late listeners and runtime snapshots", async () => {
    const { adapter, takeBufferedEvents } = createHarness({}, { deferTurnStart: true });
    takeBufferedEvents.mockImplementationOnce(async () => [
      bufferedServerRequest({
        id: 31,
        method: "approval/request",
        params: {
          threadId: "thread/start-runtime-live",
          turnId: "turn-approval-initial",
          tool: "network",
          url: "https://example.com",
        },
      }),
    ]);

    await adapter.startSession(codexStartSessionInput());
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
    const { adapter, takeBufferedEvents, respondServerRequest } = createHarness(
      {},
      { deferTurnStart: true },
    );
    const events: unknown[] = [];
    takeBufferedEvents.mockImplementationOnce(async () => [
      bufferedServerRequest({
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
      }),
    ]);

    await adapter.startSession(codexStartSessionInput());
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
        input: expect.objectContaining({
          requestId: "32",
          questions: [
            expect.objectContaining({ header: "Mode", question: "Pick a mode", custom: true }),
          ],
        }),
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
      ...codexSessionRuntimeRef("thread/start-runtime-live"),
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

  test("preserves numeric string server request ids when replying to questions", async () => {
    const { adapter, takeBufferedEvents, respondServerRequest } = createHarness(
      {},
      { deferTurnStart: true },
    );
    takeBufferedEvents.mockImplementationOnce(async () => [
      bufferedServerRequest({
        id: "54",
        method: "item/tool/requestUserInput",
        params: {
          threadId: "thread/start-runtime-live",
          turnId: "turn-question-string-id",
          itemId: "item-1",
          questions: [
            {
              id: "question-1",
              header: "Mode",
              question: "Pick a mode",
              options: ["Safe"],
            },
          ],
        },
      }),
    ]);

    await adapter.startSession(codexStartSessionInput());
    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: "thread/start-runtime-live",
        parts: [{ kind: "text", text: "Start now" }],
      }),
    );

    await adapter.replyQuestion({
      ...codexSessionRuntimeRef("thread/start-runtime-live"),
      externalSessionId: "thread/start-runtime-live",
      requestId: codexServerRequestKey("54"),
      answers: [["Safe"]],
    });

    expect(respondServerRequest.mock.calls[0]?.[1]).toBe("54");
  });

  test("resolves Codex MCP tool approvals with session persistence metadata", async () => {
    const { adapter, takeBufferedEvents, respondServerRequest } = createHarness(
      {},
      { deferTurnStart: true },
    );
    takeBufferedEvents.mockImplementationOnce(async () => [
      bufferedServerRequest({
        id: 37,
        method: CODEX_APP_SERVER_SERVER_REQUEST_METHOD.MCP_SERVER_ELICITATION_REQUEST,
        params: {
          threadId: "thread/start-runtime-live",
          turnId: "turn-mcp-approval",
          serverName: "semble",
          mode: "form",
          message: 'Allow the semble MCP server to run tool "search"?',
          requestedSchema: { type: "object", properties: {} },
          _meta: {
            codex_approval_kind: "mcp_tool_call",
            tool_name: "search",
            persist: ["session", "always"],
          },
        },
      }),
    ]);

    await adapter.startSession(codexStartSessionInput());
    const events: unknown[] = [];
    await adapter.subscribeEvents(codexSessionRuntimeRef("thread/start-runtime-live"), (event) =>
      events.push(event),
    );
    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: "thread/start-runtime-live",
        parts: [{ kind: "text", text: "Search the repo" }],
      }),
    );

    await expect(
      waitForEvent(
        events,
        (event) =>
          typeof event === "object" &&
          event !== null &&
          (event as { type?: unknown; requestId?: unknown }).type === "approval_required" &&
          (event as { requestId?: unknown }).requestId === "37",
      ),
    ).resolves.toMatchObject({
      requestType: "runtime_tool",
      supportedReplyOutcomes: ["approve_once", "approve_session", "approve_always", "reject"],
    });

    await adapter.replyApproval({
      ...codexSessionRuntimeRef("thread/start-runtime-live"),
      externalSessionId: "thread/start-runtime-live",
      requestId: "37",
      outcome: "approve_session",
    });

    expect(respondServerRequest).toHaveBeenCalledWith(
      "runtime-live",
      37,
      { action: "accept", content: null, _meta: { persist: "session" } },
      undefined,
    );
  });

  test("clears pending Codex input state when local stop cleanup runs", async () => {
    const { adapter, takeBufferedEvents } = createHarness({}, { deferTurnStart: true });
    takeBufferedEvents.mockImplementationOnce(async () => [
      bufferedServerRequest({
        id: 36,
        method: "item/tool/requestUserInput",
        params: {
          threadId: "thread/start-runtime-live",
          turnId: "turn-question",
          itemId: "item-1",
          questions: [{ id: "question-1", header: "Confirm", question: "Continue?" }],
        },
      }),
    ]);

    await adapter.startSession(codexStartSessionInput());
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
    const { adapter, takeBufferedEvents, transports } = createHarness({}, { deferTurnStart: true });
    takeBufferedEvents.mockImplementationOnce(async () => [
      bufferedServerRequest({
        id: 33,
        method: "item/tool/requestUserInput",
        params: {
          threadId: "thread/start-runtime-live",
          turnId: "turn-active",
          itemId: "item-1",
          questions: [{ id: "question-1", header: "Confirm", question: "Continue?" }],
        },
      }),
    ]);

    await adapter.startSession(codexStartSessionInput());
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
        ...codexSessionRuntimeRef("thread/start-runtime-live"),
        externalSessionId: "thread/start-runtime-live",
        requestId: " ",
        outcome: "approve_once",
      }),
    ).rejects.toThrow("Codex approval request id must not be empty.");

    expect(respondServerRequest).toHaveBeenCalledTimes(0);
  });

  test("rejects malformed question request ids before replying to the Codex server", async () => {
    const { adapter, respondServerRequest } = createHarness();

    await expect(
      adapter.replyQuestion({
        ...codexSessionRuntimeRef("thread/start-runtime-live"),
        externalSessionId: "thread/start-runtime-live",
        requestId: " ",
        answers: [["yes"]],
      }),
    ).rejects.toThrow("Codex question request id must not be empty.");

    expect(respondServerRequest).toHaveBeenCalledTimes(0);
  });

  test("continues a paused turn from streamed requests after approval replies", async () => {
    const dynamicToolRejected = createDeferred<void>();
    const respondServerRequest = mock(async (_runtimeId: string, requestId: string | number) => {
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
    const takeBufferedEvents = mock(async () => [] as unknown[]);
    const { adapter } = createHarness({
      respondServerRequest,
      takeBufferedEvents,
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

    await adapter.startSession(codexStartSessionInput());
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
      ...codexSessionRuntimeRef("thread/start-runtime-live"),
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

  test("surfaces mutating Codex approvals for read-only roles while rejecting dynamic tools", async () => {
    const dynamicToolRejected = createDeferred<void>();
    const respondServerRequest = mock(async (_runtimeId: string, requestId: string | number) => {
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
    const takeBufferedEvents = mock(async () => [] as unknown[]);
    const { adapter } = createHarness({
      respondServerRequest,
      takeBufferedEvents,
      subscribeEvents,
    });

    await adapter.startSession(
      codexStartSessionInput({
        sessionScope: { kind: "workflow", taskId: "task-1", role: "qa" },
        systemPrompt: "Review only.",
      }),
    );
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

    expect(respondServerRequest.mock.calls.some(([, requestId]) => requestId === 23)).toBe(false);
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
        type: "approval_required",
        requestId: "23",
        requestType: "file_change",
        mutation: "mutating",
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "session_error",
        message: expect.stringContaining("must use MCP"),
      }),
    );
    expect(takeBufferedEvents).not.toHaveBeenCalled();
    unsubscribe();
  });
});
