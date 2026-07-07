import { describe, expect, test } from "bun:test";
import { CODEX_APP_SERVER_SERVER_REQUEST_METHOD } from "@openducktor/contracts";
import type { AgentModelSelection } from "@openducktor/core";
import { codexTurnKey } from "./codex-app-server-requests";
import type { ActiveCodexTurn } from "./codex-app-server-shared";
import type { CodexThreadSnapshot } from "./codex-app-server-threads";
import { CodexPendingInputState } from "./codex-pending-input-state";
import { CodexRuntimeSessionEvents } from "./codex-runtime-session-events";
import { CodexSessionEventBus } from "./codex-session-event-bus";
import { codexSessionRef } from "./codex-session-ref";
import { CodexSubagentLinkState } from "./codex-subagent-link-state";
import type { CodexSessionState } from "./types";

const waitForRuntimeEvent = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const flushRuntimeEvents = async (): Promise<void> => {
  await waitForRuntimeEvent();
  await waitForRuntimeEvent();
};

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

const bufferedServerRequestEvent = (
  message: unknown,
  runtimeId = "runtime-1",
  receivedAt = runtimeEventReceivedAt,
) => ({
  runtimeId,
  kind: "server_request" as const,
  receivedAt,
  message,
});

const bufferedNotificationEvent = (
  message: unknown,
  runtimeId = "runtime-1",
  receivedAt = runtimeEventReceivedAt,
) => ({
  runtimeId,
  kind: "notification" as const,
  receivedAt,
  message,
});

const createRuntimeEvents = (
  overrides: Partial<ConstructorParameters<typeof CodexRuntimeSessionEvents>[0]> = {},
) =>
  new CodexRuntimeSessionEvents({
    subscribeEvents: undefined,
    takeBufferedEvents: undefined,
    respondServerRequest: async () => undefined,
    sessions: new Map(),
    activeTurnsBySessionId: new Map(),
    sessionEvents: new CodexSessionEventBus(),
    pendingInput: new CodexPendingInputState(),
    subagents: new CodexSubagentLinkState(),
    updateThreadStatus: () => undefined,
    flushQueuedUserMessagesLater: () => undefined,
    ...overrides,
  });

const model = { providerId: "openai", modelId: "gpt-5", variant: "medium" } as const;

const createSession = (threadId: string): CodexSessionState => ({
  summary: {
    externalSessionId: threadId,
    title: threadId,
    status: "running",
    role: "build",
    startedAt: "2026-06-13T00:00:00.000Z",
  },
  systemPrompt: "",
  role: "build",
  runtimeId: "runtime-1",
  repoPath: "/repo",
  threadId,
  workingDirectory: "/repo",
  taskId: "task-1",
  model,
});

const createSessionForRuntime = (threadId: string, runtimeId: string): CodexSessionState => ({
  ...createSession(threadId),
  runtimeId,
});

const createActiveTurn = (
  threadId: string,
  turnModel: AgentModelSelection = model,
): ActiveCodexTurn => ({
  session: createSession(threadId),
  startedAtMs: Date.now(),
  turnStartPromise: Promise.resolve({}),
  isTurnSettled: () => false,
  markTurnSettled: () => undefined,
  handledRequestKeys: new Set(),
  queuedUserMessages: [],
  model: turnModel,
});

const createSettlingActiveTurn = (
  threadId: string,
  turnModel: AgentModelSelection = model,
): { activeTurn: ActiveCodexTurn; isSettled: () => boolean } => {
  let settled = false;
  return {
    activeTurn: {
      ...createActiveTurn(threadId, turnModel),
      isTurnSettled: () => settled,
      markTurnSettled: () => {
        settled = true;
      },
    },
    isSettled: () => settled,
  };
};

const createChildThreadSnapshot = (
  childThreadId: string,
  parentThreadId: string,
): CodexThreadSnapshot => ({
  id: childThreadId,
  cwd: "/repo",
  startedAt: "2026-06-13T00:00:00.000Z",
  title: childThreadId,
  status: { classification: "running" },
  parentThreadId,
  agentNickname: null,
  agentRole: null,
  subAgentSource: {
    parentThreadId,
    depth: 1,
    agentPath: ["agent"],
    agentNickname: null,
    agentRole: null,
  },
});

