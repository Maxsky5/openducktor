import { describe, expect, mock, test } from "bun:test";
import {
  agentSessionLiveSnapshotSchema,
  CODEX_APP_SERVER_SERVER_REQUEST_METHOD,
} from "@openducktor/contracts";
import {
  codexSessionRef,
  codexSessionRuntimeRef,
  codexStartSessionInput,
  codexUserMessageInput,
  createAdapterWithTransport,
  createDeferred,
  createHarness,
  RecordingTransport,
  waitForEvent,
} from "./codex-app-server-adapter.test-harness";
import type { CodexJsonRpcRequest } from "./index";

const runtimeEventReceivedAt = "2026-07-06T12:00:00.000Z";

type RuntimeEventInput = {
  runtimeId: string;
  kind: "notification" | "server_request";
  message: unknown;
};

type RuntimeListener = (event: RuntimeEventInput) => void;

const withRuntimeReceivedAt = (event: RuntimeEventInput) => ({
  ...event,
  receivedAt: runtimeEventReceivedAt,
});

type ApprovalRequiredEvent = {
  type: "approval_required";
  requestId: string;
  requestType: string;
};

const isApprovalRequiredEvent = (event: unknown): event is ApprovalRequiredEvent =>
  typeof event === "object" &&
  event !== null &&
  (event as { type?: unknown }).type === "approval_required" &&
  typeof (event as { requestId?: unknown }).requestId === "string";

class ReloadedParentWithChildTransport extends RecordingTransport {
  async request<Response>(request: CodexJsonRpcRequest): Promise<Response> {
    if (request.method === "thread/loaded/list") {
      this.calls.push(request);
      return { data: ["parent-thread", "child-thread"], nextCursor: null } as Response;
    }
    if (request.method === "thread/list") {
      this.calls.push(request);
      const sourceKinds = (request.params as { sourceKinds?: unknown }).sourceKinds;
      const includesSubagents = Array.isArray(sourceKinds) && sourceKinds.includes("subAgent");
      return {
        data: [
          {
            id: "parent-thread",
            cwd: "/repo",
            createdAt: 1,
            preview: "Parent",
            status: { type: "active", activeFlags: [] },
          },
          ...(includesSubagents
            ? [
                {
                  id: "child-thread",
                  cwd: "/repo",
                  createdAt: 2,
                  preview: "Child",
                  status: { type: "active", activeFlags: ["waitingOnApproval"] },
                  parentThreadId: "parent-thread",
                  source: {
                    subAgent: {
                      thread_spawn: {
                        parent_thread_id: "parent-thread",
                        depth: 1,
                        agent_path: "/root/explorer",
                        agent_nickname: "Explorer",
                        agent_role: "explorer",
                      },
                    },
                  },
                },
              ]
            : []),
        ],
        nextCursor: null,
      } as Response;
    }
    return super.request<Response>(request);
  }
}