describe("CodexRuntimeSessionEvents", () => {
  test("clears turn-scoped stream metadata for one session only", () => {
    const runtimeEvents = createRuntimeEvents();
    const { modelByTurnKey } = runtimeEvents.historyLoadContext();
    const stoppedSessionTurnKey = codexTurnKey("thread/stopped", "turn-stopped");
    const otherSessionTurnKey = codexTurnKey("thread/other", "turn-active");
    runtimeEvents.bindActiveTurnId(createActiveTurn("thread/stopped"), "turn-stopped");
    runtimeEvents.bindActiveTurnId(createActiveTurn("thread/other"), "turn-active");

    runtimeEvents.clearSession("thread/stopped");

    expect(modelByTurnKey.has(stoppedSessionTurnKey)).toBe(false);
    expect(modelByTurnKey.has(otherSessionTurnKey)).toBe(true);
  });

  test("routes buffered child server requests through a loaded linked parent", async () => {
    let listener: RuntimeListener | null = null;
    const parentSession = createSession("parent-thread");
    const sessions = new Map([[parentSession.threadId, parentSession]]);
    const pendingInput = new CodexPendingInputState();
    const subagents = new CodexSubagentLinkState();
    subagents.upsertLink({
      parentThreadId: "parent-thread",
      childThreadId: "child-thread",
      itemId: "spawn-1",
      status: "running",
    });
    const runtimeEvents = createRuntimeEvents({
      subscribeEvents: (_runtimeId, next) => {
        listener = (event) => next(withRuntimeReceivedAt(event));
        return () => undefined;
      },
      sessions,
      pendingInput,
      subagents,
    });

    await runtimeEvents.ensureRuntimeEventSubscription("runtime-1");
    listener?.({
      runtimeId: "runtime-1",
      kind: "server_request",
      message: {
        id: 50,
        method: "item/tool/requestUserInput",
        params: {
          threadId: "child-thread",
          turnId: "turn-child",
          questions: [
            {
              id: "question-item-1",
              header: "Choose",
              question: "Proceed?",
              options: ["Yes", "No"],
            },
          ],
        },
      },
    });
    await waitForRuntimeEvent();

    expect(pendingInput.question("50")).toMatchObject({
      threadId: "child-thread",
      route: {
        parentExternalSessionId: "parent-thread",
        childExternalSessionId: "child-thread",
      },
    });
  });

  test("emits network command approval requests from the live server-request stream", async () => {
    let listener: RuntimeListener | null = null;
    const session = createSession("thread-network");
    const sessions = new Map([[session.threadId, session]]);
    const pendingInput = new CodexPendingInputState();
    const sessionEvents = new CodexSessionEventBus();
    const emittedEvents: unknown[] = [];
    sessionEvents.subscribe(codexSessionRef(session), (event) => emittedEvents.push(event));
    const runtimeEvents = createRuntimeEvents({
      subscribeEvents: (_runtimeId, next) => {
        listener = (event) => next(withRuntimeReceivedAt(event));
        return () => undefined;
      },
      sessions,
      sessionEvents,
      pendingInput,
    });

    await runtimeEvents.ensureRuntimeEventSubscription("runtime-1");
    listener?.({
      runtimeId: "runtime-1",
      kind: "server_request",
      message: {
        id: "network-approval-1",
        method: CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_COMMAND_EXECUTION_REQUEST_APPROVAL,
        params: {
          threadId: "thread-network",
          turnId: "turn-network",
          itemId: "call-network-1",
          startedAtMs: 1_783_109_994_463,
          environmentId: "local",
          reason:
            "Do you want to allow a shell `curl` check so I can verify terminal network access directly?",
          networkApprovalContext: {
            host: "example.com",
          },
        },
      },
    });
    await flushRuntimeEvents();

    expect(pendingInput.approval("network-approval-1")).toMatchObject({
      threadId: "thread-network",
      request: {
        requestId: "network-approval-1",
        requestType: "command_execution",
        title: "Network access approval requested",
      },
    });
    expect(emittedEvents).toContainEqual(
      expect.objectContaining({
        type: "approval_required",
        externalSessionId: "thread-network",
        requestId: "network-approval-1",
        title: "Network access approval requested",
      }),
    );
  });

  test("preserves buffered request resolution ordering", async () => {
    const session = createSession("thread-buffered-order");
    const sessions = new Map([[session.threadId, session]]);
    const pendingInput = new CodexPendingInputState();
    const runtimeEvents = createRuntimeEvents({
      takeBufferedEvents: async () => [
        bufferedServerRequestEvent({
          id: "buffered-approval-1",
          method: CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_COMMAND_EXECUTION_REQUEST_APPROVAL,
          params: {
            threadId: "thread-buffered-order",
            turnId: "turn-buffered-order",
            itemId: "call-buffered-order",
            command: "curl -I https://example.com",
          },
        }),
        bufferedNotificationEvent({
          method: "serverRequest/resolved",
          params: {
            threadId: "thread-buffered-order",
            requestId: "buffered-approval-1",
          },
        }),
      ],
      sessions,
      pendingInput,
    });

    const hasPendingInput = await runtimeEvents.handleBufferedRuntimeEvents(session, new Set());

    expect(hasPendingInput).toBe(false);
    expect(pendingInput.approval("buffered-approval-1")).toBeUndefined();
    expect(pendingInput.pendingApprovalEventsForSession("thread-buffered-order")).toHaveLength(0);
  });

  test("uses server-request receipt time when binding a buffered active turn", async () => {
    const requestReceivedAt = "2000-01-01T00:00:00.000Z";
    const idleReceivedAt = "2000-01-01T00:00:01.000Z";
    const session = createSession("thread-server-request-receipt");
    const sessions = new Map([[session.threadId, session]]);
    const pendingInput = new CodexPendingInputState();
    const sessionEvents = new CodexSessionEventBus();
    const emittedEvents: unknown[] = [];
    const { activeTurn, isSettled } = createSettlingActiveTurn(session.threadId);
    const activeTurnsBySessionId = new Map([[session.threadId, activeTurn]]);
    sessionEvents.subscribe(codexSessionRef(session), (event) => emittedEvents.push(event));
    const runtimeEvents = createRuntimeEvents({
      takeBufferedEvents: async () => [
        bufferedServerRequestEvent(
          {
            id: "question-receipt-1",
            method: "item/tool/requestUserInput",
            params: {
              threadId: session.threadId,
              turnId: "turn-receipt",
              questions: [
                {
                  id: "question-item-1",
                  header: "Choose",
                  question: "Proceed?",
                  options: ["Yes", "No"],
                },
              ],
            },
          },
          session.runtimeId,
          requestReceivedAt,
        ),
        bufferedNotificationEvent(
          {
            method: "thread/status/changed",
            params: {
              threadId: session.threadId,
              status: { type: "idle" },
            },
          },
          session.runtimeId,
          idleReceivedAt,
        ),
      ],
      sessions,
      sessionEvents,
      pendingInput,
      activeTurnsBySessionId,
    });

    await runtimeEvents.handleBufferedRuntimeEvents(session, new Set());

    expect(activeTurn.turnId).toBe("turn-receipt");
    expect(activeTurn.startedAtMs).toBe(Date.parse(requestReceivedAt));
    expect(isSettled()).toBe(true);
    expect(emittedEvents).toContainEqual(
      expect.objectContaining({
        type: "session_idle",
        externalSessionId: session.threadId,
        timestamp: idleReceivedAt,
      }),
    );
  });

  test("lowers the active-turn cutoff when same-turn start evidence is older", async () => {
    const originalStartedAtMs = Date.parse("2100-01-01T00:00:00.000Z");
    const turnStartedReceivedAt = "2000-01-01T00:00:00.000Z";
    const idleReceivedAt = "2000-01-01T00:00:01.000Z";
    const session = createSession("thread-same-turn-cutoff");
    const sessions = new Map([[session.threadId, session]]);
    const sessionEvents = new CodexSessionEventBus();
    const emittedEvents: unknown[] = [];
    const { activeTurn, isSettled } = createSettlingActiveTurn(session.threadId);
    const activeTurnsBySessionId = new Map([[session.threadId, activeTurn]]);
    sessionEvents.subscribe(codexSessionRef(session), (event) => emittedEvents.push(event));
    const runtimeEvents = createRuntimeEvents({
      takeBufferedEvents: async () => [
        bufferedNotificationEvent(
          {
            method: "turn/started",
            params: {
              threadId: session.threadId,
              turn: { id: "turn-same" },
            },
          },
          session.runtimeId,
          turnStartedReceivedAt,
        ),
        bufferedNotificationEvent(
          {
            method: "thread/status/changed",
            params: {
              threadId: session.threadId,
              status: { type: "idle" },
            },
          },
          session.runtimeId,
          idleReceivedAt,
        ),
      ],
      sessions,
      sessionEvents,
      activeTurnsBySessionId,
    });
    runtimeEvents.bindActiveTurnId(activeTurn, "turn-same", originalStartedAtMs);

    await runtimeEvents.handleBufferedRuntimeEvents(session, new Set());

    expect(activeTurn.turnId).toBe("turn-same");
    expect(activeTurn.startedAtMs).toBe(Date.parse(turnStartedReceivedAt));
    expect(isSettled()).toBe(true);
    expect(emittedEvents).toContainEqual(
      expect.objectContaining({
        type: "session_idle",
        externalSessionId: session.threadId,
        timestamp: idleReceivedAt,
      }),
    );
  });

  test("does not replay token-usage drained requests resolved in the same batch", async () => {
    const session = createSession("thread-drained-resolution");
    const sessions = new Map([[session.threadId, session]]);
    const pendingInput = new CodexPendingInputState();
    const runtimeEvents = createRuntimeEvents({
      takeBufferedEvents: async () => [
        bufferedServerRequestEvent({
          id: "drained-approval-1",
          method: CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_COMMAND_EXECUTION_REQUEST_APPROVAL,
          params: {
            threadId: "thread-drained-resolution",
            turnId: "turn-drained-resolution",
            itemId: "call-drained-resolution",
            command: "curl -I https://example.com",
          },
        }),
        bufferedNotificationEvent({
          method: "serverRequest/resolved",
          params: {
            threadId: "thread-drained-resolution",
            requestId: "drained-approval-1",
          },
        }),
        bufferedNotificationEvent({
          method: "thread/tokenUsage/updated",
          params: {
            threadId: "thread-drained-resolution",
            turnId: "turn-drained-resolution",
            tokenUsage: {
              total: { totalTokens: 1_000 },
              last: { totalTokens: 100 },
              modelContextWindow: 200_000,
            },
          },
        }),
      ],
      sessions,
      pendingInput,
    });

    const usage = await runtimeEvents
      .historyLoadContext()
      .collectThreadReadTokenUsage("runtime-1", "thread-drained-resolution");
    await runtimeEvents.replayBufferedStreamEvents("thread-drained-resolution");

    expect(usage.get("turn-drained-resolution")).toMatchObject({
      totalTokens: 100,
      contextWindow: 200_000,
    });
    expect(pendingInput.approval("drained-approval-1")).toBeUndefined();
    expect(pendingInput.pendingApprovalEventsForSession("thread-drained-resolution")).toHaveLength(
      0,
    );
  });

  test("reprocesses child server requests buffered before a parent subagent link is learned", async () => {
    let listener: RuntimeListener | null = null;
    const parentSession = createSession("parent-thread");
    const sessions = new Map([[parentSession.threadId, parentSession]]);
    const sessionEvents = new CodexSessionEventBus();
    const emittedEvents: unknown[] = [];
    sessionEvents.subscribe(codexSessionRef(parentSession), (event) => emittedEvents.push(event));
    const pendingInput = new CodexPendingInputState();
    const subagents = new CodexSubagentLinkState();
    const runtimeEvents = createRuntimeEvents({
      subscribeEvents: (_runtimeId, next) => {
        listener = (event) => next(withRuntimeReceivedAt(event));
        return () => undefined;
      },
      sessions,
      sessionEvents,
      pendingInput,
      subagents,
    });

    await runtimeEvents.ensureRuntimeEventSubscription("runtime-1");
    listener?.({
      runtimeId: "runtime-1",
      kind: "server_request",
      message: {
        id: 51,
        method: "item/tool/requestUserInput",
        params: {
          threadId: "child-thread",
          turnId: "turn-child",
          questions: [
            {
              id: "question-item-1",
              header: "Choose",
              question: "Proceed?",
              options: ["Yes", "No"],
            },
          ],
        },
      },
    });
    await flushRuntimeEvents();

    expect(pendingInput.question("51")).toBeUndefined();
    expect(pendingInput.pendingQuestionEventsForSession("parent-thread")).toHaveLength(0);
    expect(emittedEvents).not.toContainEqual(
      expect.objectContaining({
        type: "session_error",
        message: expect.stringContaining("Cannot route Codex server request"),
      }),
    );

    listener?.({
      runtimeId: "runtime-1",
      kind: "notification",
      message: {
        method: "item/completed",
        params: {
          threadId: "parent-thread",
          turnId: "turn-parent",
          completedAtMs: 1_777_766_401_000,
          item: {
            type: "collabAgentToolCall",
            id: "spawn-1",
            tool: "spawnAgent",
            status: "completed",
            senderThreadId: "parent-thread",
            receiverThreadIds: ["child-thread"],
            agentsStates: {
              "child-thread": { status: "running" },
            },
          },
        },
      },
    });
    await flushRuntimeEvents();

    expect(pendingInput.question("51")).toMatchObject({
      threadId: "child-thread",
      route: {
        parentExternalSessionId: "parent-thread",
        childExternalSessionId: "child-thread",
      },
    });
    expect(pendingInput.pendingQuestionEventsForSession("parent-thread")).toHaveLength(1);
  });

  test("does not let history projection consume live buffered child requests", async () => {
    let listener: RuntimeListener | null = null;
    const parentSession = createSession("parent-thread");
    const sessions = new Map([[parentSession.threadId, parentSession]]);
    const pendingInput = new CodexPendingInputState();
    const runtimeEvents = createRuntimeEvents({
      subscribeEvents: (_runtimeId, next) => {
        listener = (event) => next(withRuntimeReceivedAt(event));
        return () => undefined;
      },
      sessions,
      pendingInput,
    });

    await runtimeEvents.ensureRuntimeEventSubscription("runtime-1");
    listener?.({
      runtimeId: "runtime-1",
      kind: "server_request",
      message: {
        id: 57,
        method: "item/tool/requestUserInput",
        params: {
          threadId: "child-thread",
          turnId: "turn-child",
          questions: [
            {
              id: "question-item-1",
              header: "Choose",
              question: "Proceed?",
              options: ["Yes", "No"],
            },
          ],
        },
      },
    });
    await flushRuntimeEvents();

    runtimeEvents.historyLoadContext().eventMapperPipeline.runThreadItem(
      {
        index: 0,
        timestamp: "2026-06-13T00:00:00.000Z",
        item: {
          type: "collabAgentToolCall",
          id: "spawn-history",
          tool: "spawnAgent",
          status: "completed",
          senderThreadId: "parent-thread",
          receiverThreadIds: ["child-thread"],
          agentsStates: {
            "child-thread": { status: "running" },
          },
        },
      },
      {
        source: "thread_read",
        threadId: "parent-thread",
        timestamp: "2026-06-13T00:00:00.000Z",
      },
    );
    await flushRuntimeEvents();

    expect(pendingInput.question("57")).toBeUndefined();
    expect(pendingInput.pendingQuestionEventsForSession("parent-thread")).toHaveLength(0);
  });

  test("applies buffered child request resolutions after route-learned request replay", async () => {
    let listener: RuntimeListener | null = null;
    const parentSession = createSession("parent-thread");
    const sessions = new Map([[parentSession.threadId, parentSession]]);
    const pendingInput = new CodexPendingInputState();
    const subagents = new CodexSubagentLinkState();
    const runtimeEvents = createRuntimeEvents({
      subscribeEvents: (_runtimeId, next) => {
        listener = (event) => next(withRuntimeReceivedAt(event));
        return () => undefined;
      },
      sessions,
      pendingInput,
      subagents,
    });

    await runtimeEvents.ensureRuntimeEventSubscription("runtime-1");
    listener?.({
      runtimeId: "runtime-1",
      kind: "server_request",
      message: {
        id: 53,
        method: "item/tool/requestUserInput",
        params: {
          threadId: "child-thread",
          turnId: "turn-child",
          questions: [
            {
              id: "question-item-1",
              header: "Choose",
              question: "Proceed?",
              options: ["Yes", "No"],
            },
          ],
        },
      },
    });
    await flushRuntimeEvents();

    listener?.({
      runtimeId: "runtime-1",
      kind: "notification",
      message: {
        method: "serverRequest/resolved",
        params: {
          threadId: "child-thread",
          requestId: 53,
        },
      },
    });
    await flushRuntimeEvents();

    subagents.upsertLink({
      parentThreadId: "parent-thread",
      childThreadId: "child-thread",
      itemId: "spawn-1",
      status: "running",
    });
    await flushRuntimeEvents();

    expect(pendingInput.question("53")).toBeUndefined();
    expect(pendingInput.pendingQuestionEventsForSession("parent-thread")).toHaveLength(0);
  });

  test("emits an error for subscribed server requests missing an owner thread id", async () => {
    let listener: RuntimeListener | null = null;
    const parentSession = createSession("parent-thread");
    const sessions = new Map([[parentSession.threadId, parentSession]]);
    const sessionEvents = new CodexSessionEventBus();
    const emittedEvents: unknown[] = [];
    sessionEvents.subscribe(codexSessionRef(parentSession), (event) => emittedEvents.push(event));
    const pendingInput = new CodexPendingInputState();
    const runtimeEvents = createRuntimeEvents({
      subscribeEvents: (_runtimeId, next) => {
        listener = (event) => next(withRuntimeReceivedAt(event));
        return () => undefined;
      },
      sessions,
      sessionEvents,
      pendingInput,
    });

    await runtimeEvents.ensureRuntimeEventSubscription("runtime-1");
    listener?.({
      runtimeId: "runtime-1",
      kind: "server_request",
      message: {
        id: 54,
        method: "item/tool/requestUserInput",
        params: {
          turnId: "turn-child",
          questions: [
            {
              id: "question-item-1",
              header: "Choose",
              question: "Proceed?",
              options: ["Yes", "No"],
            },
          ],
        },
      },
    });
    await flushRuntimeEvents();

    expect(pendingInput.question("54")).toBeUndefined();
    expect(emittedEvents).toContainEqual(
      expect.objectContaining({
        type: "session_error",
        externalSessionId: "parent-thread",
        message: expect.stringContaining("missing a thread identifier"),
      }),
    );
  });

  test("emits routed child request processing errors on the loaded parent session", async () => {
    let listener: RuntimeListener | null = null;
    const parentSession = createSession("parent-thread");
    const sessions = new Map([[parentSession.threadId, parentSession]]);
    const sessionEvents = new CodexSessionEventBus();
    const emittedEvents: unknown[] = [];
    sessionEvents.subscribe(codexSessionRef(parentSession), (event) => emittedEvents.push(event));
    const subagents = new CodexSubagentLinkState();
    subagents.upsertLink({
      parentThreadId: "parent-thread",
      childThreadId: "child-thread",
      itemId: "spawn-1",
      status: "running",
    });
    const runtimeEvents = createRuntimeEvents({
      subscribeEvents: (_runtimeId, next) => {
        listener = (event) => next(withRuntimeReceivedAt(event));
        return () => undefined;
      },
      sessions,
      sessionEvents,
      subagents,
    });

    await runtimeEvents.ensureRuntimeEventSubscription("runtime-1");
    listener?.({
      runtimeId: "runtime-1",
      kind: "server_request",
      message: {
        id: 58,
        method: "",
        params: {
          threadId: "child-thread",
          turnId: "turn-child",
        },
      },
    });
    await flushRuntimeEvents();

    expect(emittedEvents).toContainEqual(
      expect.objectContaining({
        type: "session_error",
        externalSessionId: "parent-thread",
        message: "Codex app-server server request is missing method.",
      }),
    );
  });

  test("does not process buffered child requests across runtimes", async () => {
    const listeners = new Map<string, RuntimeListener>();
    const parentSession = createSessionForRuntime("parent-thread", "runtime-1");
    const runtimeTwoSession = createSessionForRuntime("runtime-two-thread", "runtime-2");
    const sessions = new Map([
      [parentSession.threadId, parentSession],
      [runtimeTwoSession.threadId, runtimeTwoSession],
    ]);
    const sessionEvents = new CodexSessionEventBus();
    const runtimeTwoEvents: unknown[] = [];
    sessionEvents.subscribe(codexSessionRef(runtimeTwoSession), (event) =>
      runtimeTwoEvents.push(event),
    );
    const pendingInput = new CodexPendingInputState();
    const subagents = new CodexSubagentLinkState();
    const runtimeEvents = createRuntimeEvents({
      subscribeEvents: (runtimeId, next) => {
        listeners.set(runtimeId, (event) => next(withRuntimeReceivedAt(event)));
        return () => undefined;
      },
      sessions,
      sessionEvents,
      pendingInput,
      subagents,
    });

    await runtimeEvents.ensureRuntimeEventSubscription("runtime-2");
    listeners.get("runtime-2")?.({
      runtimeId: "runtime-2",
      kind: "server_request",
      message: {
        id: 59,
        method: "item/tool/requestUserInput",
        params: {
          threadId: "child-thread",
          turnId: "turn-child",
          questions: [
            {
              id: "question-item-1",
              header: "Choose",
              question: "Proceed?",
              options: ["Yes", "No"],
            },
          ],
        },
      },
    });
    await flushRuntimeEvents();

    subagents.upsertLink({
      parentThreadId: "parent-thread",
      childThreadId: "child-thread",
      itemId: "spawn-1",
      status: "running",
    });
    await flushRuntimeEvents();

    expect(pendingInput.question("59")).toBeUndefined();

    listeners.get("runtime-2")?.({
      runtimeId: "runtime-2",
      kind: "server_request",
      message: {
        id: 60,
        method: "item/tool/requestUserInput",
        params: {
          threadId: "child-thread",
          turnId: "turn-child",
          questions: [
            {
              id: "question-item-2",
              header: "Choose",
              question: "Proceed again?",
              options: ["Yes", "No"],
            },
          ],
        },
      },
    });
    await flushRuntimeEvents();

    expect(pendingInput.question("60")).toBeUndefined();
    expect(runtimeTwoEvents).toEqual([]);
  });

  test("processes buffered child approvals when an inventory route is known before parent load", async () => {
    let listener: RuntimeListener | null = null;
    const parentSession = createSession("parent-thread");
    const sessions = new Map<string, CodexSessionState>();
    const pendingInput = new CodexPendingInputState();
    const subagents = new CodexSubagentLinkState();
    const runtimeEvents = createRuntimeEvents({
      subscribeEvents: (_runtimeId, next) => {
        listener = (event) => next(withRuntimeReceivedAt(event));
        return () => undefined;
      },
      sessions,
      pendingInput,
      subagents,
    });

    await runtimeEvents.ensureRuntimeEventSubscription("runtime-1");
    listener?.({
      runtimeId: "runtime-1",
      kind: "server_request",
      message: {
        id: 52,
        method: CODEX_APP_SERVER_SERVER_REQUEST_METHOD.MCP_SERVER_ELICITATION_REQUEST,
        params: {
          threadId: "child-thread",
          turnId: "turn-child",
          serverName: "semble",
          mode: "form",
          message: 'Allow the semble MCP server to run tool "search"?',
          requestedSchema: { type: "object", properties: {} },
          _meta: {
            codex_approval_kind: "mcp_tool_call",
            tool_name: "search",
            persist: ["session"],
          },
        },
      },
    });
    await flushRuntimeEvents();

    subagents.recordThread(createChildThreadSnapshot("child-thread", "parent-thread"));
    await flushRuntimeEvents();

    expect(pendingInput.approval("52")).toBeUndefined();

    sessions.set(parentSession.threadId, parentSession);
    await runtimeEvents.replayBufferedStreamEvents(parentSession.threadId);

    expect(pendingInput.approval("52")).toMatchObject({
      threadId: "child-thread",
      route: {
        parentExternalSessionId: "parent-thread",
        childExternalSessionId: "child-thread",
      },
    });
    expect(pendingInput.pendingApprovalEventsForSession("parent-thread")).toHaveLength(1);
  });

  test("mirrors already-processed child pending input when a route is learned later", async () => {
    const parentSession = createSession("parent-thread");
    const childSession = createSession("child-thread");
    const sessions = new Map([
      [parentSession.threadId, parentSession],
      [childSession.threadId, childSession],
    ]);
    const pendingInput = new CodexPendingInputState();
    const subagents = new CodexSubagentLinkState();
    createRuntimeEvents({
      sessions,
      pendingInput,
      subagents,
    });

    pendingInput.addQuestion({
      runtimeId: "runtime-1",
      threadId: "child-thread",
      request: {
        requestId: "question-1",
        questions: [{ header: "Choose", question: "Proceed?", options: ["Yes", "No"] }],
      },
      questionIds: ["question-item-1"],
      input: { requestId: "question-1" },
    });

    expect(pendingInput.pendingQuestionEventsForSession("parent-thread")).toHaveLength(0);

    subagents.upsertLink({
      parentThreadId: "parent-thread",
      childThreadId: "child-thread",
      itemId: "spawn-1",
      status: "running",
    });
    await flushRuntimeEvents();

    expect(pendingInput.question("question-1")).toMatchObject({
      route: {
        parentExternalSessionId: "parent-thread",
        childExternalSessionId: "child-thread",
      },
    });
    expect(pendingInput.pendingQuestionEventsForSession("parent-thread")).toHaveLength(1);
  });
});