describe("CodexAppServerAdapter approvals", () => {
  test("routes a child approval after reload discovers the subagent thread", async () => {
    const streamListeners: RuntimeListener[] = [];
    const subscribeEvents = mock((_runtimeId: string, listener) => {
      streamListeners.push((event) => listener(withRuntimeReceivedAt(event)));
      return () => {};
    });
    const respondServerRequest = mock(async () => {});
    const transport = new ReloadedParentWithChildTransport("runtime-live", false);
    const adapter = createAdapterWithTransport(transport, {
      subscribeEvents,
      respondServerRequest,
    });

    const events: unknown[] = [];
    await adapter.subscribeEvents(codexSessionRuntimeRef("parent-thread"), (event) =>
      events.push(event),
    );

    streamListeners[0]?.({
      runtimeId: "runtime-live",
      kind: "server_request",
      message: {
        id: 0,
        method: CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_COMMAND_EXECUTION_REQUEST_APPROVAL,
        params: {
          threadId: "child-thread",
          turnId: "child-turn",
          itemId: "child-command",
          startedAtMs: 1,
          command: "pwd",
          cwd: "/repo",
          commandActions: [{ type: "unknown", command: "pwd" }],
        },
      },
    });

    const approval = await waitForEvent(events, isApprovalRequiredEvent);
    expect(approval).toMatchObject({
      externalSessionId: "parent-thread",
      childExternalSessionId: "child-thread",
      parentExternalSessionId: "parent-thread",
    });
    expect(approval.requestId).not.toBe("0");

    await adapter.replyLiveApproval({
      runtimeId: "runtime-live",
      externalSessionId: "parent-thread",
      requestId: approval.requestId,
      outcome: "approve_once",
    });

    expect(respondServerRequest).toHaveBeenCalledWith(
      "runtime-live",
      0,
      { decision: "accept" },
      undefined,
    );
  });

  test("emits a session error for streamed server requests missing a thread identifier", async () => {
    const streamListeners: RuntimeListener[] = [];
    const subscribeEvents = mock((_runtimeId: string, listener) => {
      streamListeners.push((event) => listener(withRuntimeReceivedAt(event)));
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
    const streamListeners: RuntimeListener[] = [];
    const subscribeEvents = mock((_runtimeId: string, listener) => {
      streamListeners.push((event) => listener(withRuntimeReceivedAt(event)));
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

    const approval = await waitForEvent(events, isApprovalRequiredEvent);
    expect(approval).toMatchObject({
      requestType: "command_execution",
      title: "Bash approval requested",
      summary: "Need network access.",
      mutation: "unknown",
      action: { name: "Bash" },
      command: { command: "curl -I https://example.com", workingDirectory: "/repo" },
    });
    expect(approval.requestId).not.toBe("legacy-exec-approval-1");
    expect(approval).not.toHaveProperty("details");
    expect(respondServerRequest).not.toHaveBeenCalled();
    unsubscribe();
  });

  test("surfaces and resolves Codex permission approvals with string request ids", async () => {
    const requestResolved = createDeferred<void>();
    const respondServerRequest = mock(async (_runtimeId: string, requestId: string | number) => {
      if (requestId === "permission-request-1") {
        requestResolved.resolve();
      }
    });
    const streamListeners: RuntimeListener[] = [];
    const subscribeEvents = mock((_runtimeId: string, listener) => {
      streamListeners.push((event) => listener(withRuntimeReceivedAt(event)));
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

    const approval = await waitForEvent(events, isApprovalRequiredEvent);
    expect(approval).toMatchObject({
      requestType: "permission_grant",
      title: "Permission approval requested",
      summary: "Need one-time network access.",
      mutation: "unknown",
    });
    expect(approval.requestId).not.toBe("permission-request-1");
    expect(approval).not.toHaveProperty("details");

    await adapter.replyApproval({
      ...codexSessionRuntimeRef("thread/start-runtime-live"),
      externalSessionId: "thread/start-runtime-live",
      requestId: approval.requestId,
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

  test("rejects a concurrent duplicate reply to one pending approval", async () => {
    const firstReplyStarted = createDeferred<void>();
    const allowFirstReply = createDeferred<void>();
    let responseCount = 0;
    const respondServerRequest = mock(async () => {
      responseCount += 1;
      if (responseCount === 1) {
        firstReplyStarted.resolve();
        await allowFirstReply.promise;
      }
    });
    const streamListeners: RuntimeListener[] = [];
    const subscribeEvents = mock((_runtimeId: string, listener) => {
      streamListeners.push((event) => listener(withRuntimeReceivedAt(event)));
      return () => undefined;
    });
    const { adapter } = createHarness({ respondServerRequest, subscribeEvents });
    await adapter.startSession(codexStartSessionInput());
    const events: unknown[] = [];
    await adapter.subscribeEvents(codexSessionRuntimeRef("thread/start-runtime-live"), (event) =>
      events.push(event),
    );
    streamListeners[0]?.({
      runtimeId: "runtime-live",
      kind: "server_request",
      message: {
        id: 72,
        method: "approval/request",
        params: {
          threadId: "thread/start-runtime-live",
          turnId: "turn-concurrent-approval",
          tool: "network",
        },
      },
    });
    const approval = await waitForEvent(events, isApprovalRequiredEvent);
    const reply = {
      runtimeId: "runtime-live",
      externalSessionId: "thread/start-runtime-live",
      requestId: approval.requestId,
      outcome: "approve_once" as const,
    };

    const firstReply = adapter.replyLiveApproval(reply);
    await firstReplyStarted.promise;
    try {
      await expect(adapter.replyLiveApproval(reply)).rejects.toThrow(
        `Codex approval request '${approval.requestId}' already has a reply in flight.`,
      );
      expect(respondServerRequest).toHaveBeenCalledTimes(1);
    } finally {
      allowFirstReply.resolve();
      await firstReply;
    }
  });

  test("rejects a concurrent duplicate reply to one pending question", async () => {
    const firstReplyStarted = createDeferred<void>();
    const allowFirstReply = createDeferred<void>();
    let responseCount = 0;
    const respondServerRequest = mock(async () => {
      responseCount += 1;
      if (responseCount === 1) {
        firstReplyStarted.resolve();
        await allowFirstReply.promise;
      }
    });
    const streamListeners: RuntimeListener[] = [];
    const subscribeEvents = mock((_runtimeId: string, listener) => {
      streamListeners.push((event) => listener(withRuntimeReceivedAt(event)));
      return () => undefined;
    });
    const { adapter } = createHarness({ respondServerRequest, subscribeEvents });
    await adapter.startSession(codexStartSessionInput());
    const events: unknown[] = [];
    await adapter.subscribeEvents(codexSessionRuntimeRef("thread/start-runtime-live"), (event) =>
      events.push(event),
    );
    streamListeners[0]?.({
      runtimeId: "runtime-live",
      kind: "server_request",
      message: {
        id: 73,
        method: CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_TOOL_REQUEST_USER_INPUT,
        params: {
          threadId: "thread/start-runtime-live",
          turnId: "turn-concurrent-question",
          itemId: "question-item",
          questions: [{ id: "question-1", header: "Confirm", question: "Continue?" }],
        },
      },
    });
    const question = await waitForEvent(
      events,
      (event) =>
        typeof event === "object" &&
        event !== null &&
        (event as { type?: unknown }).type === "question_required",
    );
    const requestId = (question as { requestId: string }).requestId;
    const reply = {
      runtimeId: "runtime-live",
      externalSessionId: "thread/start-runtime-live",
      requestId,
      answers: [["yes"]],
    };

    const firstReply = adapter.replyLiveQuestion(reply);
    await firstReplyStarted.promise;
    try {
      await expect(adapter.replyLiveQuestion(reply)).rejects.toThrow(
        `Codex question request '${requestId}' already has a reply in flight.`,
      );
      expect(respondServerRequest).toHaveBeenCalledTimes(1);
    } finally {
      allowFirstReply.resolve();
      await firstReply;
    }
  });

  test("keeps an approval retryable when the native reply fails", async () => {
    let responseCount = 0;
    const respondServerRequest = mock(async () => {
      responseCount += 1;
      if (responseCount === 1) {
        throw new Error("native approval reply failed");
      }
    });
    const streamListeners: RuntimeListener[] = [];
    const subscribeEvents = mock((_runtimeId: string, listener) => {
      streamListeners.push((event) => listener(withRuntimeReceivedAt(event)));
      return () => undefined;
    });
    const { adapter } = createHarness({ respondServerRequest, subscribeEvents });
    await adapter.startSession(codexStartSessionInput());
    const events: unknown[] = [];
    await adapter.subscribeEvents(codexSessionRuntimeRef("thread/start-runtime-live"), (event) =>
      events.push(event),
    );
    streamListeners[0]?.({
      runtimeId: "runtime-live",
      kind: "server_request",
      message: {
        id: 74,
        method: "approval/request",
        params: {
          threadId: "thread/start-runtime-live",
          turnId: "turn-retry-approval",
          tool: "network",
        },
      },
    });
    const approval = await waitForEvent(events, isApprovalRequiredEvent);
    const reply = {
      runtimeId: "runtime-live",
      externalSessionId: "thread/start-runtime-live",
      requestId: approval.requestId,
      outcome: "approve_once" as const,
    };

    await expect(adapter.replyLiveApproval(reply)).rejects.toThrow("native approval reply failed");
    expect(adapter.listLiveSessionSnapshots("runtime-live")[0]?.pendingApprovals).toContainEqual(
      expect.objectContaining({ requestId: approval.requestId }),
    );

    await adapter.replyLiveApproval(reply);
    expect(respondServerRequest).toHaveBeenCalledTimes(2);
    expect(adapter.listLiveSessionSnapshots("runtime-live")[0]?.pendingApprovals).toHaveLength(0);
  });

  test("keeps a question retryable when the native reply fails", async () => {
    let responseCount = 0;
    const respondServerRequest = mock(async () => {
      responseCount += 1;
      if (responseCount === 1) {
        throw new Error("native question reply failed");
      }
    });
    const streamListeners: RuntimeListener[] = [];
    const subscribeEvents = mock((_runtimeId: string, listener) => {
      streamListeners.push((event) => listener(withRuntimeReceivedAt(event)));
      return () => undefined;
    });
    const { adapter } = createHarness({ respondServerRequest, subscribeEvents });
    await adapter.startSession(codexStartSessionInput());
    const events: unknown[] = [];
    await adapter.subscribeEvents(codexSessionRuntimeRef("thread/start-runtime-live"), (event) =>
      events.push(event),
    );
    streamListeners[0]?.({
      runtimeId: "runtime-live",
      kind: "server_request",
      message: {
        id: 75,
        method: CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_TOOL_REQUEST_USER_INPUT,
        params: {
          threadId: "thread/start-runtime-live",
          turnId: "turn-retry-question",
          itemId: "question-item-retry",
          questions: [{ id: "question-retry", header: "Confirm", question: "Continue?" }],
        },
      },
    });
    const question = await waitForEvent(
      events,
      (event) =>
        typeof event === "object" &&
        event !== null &&
        (event as { type?: unknown }).type === "question_required",
    );
    const requestId = (question as { requestId: string }).requestId;
    const reply = {
      runtimeId: "runtime-live",
      externalSessionId: "thread/start-runtime-live",
      requestId,
      answers: [["yes"]],
    };

    await expect(adapter.replyLiveQuestion(reply)).rejects.toThrow("native question reply failed");
    expect(adapter.listLiveSessionSnapshots("runtime-live")[0]?.pendingQuestions).toContainEqual(
      expect.objectContaining({ requestId }),
    );

    await adapter.replyLiveQuestion(reply);
    expect(respondServerRequest).toHaveBeenCalledTimes(2);
    expect(adapter.listLiveSessionSnapshots("runtime-live")[0]?.pendingQuestions).toHaveLength(0);
  });

  test("preserves initial-turn approvals for late listeners and runtime snapshots", async () => {
    const streamListeners: RuntimeListener[] = [];
    const subscribeEvents = mock((_runtimeId: string, listener) => {
      streamListeners.push((event) => listener(withRuntimeReceivedAt(event)));
      return () => undefined;
    });
    const { adapter } = createHarness({ subscribeEvents }, { deferTurnStart: true });
    await adapter.prepareRuntime("runtime-live");

    await adapter.startSession(codexStartSessionInput());
    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: "thread/start-runtime-live",
        parts: [{ kind: "text", text: "Start now" }],
      }),
    );
    streamListeners[0]?.({
      runtimeId: "runtime-live",
      kind: "server_request",
      message: {
        id: 31,
        method: "approval/request",
        params: {
          threadId: "thread/start-runtime-live",
          turnId: "turn-approval-initial",
          tool: "network",
          url: "https://example.com",
        },
      },
    });
    const replayedEvents: unknown[] = [];
    await adapter.subscribeEvents(codexSessionRuntimeRef("thread/start-runtime-live"), (event) =>
      replayedEvents.push(event),
    );
    const approval = await waitForEvent(replayedEvents, isApprovalRequiredEvent);

    const snapshot = await adapter.readSessionRuntimeSnapshot({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      externalSessionId: "thread/start-runtime-live",
    });
    expect(snapshot.availability).toBe("runtime");
    expect(snapshot.classification).toBe("waiting_for_permission");
    expect(snapshot.pendingApprovals).toHaveLength(1);
    const requestId = approval.requestId;
    expect(requestId).toMatch(/^pending-/);
    expect(requestId).not.toBe("31");
    expect(snapshot.pendingApprovals).toContainEqual(expect.objectContaining({ requestId }));
    const liveSnapshot = adapter.listLiveSessionSnapshots("runtime-live")[0];
    expect(liveSnapshot).toBeDefined();
    expect(liveSnapshot?.pendingApprovals[0]).not.toHaveProperty("requestInstanceId");
    expect(liveSnapshot?.pendingApprovals[0]).not.toHaveProperty("metadata");
    expect(agentSessionLiveSnapshotSchema.parse(liveSnapshot)).toEqual(liveSnapshot);
    expect(() =>
      agentSessionLiveSnapshotSchema.parse({
        ...liveSnapshot,
        pendingApprovals: [
          { ...liveSnapshot?.pendingApprovals[0], requestInstanceId: "private-native-route" },
        ],
      }),
    ).toThrow();
  });

  test("clears pending Codex input state when local stop cleanup runs", async () => {
    const streamListeners: RuntimeListener[] = [];
    const subscribeEvents = mock((_runtimeId: string, listener) => {
      streamListeners.push((event) => listener(withRuntimeReceivedAt(event)));
      return () => undefined;
    });
    const { adapter } = createHarness({ subscribeEvents }, { deferTurnStart: true });
    await adapter.prepareRuntime("runtime-live");

    await adapter.startSession(codexStartSessionInput());
    const events: unknown[] = [];
    await adapter.subscribeEvents(codexSessionRuntimeRef("thread/start-runtime-live"), (event) =>
      events.push(event),
    );
    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: "thread/start-runtime-live",
        parts: [{ kind: "text", text: "Start now" }],
      }),
    );
    streamListeners[0]?.({
      runtimeId: "runtime-live",
      kind: "server_request",
      message: {
        id: 36,
        method: "item/tool/requestUserInput",
        params: {
          threadId: "thread/start-runtime-live",
          turnId: "turn-question",
          itemId: "item-1",
          questions: [{ id: "question-1", header: "Confirm", question: "Continue?" }],
        },
      },
    });
    const question = await waitForEvent(
      events,
      (event) =>
        typeof event === "object" &&
        event !== null &&
        (event as { type?: unknown }).type === "question_required",
    );

    const snapshot = await adapter.readSessionRuntimeSnapshot({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      externalSessionId: "thread/start-runtime-live",
    });
    expect(snapshot.classification).toBe("waiting_for_question");
    expect(snapshot.pendingQuestions).toHaveLength(1);
    const requestId = (question as { requestId: string }).requestId;
    if (!requestId) {
      throw new Error("expected pending question");
    }
    expect(snapshot.pendingQuestions).toContainEqual(expect.objectContaining({ requestId }));

    await adapter.stopSession(codexSessionRef("thread/start-runtime-live"));

    await expect(
      adapter.replyQuestion({
        ...codexSessionRuntimeRef("thread/start-runtime-live"),
        externalSessionId: "thread/start-runtime-live",
        requestId,
        answers: [["yes"]],
      }),
    ).rejects.toThrow(`Unknown Codex question request '${requestId}'.`);
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
});
