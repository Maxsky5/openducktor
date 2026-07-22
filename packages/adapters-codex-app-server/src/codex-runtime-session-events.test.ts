import { describe, expect, test } from "bun:test";
import { CODEX_APP_SERVER_SERVER_REQUEST_METHOD } from "@openducktor/contracts";
import type { AgentModelSelection } from "@openducktor/core";
import type { ActiveCodexTurn } from "./codex-app-server-shared";
import { CodexPendingInputState } from "./codex-pending-input-state";
import { CodexRuntimeSessionEvents } from "./codex-runtime-session-events";
import { CodexSessionEventBus } from "./codex-session-event-bus";
import { codexSessionRef } from "./codex-session-ref";
import { CodexSubagentLinkState } from "./codex-subagent-link-state";
import { codex0144MultiAgentV2Replay } from "./test-fixtures/codex-0-144-multi-agent-v2";
import type { CodexRuntimeEventQueueFailureHandler, CodexSessionState } from "./types";

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

const createRuntimeEvents = (
  overrides: Partial<ConstructorParameters<typeof CodexRuntimeSessionEvents>[0]> = {},
) => {
  const { subscribeEvents, onRuntimeEventQueueFailure, ...rest } = overrides;
  const deps = {
    subscribeEvents: undefined,
    respondServerRequest: async () => undefined,
    sessions: new Map(),
    activeTurnsBySessionId: new Map(),
    sessionEvents: new CodexSessionEventBus(),
    pendingInput: new CodexPendingInputState(),
    subagents: new CodexSubagentLinkState(),
    updateThreadStatus: () => undefined,
    flushQueuedUserMessagesLater: () => undefined,
    ...rest,
  };
  if (!subscribeEvents) {
    if (onRuntimeEventQueueFailure) {
      throw new Error("Runtime event queue failure handling requires an event subscriber.");
    }
    return new CodexRuntimeSessionEvents(deps);
  }
  return new CodexRuntimeSessionEvents({
    ...deps,
    subscribeEvents,
    onRuntimeEventQueueFailure:
      onRuntimeEventQueueFailure ??
      (() => {
        return undefined;
      }),
  });
};

const model = { providerId: "openai", modelId: "gpt-5", variant: "medium" } as const;

const createSession = (threadId: string): CodexSessionState => ({
  summary: {
    externalSessionId: threadId,
    title: threadId,
    status: "running",
    role: "build",
    runtimeKind: "codex",
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

const createRoutedSession = (
  retainedSession: CodexSessionState,
  externalSessionId: string,
): CodexSessionState => ({
  ...retainedSession,
  summary: {
    ...retainedSession.summary,
    externalSessionId,
    title: externalSessionId,
  },
  threadId: externalSessionId,
});

const createActiveTurn = (
  threadId: string,
  turnModel: AgentModelSelection = model,
): ActiveCodexTurn => ({
  session: createSession(threadId),
  startedAtMs: Date.now(),
  turnStartRequestSentAtMs: 0,
  turnStartPromise: Promise.resolve({}),
  isTurnSettled: () => false,
  markTurnSettled: () => undefined,
  handledRequestKeys: new Set(),
  queuedUserMessages: [],
  model: turnModel,
});

describe("CodexRuntimeSessionEvents", () => {
  test("requires a synchronous queue failure handler that returns exactly undefined", () => {
    const handler: CodexRuntimeEventQueueFailureHandler = () => {
      return undefined;
    };
    expect(handler({ runtimeId: "runtime-1", error: new Error("failed") })).toBeUndefined();

    // @ts-expect-error Queue failure reporting must not return a promise.
    const asyncHandler: CodexRuntimeEventQueueFailureHandler = async () => undefined;
    void asyncHandler;
  });

  test("normalizes Codex skill catalog invalidation without exposing its raw method", async () => {
    let listener: RuntimeListener | null = null;
    const invalidations: unknown[] = [];
    const runtimeEvents = createRuntimeEvents({
      subscribeEvents: (_runtimeId, next) => {
        listener = (event) => next(withRuntimeReceivedAt(event));
        return () => undefined;
      },
      onCatalogInvalidated: (event) => invalidations.push(event),
    });

    await runtimeEvents.ensureRuntimeEventSubscription("runtime-1");
    listener?.({
      runtimeId: "runtime-1",
      kind: "notification",
      message: { method: "skills/changed", params: { cwd: "/repo" } },
    });
    await flushRuntimeEvents();

    expect(invalidations).toEqual([{ runtimeId: "runtime-1", catalog: "skills" }]);
    expect(invalidations[0]).not.toHaveProperty("method");
    expect(invalidations[0]).not.toHaveProperty("params");
  });

  test("reports rejected live mutation delivery without converting it into a session error", async () => {
    let listener: RuntimeListener | null = null;
    const session = createSession("thread-live-mutation");
    const sessionEvents = new CodexSessionEventBus();
    const emittedEvents: unknown[] = [];
    const failures: Array<{ runtimeId: string; error: unknown }> = [];
    const deliveryFailure = new Error("live mutation delivery failed");
    sessionEvents.subscribe(codexSessionRef(session), (event) => emittedEvents.push(event));
    const runtimeEvents = createRuntimeEvents({
      subscribeEvents: (_runtimeId, next) => {
        listener = (event) => next(withRuntimeReceivedAt(event));
        return () => undefined;
      },
      sessions: new Map([[session.threadId, session]]),
      sessionEvents,
      onLiveSessionMutation: async () => {
        throw deliveryFailure;
      },
      onRuntimeEventQueueFailure: (failure) => {
        failures.push(failure);
        return undefined;
      },
    });

    await runtimeEvents.ensureRuntimeEventSubscription("runtime-1");
    listener?.({
      runtimeId: "runtime-1",
      kind: "notification",
      message: {
        method: "item/agentMessage/delta",
        params: {
          threadId: session.threadId,
          turnId: "turn-1",
          itemId: "message-1",
          delta: "Working",
        },
      },
    });
    await flushRuntimeEvents();

    expect(failures).toEqual([{ runtimeId: "runtime-1", error: deliveryFailure }]);
    expect(emittedEvents).not.toContainEqual(expect.objectContaining({ type: "session_error" }));
  });

  test("reports rejected catalog invalidation delivery without converting it into a session error", async () => {
    let listener: RuntimeListener | null = null;
    const session = createSession("thread-catalog");
    const sessionEvents = new CodexSessionEventBus();
    const emittedEvents: unknown[] = [];
    const failures: Array<{ runtimeId: string; error: unknown }> = [];
    const catalogFailure = new Error("catalog invalidation delivery failed");
    sessionEvents.subscribe(codexSessionRef(session), (event) => emittedEvents.push(event));
    const runtimeEvents = createRuntimeEvents({
      subscribeEvents: (_runtimeId, next) => {
        listener = (event) => next(withRuntimeReceivedAt(event));
        return () => undefined;
      },
      sessions: new Map([[session.threadId, session]]),
      sessionEvents,
      onCatalogInvalidated: async () => {
        throw catalogFailure;
      },
      onRuntimeEventQueueFailure: (failure) => {
        failures.push(failure);
        return undefined;
      },
    });

    await runtimeEvents.ensureRuntimeEventSubscription("runtime-1");
    listener?.({
      runtimeId: "runtime-1",
      kind: "notification",
      message: {
        method: "skills/changed",
        params: { threadId: session.threadId },
      },
    });
    await flushRuntimeEvents();

    expect(failures).toEqual([{ runtimeId: "runtime-1", error: catalogFailure }]);
    expect(emittedEvents).not.toContainEqual(expect.objectContaining({ type: "session_error" }));
  });

  test("reports one failed mutation delivery and continues the same runtime queue", async () => {
    let listener: RuntimeListener | null = null;
    const processingFailure = new Error("first mutation failed");
    const failures: Array<{ runtimeId: string; error: unknown }> = [];
    const mutations: unknown[] = [];
    let attempts = 0;
    let rejectFirstDelivery: ((error: unknown) => void) | undefined;
    const firstDelivery = new Promise<void>((_resolve, reject) => {
      rejectFirstDelivery = reject;
    });
    const runtimeEvents = createRuntimeEvents({
      subscribeEvents: (_runtimeId, next) => {
        listener = (event) => next(withRuntimeReceivedAt(event));
        return () => undefined;
      },
      onLiveSessionMutation: (mutation) => {
        attempts += 1;
        if (attempts === 1) {
          return firstDelivery;
        }
        mutations.push(mutation);
      },
      onRuntimeEventQueueFailure: (failure) => {
        failures.push(failure);
        return undefined;
      },
    });

    await runtimeEvents.ensureRuntimeEventSubscription("runtime-1");
    listener?.({
      runtimeId: "runtime-1",
      kind: "notification",
      message: { method: "thread/status/changed", params: { threadId: "missing-thread" } },
    });
    await waitForRuntimeEvent();
    listener?.({
      runtimeId: "runtime-1",
      kind: "notification",
      message: { method: "thread/status/changed", params: { threadId: "missing-thread" } },
    });
    rejectFirstDelivery?.(processingFailure);
    await flushRuntimeEvents();

    expect(failures).toEqual([{ runtimeId: "runtime-1", error: processingFailure }]);
    expect(attempts).toBe(2);
    expect(mutations).toHaveLength(1);
  });

  test("starts catalog and mutation delivery once before preserving a single failure by identity", async () => {
    let listener: RuntimeListener | null = null;
    const deliveryFailure = new Error("catalog delivery failed");
    const deliveries: string[] = [];
    const failures: Array<{ runtimeId: string; error: unknown }> = [];
    let rejectCatalog: ((error: unknown) => void) | undefined;
    let resolveMutation: (() => void) | undefined;
    const catalogDelivery = new Promise<void>((_resolve, reject) => {
      rejectCatalog = reject;
    });
    const mutationDelivery = new Promise<void>((resolve) => {
      resolveMutation = resolve;
    });
    const runtimeEvents = createRuntimeEvents({
      subscribeEvents: (_runtimeId, next) => {
        listener = (event) => next(withRuntimeReceivedAt(event));
        return () => undefined;
      },
      onCatalogInvalidated: () => {
        deliveries.push("catalog");
        return catalogDelivery;
      },
      onLiveSessionMutation: () => {
        deliveries.push("mutation");
        return mutationDelivery;
      },
      onRuntimeEventQueueFailure: (failure) => {
        failures.push(failure);
        return undefined;
      },
    });

    await runtimeEvents.ensureRuntimeEventSubscription("runtime-1");
    listener?.({
      runtimeId: "runtime-1",
      kind: "notification",
      message: { method: "skills/changed", params: {} },
    });
    await waitForRuntimeEvent();

    expect(deliveries).toEqual(["catalog", "mutation"]);
    expect(failures).toEqual([]);
    rejectCatalog?.(deliveryFailure);
    await waitForRuntimeEvent();
    expect(failures).toEqual([]);
    resolveMutation?.();
    await flushRuntimeEvents();
    expect(failures).toEqual([{ runtimeId: "runtime-1", error: deliveryFailure }]);
  });

  test("reports both catalog and mutation delivery failures as one actionable aggregate", async () => {
    let listener: RuntimeListener | null = null;
    const catalogFailure = new Error("catalog delivery failed");
    const mutationFailure = new Error("mutation delivery failed");
    const deliveries: string[] = [];
    const failures: Array<{ runtimeId: string; error: unknown }> = [];
    const runtimeEvents = createRuntimeEvents({
      subscribeEvents: (_runtimeId, next) => {
        listener = (event) => next(withRuntimeReceivedAt(event));
        return () => undefined;
      },
      onCatalogInvalidated: () => {
        deliveries.push("catalog");
        throw catalogFailure;
      },
      onLiveSessionMutation: () => {
        deliveries.push("mutation");
        throw mutationFailure;
      },
      onRuntimeEventQueueFailure: (failure) => {
        failures.push(failure);
        return undefined;
      },
    });

    await runtimeEvents.ensureRuntimeEventSubscription("runtime-1");
    listener?.({
      runtimeId: "runtime-1",
      kind: "notification",
      message: { method: "skills/changed", params: {} },
    });
    await flushRuntimeEvents();

    expect(deliveries).toEqual(["catalog", "mutation"]);
    expect(failures).toHaveLength(1);
    const failure = failures[0]?.error;
    if (!(failure instanceof AggregateError)) {
      throw new Error("Expected an AggregateError for dual delivery failures.");
    }
    expect(failure.errors).toEqual([catalogFailure, mutationFailure]);
    expect(failure.message).toContain("runtime-1");
    expect(failure.message).toContain("catalog invalidation: catalog delivery failed");
    expect(failure.message).toContain("live session mutation: mutation delivery failed");
  });

  test("projects Codex 0.144 MultiAgentV2 child completion onto the parent subagent", async () => {
    let listener: RuntimeListener | null = null;
    const parentSession = createSession("parent-thread");
    const sessions = new Map([[parentSession.threadId, parentSession]]);
    const sessionEvents = new CodexSessionEventBus();
    const emittedEvents: unknown[] = [];
    sessionEvents.subscribe(codexSessionRef(parentSession), (event) => emittedEvents.push(event));
    const runtimeEvents = createRuntimeEvents({
      subscribeEvents: (_runtimeId, next) => {
        listener = (event) => next(withRuntimeReceivedAt(event));
        return () => undefined;
      },
      sessions,
      sessionEvents,
    });

    await runtimeEvents.ensureRuntimeEventSubscription("runtime-1");
    for (const event of codex0144MultiAgentV2Replay) {
      listener?.({
        runtimeId: "runtime-1",
        kind: event.kind,
        message: event.message,
      });
      await flushRuntimeEvents();
    }

    const subagentParts = emittedEvents.flatMap((event) => {
      if (
        typeof event !== "object" ||
        event === null ||
        !("type" in event) ||
        event.type !== "assistant_part" ||
        !("part" in event) ||
        typeof event.part !== "object" ||
        event.part === null ||
        !("kind" in event.part) ||
        event.part.kind !== "subagent"
      ) {
        return [];
      }
      return [event.part];
    });

    expect(subagentParts).toEqual([
      expect.objectContaining({
        correlationKey: "codex-subagent:parent-thread:child-thread",
        externalSessionId: "child-thread",
        status: "running",
      }),
      expect.objectContaining({
        correlationKey: "codex-subagent:parent-thread:child-thread",
        externalSessionId: "child-thread",
        status: "completed",
      }),
    ]);
  });

  test("projects child completion buffered before the V2 parent-child link is learned", async () => {
    let listener: RuntimeListener | null = null;
    const parentSession = createSession("parent-thread");
    const sessions = new Map([[parentSession.threadId, parentSession]]);
    const sessionEvents = new CodexSessionEventBus();
    const emittedEvents: unknown[] = [];
    sessionEvents.subscribe(codexSessionRef(parentSession), (event) => emittedEvents.push(event));
    const runtimeEvents = createRuntimeEvents({
      subscribeEvents: (_runtimeId, next) => {
        listener = (event) => next(withRuntimeReceivedAt(event));
        return () => undefined;
      },
      sessions,
      sessionEvents,
    });
    const spawnEvent = codex0144MultiAgentV2Replay[0];
    const childCompletionEvent = codex0144MultiAgentV2Replay[4];

    await runtimeEvents.ensureRuntimeEventSubscription("runtime-1");
    listener?.({
      runtimeId: "runtime-1",
      kind: childCompletionEvent.kind,
      message: childCompletionEvent.message,
    });
    await flushRuntimeEvents();
    listener?.({
      runtimeId: "runtime-1",
      kind: spawnEvent.kind,
      message: spawnEvent.message,
    });
    await flushRuntimeEvents();

    expect(emittedEvents).toContainEqual(
      expect.objectContaining({
        type: "assistant_part",
        externalSessionId: "parent-thread",
        part: expect.objectContaining({
          kind: "subagent",
          externalSessionId: "child-thread",
          status: "completed",
        }),
      }),
    );
  });

  test("projects the newest runtime lifecycle state learned before the parent-child link", async () => {
    let listener: RuntimeListener | null = null;
    const parentSession = createSession("parent-thread");
    const sessions = new Map([[parentSession.threadId, parentSession]]);
    const sessionEvents = new CodexSessionEventBus();
    const emittedEvents: unknown[] = [];
    sessionEvents.subscribe(codexSessionRef(parentSession), (event) => emittedEvents.push(event));
    const runtimeEvents = createRuntimeEvents({
      subscribeEvents: (_runtimeId, next) => {
        listener = (event) => next(withRuntimeReceivedAt(event));
        return () => undefined;
      },
      sessions,
      sessionEvents,
    });
    const spawnEvent = codex0144MultiAgentV2Replay[0];
    const childStartedEvent = codex0144MultiAgentV2Replay[1];
    const staleChildCompletionEvent = codex0144MultiAgentV2Replay[4];

    await runtimeEvents.ensureRuntimeEventSubscription("runtime-1");
    for (const event of [staleChildCompletionEvent, childStartedEvent]) {
      listener?.({
        runtimeId: "runtime-1",
        kind: event.kind,
        message: event.message,
      });
      await flushRuntimeEvents();
    }
    listener?.({
      runtimeId: "runtime-1",
      kind: spawnEvent.kind,
      message: spawnEvent.message,
    });
    await flushRuntimeEvents();

    const statuses = emittedEvents.flatMap((event) => {
      if (
        typeof event !== "object" ||
        event === null ||
        !("type" in event) ||
        event.type !== "assistant_part" ||
        !("part" in event) ||
        typeof event.part !== "object" ||
        event.part === null ||
        !("kind" in event.part) ||
        event.part.kind !== "subagent" ||
        !("status" in event.part)
      ) {
        return [];
      }
      return [event.part.status];
    });

    expect(statuses).toEqual(["completed", "running"]);
  });

  test("projects pre-link child completion when the child session is already loaded", async () => {
    let listener: RuntimeListener | null = null;
    const parentSession = createSession("parent-thread");
    const childSession = createSession("child-thread");
    const sessions = new Map([
      [parentSession.threadId, parentSession],
      [childSession.threadId, childSession],
    ]);
    const sessionEvents = new CodexSessionEventBus();
    const emittedEvents: unknown[] = [];
    sessionEvents.subscribe(codexSessionRef(parentSession), (event) => emittedEvents.push(event));
    const runtimeEvents = createRuntimeEvents({
      subscribeEvents: (_runtimeId, next) => {
        listener = (event) => next(withRuntimeReceivedAt(event));
        return () => undefined;
      },
      sessions,
      sessionEvents,
    });
    const spawnEvent = codex0144MultiAgentV2Replay[0];
    const childCompletionEvent = codex0144MultiAgentV2Replay[4];

    await runtimeEvents.ensureRuntimeEventSubscription("runtime-1");
    listener?.({
      runtimeId: "runtime-1",
      kind: childCompletionEvent.kind,
      message: childCompletionEvent.message,
    });
    await flushRuntimeEvents();
    listener?.({
      runtimeId: "runtime-1",
      kind: spawnEvent.kind,
      message: spawnEvent.message,
    });
    await flushRuntimeEvents();

    expect(emittedEvents).toContainEqual(
      expect.objectContaining({
        type: "assistant_part",
        externalSessionId: "parent-thread",
        part: expect.objectContaining({
          kind: "subagent",
          externalSessionId: "child-thread",
          status: "completed",
        }),
      }),
    );
  });

  test("keeps pre-link child lifecycle notifications isolated by runtime", async () => {
    const listeners = new Map<string, RuntimeListener>();
    const parentOne = createSessionForRuntime("parent-one", "runtime-1");
    const parentTwo = createSessionForRuntime("parent-two", "runtime-2");
    const sessions = new Map([
      [parentOne.threadId, parentOne],
      [parentTwo.threadId, parentTwo],
    ]);
    const sessionEvents = new CodexSessionEventBus();
    const parentOneEvents: unknown[] = [];
    const parentTwoEvents: unknown[] = [];
    sessionEvents.subscribe(codexSessionRef(parentOne), (event) => parentOneEvents.push(event));
    sessionEvents.subscribe(codexSessionRef(parentTwo), (event) => parentTwoEvents.push(event));
    const runtimeEvents = createRuntimeEvents({
      subscribeEvents: (runtimeId, next) => {
        listeners.set(runtimeId, (event) => next(withRuntimeReceivedAt(event)));
        return () => undefined;
      },
      sessions,
      sessionEvents,
    });
    const childCompletionEvent = codex0144MultiAgentV2Replay[4];
    const spawnEvent = codex0144MultiAgentV2Replay[0];
    const spawnMessageForParent = (parentThreadId: string) => ({
      ...spawnEvent.message,
      params: {
        ...spawnEvent.message.params,
        threadId: parentThreadId,
      },
    });

    await runtimeEvents.ensureRuntimeEventSubscription("runtime-1");
    await runtimeEvents.ensureRuntimeEventSubscription("runtime-2");
    listeners.get("runtime-1")?.({
      runtimeId: "runtime-1",
      kind: childCompletionEvent.kind,
      message: childCompletionEvent.message,
    });
    await flushRuntimeEvents();
    listeners.get("runtime-2")?.({
      runtimeId: "runtime-2",
      kind: spawnEvent.kind,
      message: spawnMessageForParent("parent-two"),
    });
    await flushRuntimeEvents();

    expect(parentTwoEvents).not.toContainEqual(
      expect.objectContaining({
        type: "assistant_part",
        part: expect.objectContaining({ status: "completed" }),
      }),
    );

    listeners.get("runtime-1")?.({
      runtimeId: "runtime-1",
      kind: spawnEvent.kind,
      message: spawnMessageForParent("parent-one"),
    });
    await flushRuntimeEvents();

    expect(parentOneEvents).toContainEqual(
      expect.objectContaining({
        type: "assistant_part",
        externalSessionId: "parent-one",
        part: expect.objectContaining({
          externalSessionId: "child-thread",
          status: "completed",
        }),
      }),
    );
  });

  test("handles identical child approval request ids independently across runtimes", async () => {
    const listeners = new Map<string, RuntimeListener>();
    const parentOne = createSessionForRuntime("parent-one", "runtime-1");
    const parentTwo = createSessionForRuntime("parent-two", "runtime-2");
    const sessions = new Map([
      [parentOne.threadId, parentOne],
      [parentTwo.threadId, parentTwo],
    ]);
    const sessionEvents = new CodexSessionEventBus();
    const parentOneEvents: unknown[] = [];
    const parentTwoEvents: unknown[] = [];
    sessionEvents.subscribe(codexSessionRef(parentOne), (event) => parentOneEvents.push(event));
    sessionEvents.subscribe(codexSessionRef(parentTwo), (event) => parentTwoEvents.push(event));
    const subagents = new CodexSubagentLinkState();
    subagents.upsertLink({
      runtimeId: "runtime-1",
      parentThreadId: parentOne.threadId,
      childThreadId: "shared-child-thread",
      itemId: "spawn-one",
      status: "running",
    });
    subagents.upsertLink({
      runtimeId: "runtime-2",
      parentThreadId: parentTwo.threadId,
      childThreadId: "shared-child-thread",
      itemId: "spawn-two",
      status: "running",
    });
    const runtimeEvents = createRuntimeEvents({
      subscribeEvents: (runtimeId, next) => {
        listeners.set(runtimeId, (event) => next(withRuntimeReceivedAt(event)));
        return () => undefined;
      },
      sessions,
      sessionEvents,
      subagents,
    });
    const approval = {
      id: 0,
      method: CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_COMMAND_EXECUTION_REQUEST_APPROVAL,
      params: {
        threadId: "shared-child-thread",
        turnId: "child-turn",
        itemId: "child-command",
        command: "pwd",
        cwd: "/repo",
      },
    };

    await runtimeEvents.ensureRuntimeEventSubscription("runtime-1");
    await runtimeEvents.ensureRuntimeEventSubscription("runtime-2");
    listeners.get("runtime-1")?.({
      runtimeId: "runtime-1",
      kind: "server_request",
      message: approval,
    });
    await flushRuntimeEvents();
    listeners.get("runtime-2")?.({
      runtimeId: "runtime-2",
      kind: "server_request",
      message: approval,
    });
    await flushRuntimeEvents();

    const parentOneApproval = parentOneEvents.find(
      (event) => (event as { type?: string }).type === "approval_required",
    ) as { externalSessionId: string; requestId: string };
    const parentTwoApproval = parentTwoEvents.find(
      (event) => (event as { type?: string }).type === "approval_required",
    ) as { externalSessionId: string; requestId: string };
    expect(parentOneApproval.externalSessionId).toBe("parent-one");
    expect(parentTwoApproval.externalSessionId).toBe("parent-two");
    expect(parentOneApproval.requestId).not.toBe("0");
    expect(parentTwoApproval.requestId).not.toBe("0");
    expect(parentOneApproval.requestId).not.toBe(parentTwoApproval.requestId);
  });

  test("clears retained context for one session only", async () => {
    let listener: RuntimeListener | null = null;
    const runtimeEvents = createRuntimeEvents({
      subscribeEvents: (_runtimeId, next) => {
        listener = (event) => next(withRuntimeReceivedAt(event));
        return () => undefined;
      },
    });
    await runtimeEvents.ensureRuntimeEventSubscription("runtime-1");
    for (const [threadId, totalTokens] of [
      ["thread/stopped", 100],
      ["thread/other", 200],
    ] as const) {
      listener?.({
        runtimeId: "runtime-1",
        kind: "notification",
        message: {
          method: "thread/tokenUsage/updated",
          params: {
            threadId,
            turnId: `${threadId}-turn`,
            tokenUsage: {
              total: { totalTokens },
              last: { totalTokens },
              modelContextWindow: 200_000,
            },
          },
        },
      });
    }
    await flushRuntimeEvents();

    runtimeEvents.clearSession("thread/stopped");

    expect(runtimeEvents.latestContextUsage("runtime-1", "thread/stopped")).toBeNull();
    expect(runtimeEvents.latestContextUsage("runtime-1", "thread/other")).toEqual({
      totalTokens: 200,
      contextWindow: 200_000,
    });
  });

  test("returns null after a successful resume with no retained usage", async () => {
    const runtimeEvents = createRuntimeEvents();

    await expect(
      runtimeEvents.loadSessionContextUsage("runtime-1", "thread-target", async () => undefined),
    ).resolves.toBeNull();
  });

  test("records a malformed token notification as a stream fault without changing usage", async () => {
    let listener: RuntimeListener | null = null;
    const firstSession = createSession("first-retained-thread");
    const secondSession = createSession("second-retained-thread");
    const mutations: Array<{
      fault?: string;
      faultRef?: unknown;
      transcriptEvents: Array<{ type?: string; sessionRef?: unknown }>;
    }> = [];
    const runtimeEvents = createRuntimeEvents({
      subscribeEvents: (_runtimeId, next) => {
        listener = (event) => next(withRuntimeReceivedAt(event));
        return () => undefined;
      },
      sessions: new Map([
        [firstSession.threadId, firstSession],
        [secondSession.threadId, secondSession],
      ]),
      onLiveSessionMutation: (mutation) => mutations.push(mutation),
    });

    await runtimeEvents.ensureRuntimeEventSubscription("runtime-1");
    listener?.({
      runtimeId: "runtime-1",
      kind: "notification",
      message: {
        method: "thread/tokenUsage/updated",
        params: {
          turnId: "thread-target-turn",
          tokenUsage: {
            total: { totalTokens: 300 },
            last: { totalTokens: 300 },
            modelContextWindow: 200_000,
          },
        },
      },
    });
    await flushRuntimeEvents();

    expect(runtimeEvents.latestContextUsage("runtime-1", "thread-target")).toBeNull();
    expect(mutations.at(-1)?.fault).toContain("missing threadId");
    expect(mutations.at(-1)?.faultRef).toBeUndefined();
  });

  test("scopes a routed stream processing fault to the routed child live ref", async () => {
    let listener: RuntimeListener | null = null;
    const parentSession = createSession("parent-thread");
    const childThreadId = "child-thread";
    const childLiveSession = {
      ...parentSession,
      summary: {
        ...parentSession.summary,
        externalSessionId: childThreadId,
        title: childThreadId,
      },
      threadId: childThreadId,
    };
    const subagents = new CodexSubagentLinkState();
    subagents.upsertLink({
      runtimeId: "runtime-1",
      parentThreadId: parentSession.threadId,
      childThreadId,
      itemId: "spawn-1",
      status: "running",
    });
    const mutations: Array<{ fault?: string; faultRef?: unknown }> = [];
    const runtimeEvents = createRuntimeEvents({
      subscribeEvents: (_runtimeId, next) => {
        listener = (event) => next(withRuntimeReceivedAt(event));
        return () => undefined;
      },
      sessions: new Map([[parentSession.threadId, parentSession]]),
      subagents,
      onLiveSessionMutation: (mutation) => mutations.push(mutation),
    });

    await runtimeEvents.ensureRuntimeEventSubscription("runtime-1");
    listener?.({
      runtimeId: "runtime-1",
      kind: "server_request",
      message: {
        id: "invalid-request",
        method: "",
        params: { threadId: childThreadId },
      },
    });
    await flushRuntimeEvents();

    expect(mutations.at(-1)?.fault).toBe("Codex app-server server request is missing method.");
    expect(mutations.at(-1)?.faultRef).toEqual(codexSessionRef(childLiveSession));
    const sessionErrors =
      mutations.at(-1)?.transcriptEvents.filter((event) => event.type === "session_error") ?? [];
    expect(sessionErrors).toEqual([
      expect.objectContaining({ sessionRef: codexSessionRef(childLiveSession) }),
    ]);
    expect(sessionErrors).not.toContainEqual(
      expect.objectContaining({ sessionRef: codexSessionRef(parentSession) }),
    );
  });

  test("scopes malformed grandchild events to the grandchild through a retained root", async () => {
    let listener: RuntimeListener | null = null;
    const rootSession = createSession("root-thread");
    const grandchildSession = {
      ...rootSession,
      summary: {
        ...rootSession.summary,
        externalSessionId: "grandchild-thread",
        title: "grandchild-thread",
      },
      threadId: "grandchild-thread",
    };
    const subagents = new CodexSubagentLinkState();
    subagents.upsertLink({
      runtimeId: "runtime-1",
      parentThreadId: rootSession.threadId,
      childThreadId: "child-thread",
      itemId: "spawn-child",
      status: "running",
    });
    subagents.upsertLink({
      runtimeId: "runtime-1",
      parentThreadId: "child-thread",
      childThreadId: grandchildSession.threadId,
      itemId: "spawn-grandchild",
      status: "running",
    });
    const rootEvents: unknown[] = [];
    const grandchildEvents: unknown[] = [];
    const sessionEvents = new CodexSessionEventBus();
    sessionEvents.subscribe(codexSessionRef(rootSession), (event) => rootEvents.push(event));
    sessionEvents.subscribe(codexSessionRef(grandchildSession), (event) =>
      grandchildEvents.push(event),
    );
    const mutations: Array<{
      faultRef?: unknown;
      transcriptEvents: Array<{ type?: string; sessionRef?: unknown }>;
    }> = [];
    const runtimeEvents = createRuntimeEvents({
      subscribeEvents: (_runtimeId, next) => {
        listener = (event) => next(withRuntimeReceivedAt(event));
        return () => undefined;
      },
      sessions: new Map([[rootSession.threadId, rootSession]]),
      sessionEvents,
      subagents,
      onLiveSessionMutation: (mutation) => mutations.push(mutation),
    });

    await runtimeEvents.ensureRuntimeEventSubscription("runtime-1");
    listener?.({
      runtimeId: "runtime-1",
      kind: "server_request",
      message: {
        id: "invalid-grandchild-request",
        method: "",
        params: { threadId: grandchildSession.threadId },
      },
    });
    await flushRuntimeEvents();

    expect(mutations.at(-1)?.faultRef).toEqual(codexSessionRef(grandchildSession));
    expect(mutations.at(-1)?.transcriptEvents).toContainEqual(
      expect.objectContaining({
        type: "session_error",
        sessionRef: codexSessionRef(grandchildSession),
      }),
    );
    expect(rootEvents).not.toContainEqual(expect.objectContaining({ type: "session_error" }));
    expect(grandchildEvents).toContainEqual(expect.objectContaining({ type: "session_error" }));
  });

  test("emits and resolves nested grandchild questions through the grandchild event identity", async () => {
    let listener: RuntimeListener | null = null;
    const rootSession = createSession("root-thread");
    const grandchildSession = createRoutedSession(rootSession, "grandchild-thread");
    const subagents = new CodexSubagentLinkState();
    subagents.upsertLink({
      runtimeId: "runtime-1",
      parentThreadId: rootSession.threadId,
      childThreadId: "child-thread",
      itemId: "spawn-child",
      status: "running",
    });
    subagents.upsertLink({
      runtimeId: "runtime-1",
      parentThreadId: "child-thread",
      childThreadId: grandchildSession.threadId,
      itemId: "spawn-grandchild",
      status: "running",
    });
    const pendingInput = new CodexPendingInputState();
    const grandchildEvents: unknown[] = [];
    const sessionEvents = new CodexSessionEventBus();
    sessionEvents.subscribe(codexSessionRef(grandchildSession), (event) =>
      grandchildEvents.push(event),
    );
    const runtimeEvents = createRuntimeEvents({
      subscribeEvents: (_runtimeId, next) => {
        listener = (event) => next(withRuntimeReceivedAt(event));
        return () => undefined;
      },
      sessions: new Map([[rootSession.threadId, rootSession]]),
      subagents,
      pendingInput,
      sessionEvents,
    });

    await runtimeEvents.ensureRuntimeEventSubscription("runtime-1");
    listener?.({
      runtimeId: "runtime-1",
      kind: "server_request",
      message: {
        id: "nested-question",
        method: "item/tool/requestUserInput",
        params: {
          threadId: grandchildSession.threadId,
          turnId: "grandchild-turn",
          questions: [{ id: "question-1", header: "Proceed", question: "Continue?" }],
        },
      },
    });
    await flushRuntimeEvents();

    const pending = pendingInput.nativeRequest(
      "runtime-1",
      grandchildSession.threadId,
      "nested-question",
    );
    expect(pending).toMatchObject({
      kind: "question",
      entry: { threadId: grandchildSession.threadId },
    });
    const requestId = pending?.entry.request.requestId;
    expect(grandchildEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "question_required",
          externalSessionId: grandchildSession.threadId,
          parentExternalSessionId: "child-thread",
          childExternalSessionId: grandchildSession.threadId,
          sessionRef: codexSessionRef(grandchildSession),
        }),
        expect.objectContaining({
          type: "assistant_part",
          externalSessionId: grandchildSession.threadId,
          part: expect.objectContaining({ kind: "tool", status: "running" }),
        }),
      ]),
    );

    listener?.({
      runtimeId: "runtime-1",
      kind: "notification",
      message: {
        method: "serverRequest/resolved",
        params: { threadId: grandchildSession.threadId, requestId: "nested-question" },
      },
    });
    await flushRuntimeEvents();

    expect(
      pendingInput.nativeRequest("runtime-1", grandchildSession.threadId, "nested-question"),
    ).toBeUndefined();
    expect(grandchildEvents).toContainEqual(
      expect.objectContaining({
        type: "question_resolved",
        externalSessionId: grandchildSession.threadId,
        requestId,
        parentExternalSessionId: "child-thread",
        childExternalSessionId: grandchildSession.threadId,
        sessionRef: codexSessionRef(grandchildSession),
      }),
    );
  });

  test("emits and resolves nested grandchild approvals through the grandchild event identity", async () => {
    let listener: RuntimeListener | null = null;
    const rootSession = createSession("root-thread");
    const grandchildSession = createRoutedSession(rootSession, "grandchild-thread");
    const subagents = new CodexSubagentLinkState();
    subagents.upsertLink({
      runtimeId: "runtime-1",
      parentThreadId: rootSession.threadId,
      childThreadId: "child-thread",
      itemId: "spawn-child",
      status: "running",
    });
    subagents.upsertLink({
      runtimeId: "runtime-1",
      parentThreadId: "child-thread",
      childThreadId: grandchildSession.threadId,
      itemId: "spawn-grandchild",
      status: "running",
    });
    const pendingInput = new CodexPendingInputState();
    const grandchildEvents: unknown[] = [];
    const sessionEvents = new CodexSessionEventBus();
    sessionEvents.subscribe(codexSessionRef(grandchildSession), (event) =>
      grandchildEvents.push(event),
    );
    const runtimeEvents = createRuntimeEvents({
      subscribeEvents: (_runtimeId, next) => {
        listener = (event) => next(withRuntimeReceivedAt(event));
        return () => undefined;
      },
      sessions: new Map([[rootSession.threadId, rootSession]]),
      subagents,
      pendingInput,
      sessionEvents,
    });

    await runtimeEvents.ensureRuntimeEventSubscription("runtime-1");
    listener?.({
      runtimeId: "runtime-1",
      kind: "server_request",
      message: {
        id: "nested-approval",
        method: "mcpServer/elicitation/request",
        params: {
          threadId: grandchildSession.threadId,
          turnId: "grandchild-turn",
          serverName: "semble",
          mode: "form",
          message: "Allow search?",
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

    const pending = pendingInput.nativeRequest(
      "runtime-1",
      grandchildSession.threadId,
      "nested-approval",
    );
    expect(pending).toMatchObject({
      kind: "approval",
      entry: { threadId: grandchildSession.threadId },
    });
    const requestId = pending?.entry.request.requestId;
    expect(grandchildEvents).toContainEqual(
      expect.objectContaining({
        type: "approval_required",
        externalSessionId: grandchildSession.threadId,
        parentExternalSessionId: "child-thread",
        childExternalSessionId: grandchildSession.threadId,
        sessionRef: codexSessionRef(grandchildSession),
      }),
    );

    listener?.({
      runtimeId: "runtime-1",
      kind: "notification",
      message: {
        method: "serverRequest/resolved",
        params: { threadId: grandchildSession.threadId, requestId: "nested-approval" },
      },
    });
    await flushRuntimeEvents();

    expect(
      pendingInput.nativeRequest("runtime-1", grandchildSession.threadId, "nested-approval"),
    ).toBeUndefined();
    expect(grandchildEvents).toContainEqual(
      expect.objectContaining({
        type: "approval_resolved",
        externalSessionId: grandchildSession.threadId,
        requestId,
        parentExternalSessionId: "child-thread",
        childExternalSessionId: grandchildSession.threadId,
        sessionRef: codexSessionRef(grandchildSession),
      }),
    );
  });

  test("emits routed question lifecycle events once to retained child and parent", async () => {
    let listener: RuntimeListener | null = null;
    const parentSession = createSession("parent-thread");
    const childSession = createSession("child-thread");
    const subagents = new CodexSubagentLinkState();
    subagents.upsertLink({
      runtimeId: "runtime-1",
      parentThreadId: parentSession.threadId,
      childThreadId: childSession.threadId,
      itemId: "spawn-child",
      status: "running",
    });
    const pendingInput = new CodexPendingInputState();
    const parentEvents: unknown[] = [];
    const childEvents: unknown[] = [];
    const sessionEvents = new CodexSessionEventBus();
    sessionEvents.subscribe(codexSessionRef(parentSession), (event) => parentEvents.push(event));
    sessionEvents.subscribe(codexSessionRef(childSession), (event) => childEvents.push(event));
    const runtimeEvents = createRuntimeEvents({
      subscribeEvents: (_runtimeId, next) => {
        listener = (event) => next(withRuntimeReceivedAt(event));
        return () => undefined;
      },
      sessions: new Map([
        [parentSession.threadId, parentSession],
        [childSession.threadId, childSession],
      ]),
      subagents,
      pendingInput,
      sessionEvents,
    });

    await runtimeEvents.ensureRuntimeEventSubscription("runtime-1");
    listener?.({
      runtimeId: "runtime-1",
      kind: "server_request",
      message: {
        id: "retained-child-question",
        method: "item/tool/requestUserInput",
        params: {
          threadId: childSession.threadId,
          turnId: "child-turn",
          questions: [{ id: "question-1", header: "Proceed", question: "Continue?" }],
        },
      },
    });
    await flushRuntimeEvents();

    const pending = pendingInput.nativeRequest(
      "runtime-1",
      childSession.threadId,
      "retained-child-question",
    );
    const requestId = pending?.entry.request.requestId;
    listener?.({
      runtimeId: "runtime-1",
      kind: "notification",
      message: {
        method: "serverRequest/resolved",
        params: { threadId: childSession.threadId, requestId: "retained-child-question" },
      },
    });
    await flushRuntimeEvents();

    const eventsByType = (events: unknown[], type: string) =>
      events.filter(
        (event) =>
          typeof event === "object" && event !== null && "type" in event && event.type === type,
      );
    const parentRequired = eventsByType(parentEvents, "question_required");
    const childRequired = eventsByType(childEvents, "question_required");
    const parentResolved = eventsByType(parentEvents, "question_resolved");
    const childResolved = eventsByType(childEvents, "question_resolved");

    expect(parentRequired).toHaveLength(1);
    expect(childRequired).toHaveLength(1);
    expect(parentResolved).toHaveLength(1);
    expect(childResolved).toHaveLength(1);
    expect(parentRequired[0]).toMatchObject({
      externalSessionId: parentSession.threadId,
      parentExternalSessionId: parentSession.threadId,
      childExternalSessionId: childSession.threadId,
    });
    expect(childRequired[0]).toMatchObject({
      externalSessionId: childSession.threadId,
      parentExternalSessionId: parentSession.threadId,
      childExternalSessionId: childSession.threadId,
    });
    expect(parentResolved[0]).toMatchObject({ requestId });
    expect(childResolved[0]).toMatchObject({ requestId });
  });

  test("leaves cross-runtime, incomplete, and cyclic route chains unscoped", async () => {
    let listener: RuntimeListener | null = null;
    const rootSession = createSessionForRuntime("root-thread", "runtime-2");
    const subagents = new CodexSubagentLinkState();
    subagents.upsertLink({
      runtimeId: "runtime-1",
      parentThreadId: rootSession.threadId,
      childThreadId: "cross-runtime-child",
      itemId: "cross-runtime-root",
      status: "running",
    });
    subagents.upsertLink({
      runtimeId: "runtime-1",
      parentThreadId: "cross-runtime-child",
      childThreadId: "cross-runtime-grandchild",
      itemId: "cross-runtime-child",
      status: "running",
    });
    subagents.upsertLink({
      runtimeId: "runtime-1",
      parentThreadId: "missing-parent",
      childThreadId: "incomplete-child",
      itemId: "incomplete",
      status: "running",
    });
    subagents.upsertLink({
      runtimeId: "runtime-1",
      parentThreadId: "cycle-child",
      childThreadId: "cycle-grandchild",
      itemId: "cycle-forward",
      status: "running",
    });
    subagents.upsertLink({
      runtimeId: "runtime-1",
      parentThreadId: "cycle-grandchild",
      childThreadId: "cycle-child",
      itemId: "cycle-backward",
      status: "running",
    });
    const mutations: Array<{ faultRef?: unknown; transcriptEvents: Array<{ type?: string }> }> = [];
    const rootEvents: unknown[] = [];
    const sessionEvents = new CodexSessionEventBus();
    sessionEvents.subscribe(codexSessionRef(rootSession), (event) => rootEvents.push(event));
    const runtimeEvents = createRuntimeEvents({
      subscribeEvents: (_runtimeId, next) => {
        listener = (event) => next(withRuntimeReceivedAt(event));
        return () => undefined;
      },
      sessions: new Map([[rootSession.threadId, rootSession]]),
      subagents,
      sessionEvents,
      onLiveSessionMutation: (mutation) => mutations.push(mutation),
    });

    await runtimeEvents.ensureRuntimeEventSubscription("runtime-1");
    for (const threadId of ["cross-runtime-grandchild", "incomplete-child", "cycle-grandchild"]) {
      listener?.({
        runtimeId: "runtime-1",
        kind: "server_request",
        message: { id: `invalid-${threadId}`, method: "", params: { threadId } },
      });
      await flushRuntimeEvents();
    }

    expect(mutations).toHaveLength(3);
    expect(rootEvents).toEqual([]);
    for (const mutation of mutations) {
      expect(mutation.faultRef).toBeUndefined();
      expect(mutation.transcriptEvents).not.toContainEqual(
        expect.objectContaining({ type: "session_error" }),
      );
    }
  });

  test("scopes malformed routed child token usage to the child live ref", async () => {
    let listener: RuntimeListener | null = null;
    const backgroundFailures: Array<{ runtimeId: string; error: unknown }> = [];
    const parentSession = createSession("parent-thread");
    const childThreadId = "child-thread";
    const childLiveSession = {
      ...parentSession,
      summary: {
        ...parentSession.summary,
        externalSessionId: childThreadId,
        title: childThreadId,
      },
      threadId: childThreadId,
    };
    const subagents = new CodexSubagentLinkState();
    subagents.upsertLink({
      runtimeId: "runtime-1",
      parentThreadId: parentSession.threadId,
      childThreadId,
      itemId: "spawn-1",
      status: "running",
    });
    const mutations: Array<{
      fault?: string;
      faultRef?: unknown;
      transcriptEvents: Array<{ type?: string; sessionRef?: unknown }>;
    }> = [];
    const runtimeEvents = createRuntimeEvents({
      subscribeEvents: (_runtimeId, next) => {
        listener = (event) => next(withRuntimeReceivedAt(event));
        return () => undefined;
      },
      sessions: new Map([[parentSession.threadId, parentSession]]),
      subagents,
      onLiveSessionMutation: (mutation) => mutations.push(mutation),
      onRuntimeEventQueueFailure: (failure) => {
        backgroundFailures.push(failure);
        return undefined;
      },
    });

    await runtimeEvents.ensureRuntimeEventSubscription("runtime-1");
    listener?.({
      runtimeId: "runtime-1",
      kind: "notification",
      message: {
        method: "thread/tokenUsage/updated",
        params: {
          threadId: childThreadId,
          turnId: "child-turn",
          tokenUsage: {},
        },
      },
    });
    await flushRuntimeEvents();

    expect(mutations.at(-1)?.fault).toBe(
      "Codex context usage notification for thread 'child-thread' has invalid token usage.",
    );
    expect(mutations.at(-1)?.faultRef).toEqual(codexSessionRef(childLiveSession));
    const sessionErrors =
      mutations.at(-1)?.transcriptEvents.filter((event) => event.type === "session_error") ?? [];
    expect(sessionErrors).toEqual([
      expect.objectContaining({ sessionRef: codexSessionRef(childLiveSession) }),
    ]);
    expect(sessionErrors).not.toContainEqual(
      expect.objectContaining({ sessionRef: codexSessionRef(parentSession) }),
    );
    expect(backgroundFailures).toEqual([]);
  });

  test("keeps direct stream fault diagnostics on the retained session ref", async () => {
    let listener: RuntimeListener | null = null;
    const session = createSession("direct-thread");
    const mutations: Array<{
      fault?: string;
      faultRef?: unknown;
      transcriptEvents: Array<{ type?: string; sessionRef?: unknown }>;
    }> = [];
    const runtimeEvents = createRuntimeEvents({
      subscribeEvents: (_runtimeId, next) => {
        listener = (event) => next(withRuntimeReceivedAt(event));
        return () => undefined;
      },
      sessions: new Map([[session.threadId, session]]),
      onLiveSessionMutation: (mutation) => mutations.push(mutation),
    });

    await runtimeEvents.ensureRuntimeEventSubscription("runtime-1");
    listener?.({
      runtimeId: "runtime-1",
      kind: "server_request",
      message: {
        id: "invalid-request",
        method: "",
        params: { threadId: session.threadId },
      },
    });
    await flushRuntimeEvents();

    expect(mutations.at(-1)?.faultRef).toEqual(codexSessionRef(session));
    expect(
      mutations.at(-1)?.transcriptEvents.filter((event) => event.type === "session_error"),
    ).toEqual([expect.objectContaining({ sessionRef: codexSessionRef(session) })]);
  });

  test("updates the actual retained session for direct status notifications", async () => {
    let listener: RuntimeListener | null = null;
    const session = createSession("direct-status-thread");
    session.summary = { ...session.summary, status: "idle" };
    const updatedStatuses: Array<{ threadId: string; status: string }> = [];
    const runtimeEvents = createRuntimeEvents({
      subscribeEvents: (_runtimeId, next) => {
        listener = (event) => next(withRuntimeReceivedAt(event));
        return () => undefined;
      },
      sessions: new Map([[session.threadId, session]]),
      updateThreadStatus: (_runtimeId, threadId, status) => {
        updatedStatuses.push({ threadId, status: status.classification });
      },
    });

    await runtimeEvents.ensureRuntimeEventSubscription("runtime-1");
    listener?.({
      runtimeId: "runtime-1",
      kind: "notification",
      message: {
        method: "thread/status/changed",
        params: { threadId: session.threadId, status: { type: "active", activeFlags: [] } },
      },
    });
    await flushRuntimeEvents();

    expect(session.liveStatus).toEqual({ classification: "running" });
    expect(session.summary.status).toBe("running");
    expect(updatedStatuses).toEqual([{ threadId: session.threadId, status: "running" }]);
  });

  test("retains canonical zero token usage without a stream fault", async () => {
    let listener: RuntimeListener | null = null;
    const mutations: Array<{ fault?: string }> = [];
    const runtimeEvents = createRuntimeEvents({
      subscribeEvents: (_runtimeId, next) => {
        listener = (event) => next(withRuntimeReceivedAt(event));
        return () => undefined;
      },
      onLiveSessionMutation: (mutation) => mutations.push(mutation),
    });

    await runtimeEvents.ensureRuntimeEventSubscription("runtime-1");
    listener?.({
      runtimeId: "runtime-1",
      kind: "notification",
      message: {
        method: "thread/tokenUsage/updated",
        params: {
          threadId: "thread-target",
          turnId: "thread-target-turn",
          tokenUsage: {
            total: { totalTokens: 0 },
            last: { totalTokens: 0 },
            modelContextWindow: 200_000,
          },
        },
      },
    });
    await flushRuntimeEvents();

    expect(mutations.at(-1)?.fault).toBeUndefined();
    expect(runtimeEvents.latestContextUsage("runtime-1", "thread-target")).toEqual({
      totalTokens: 0,
      contextWindow: 200_000,
    });
  });

  test("clears context usage for only the requested runtime", async () => {
    const listeners = new Map<string, RuntimeListener>();
    const runtimeEvents = createRuntimeEvents({
      subscribeEvents: (runtimeId, next) => {
        listeners.set(runtimeId, (event) => next(withRuntimeReceivedAt(event)));
        return () => undefined;
      },
    });
    const emitUsage = (runtimeId: string, totalTokens: number): void => {
      listeners.get(runtimeId)?.({
        runtimeId,
        kind: "notification",
        message: {
          method: "thread/tokenUsage/updated",
          params: {
            threadId: "shared-thread",
            turnId: `${runtimeId}-turn`,
            tokenUsage: {
              total: { totalTokens },
              last: { totalTokens },
              modelContextWindow: 200_000,
            },
          },
        },
      });
    };

    await runtimeEvents.ensureRuntimeEventSubscription("runtime-1");
    await runtimeEvents.ensureRuntimeEventSubscription("runtime-2");
    emitUsage("runtime-1", 100);
    emitUsage("runtime-2", 200);
    await flushRuntimeEvents();

    expect(runtimeEvents.latestContextUsage("runtime-1", "shared-thread")).toEqual({
      totalTokens: 100,
      contextWindow: 200_000,
    });
    expect(runtimeEvents.latestContextUsage("runtime-2", "shared-thread")).toEqual({
      totalTokens: 200,
      contextWindow: 200_000,
    });

    runtimeEvents.clearRuntime("runtime-1");

    expect(runtimeEvents.latestContextUsage("runtime-1", "shared-thread")).toBeNull();
    expect(runtimeEvents.latestContextUsage("runtime-2", "shared-thread")).toEqual({
      totalTokens: 200,
      contextWindow: 200_000,
    });
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

    expect(pendingInput.nativeRequest("runtime-1", "child-thread", 50)?.entry).toMatchObject({
      threadId: "child-thread",
      route: {
        parentExternalSessionId: "parent-thread",
        childExternalSessionId: "child-thread",
      },
    });
  });

  test("emits network command approval requests from the live server-request stream", async () => {
    let listener: RuntimeListener | null = null;
    const liveMutations: Array<{ transcriptEvents: unknown[] }> = [];
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
      onLiveSessionMutation: (mutation) => {
        liveMutations.push(mutation);
      },
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

    const pendingApproval = pendingInput.nativeRequest(
      "runtime-1",
      "thread-network",
      "network-approval-1",
    )?.entry;
    expect(pendingApproval).toMatchObject({
      threadId: "thread-network",
      request: {
        requestType: "command_execution",
        title: "Network access approval requested",
      },
    });
    expect(pendingApproval?.request.requestId).not.toBe("network-approval-1");
    expect(emittedEvents).toContainEqual(
      expect.objectContaining({
        type: "approval_required",
        externalSessionId: "thread-network",
        requestId: pendingApproval?.request.requestId,
        title: "Network access approval requested",
      }),
    );
    expect(liveMutations).toHaveLength(1);
    expect(liveMutations[0]?.transcriptEvents).toEqual([]);
  });

  test("forwards normalized transcript events through the live mutation", async () => {
    let listener: RuntimeListener | null = null;
    const session = createSession("thread-transcript");
    const liveMutations: Array<{ transcriptEvents: unknown[] }> = [];
    const runtimeEvents = createRuntimeEvents({
      subscribeEvents: (_runtimeId, next) => {
        listener = (event) => next(withRuntimeReceivedAt(event));
        return () => undefined;
      },
      sessions: new Map([[session.threadId, session]]),
      onLiveSessionMutation: (mutation) => {
        liveMutations.push(mutation);
      },
    });

    await runtimeEvents.ensureRuntimeEventSubscription("runtime-1");
    listener?.({
      runtimeId: "runtime-1",
      kind: "notification",
      message: {
        method: "item/agentMessage/delta",
        params: {
          threadId: session.threadId,
          turnId: "turn-1",
          itemId: "message-1",
          delta: "Working",
        },
      },
    });
    await flushRuntimeEvents();

    expect(liveMutations).toHaveLength(1);
    expect(liveMutations[0]?.transcriptEvents).toEqual([
      expect.objectContaining({
        type: "assistant_delta",
        externalSessionId: session.threadId,
        messageId: "message-1",
        delta: "Working",
      }),
    ]);
  });

  test("forwards normalized lifecycle details through the live mutation", async () => {
    let listener: RuntimeListener | null = null;
    const session = createSession("thread-lifecycle");
    const liveMutations: Array<{ transcriptEvents: Array<{ type?: string; message?: string }> }> =
      [];
    const runtimeEvents = createRuntimeEvents({
      subscribeEvents: (_runtimeId, next) => {
        listener = (event) => next(withRuntimeReceivedAt(event));
        return () => undefined;
      },
      sessions: new Map([[session.threadId, session]]),
      onLiveSessionMutation: (mutation) => {
        liveMutations.push(mutation);
      },
    });

    await runtimeEvents.ensureRuntimeEventSubscription("runtime-1");
    listener?.({
      runtimeId: "runtime-1",
      kind: "notification",
      message: {
        method: "turn/completed",
        params: {
          threadId: session.threadId,
          turn: {
            id: "turn-1",
            status: "failed",
            error: { message: "Child execution failed" },
          },
        },
      },
    });
    await flushRuntimeEvents();

    expect(liveMutations.flatMap((mutation) => mutation.transcriptEvents)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "session_error", message: "Child execution failed" }),
        expect.objectContaining({ type: "session_idle" }),
      ]),
    );
  });

  test("forwards routed child transcript events without a separately loaded child session", async () => {
    let listener: RuntimeListener | null = null;
    const parentSession = createSession("parent-thread");
    const subagents = new CodexSubagentLinkState();
    subagents.upsertLink({
      runtimeId: "runtime-1",
      parentThreadId: parentSession.threadId,
      childThreadId: "child-thread",
      itemId: "spawn-1",
      status: "running",
    });
    const liveMutations: Array<{ transcriptEvents: unknown[] }> = [];
    const runtimeEvents = createRuntimeEvents({
      subscribeEvents: (_runtimeId, next) => {
        listener = (event) => next(withRuntimeReceivedAt(event));
        return () => undefined;
      },
      sessions: new Map([[parentSession.threadId, parentSession]]),
      subagents,
      onLiveSessionMutation: (mutation) => {
        liveMutations.push(mutation);
      },
    });

    await runtimeEvents.ensureRuntimeEventSubscription("runtime-1");
    listener?.({
      runtimeId: "runtime-1",
      kind: "notification",
      message: {
        method: "item/agentMessage/delta",
        params: {
          threadId: "child-thread",
          turnId: "child-turn-1",
          itemId: "child-message-1",
          delta: "Child progress",
        },
      },
    });
    await flushRuntimeEvents();

    expect(liveMutations).toHaveLength(1);
    expect(liveMutations[0]?.transcriptEvents).toEqual([
      expect.objectContaining({
        type: "assistant_delta",
        externalSessionId: "child-thread",
        messageId: "child-message-1",
        delta: "Child progress",
        sessionRef: expect.objectContaining({
          externalSessionId: "child-thread",
          runtimeKind: "codex",
        }),
      }),
    ]);
  });

  test("does not first-bind before the turn start request is sent", () => {
    const session = createSession("thread-unstarted-turn");
    const runtimeEvents = createRuntimeEvents();
    const activeTurn = createActiveTurn(session.threadId);
    activeTurn.turnStartRequestSentAtMs = null;

    const didBind = runtimeEvents.bindActiveTurnId(activeTurn, "turn-too-early");

    expect(didBind).toBe(false);
    expect(activeTurn.turnId).toBeUndefined();
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

  test("emits routed child request processing errors on the routed child session", async () => {
    let listener: RuntimeListener | null = null;
    const parentSession = createSession("parent-thread");
    const childSession = {
      ...parentSession,
      summary: {
        ...parentSession.summary,
        externalSessionId: "child-thread",
        title: "child-thread",
      },
      threadId: "child-thread",
    };
    const sessions = new Map([[parentSession.threadId, parentSession]]);
    const sessionEvents = new CodexSessionEventBus();
    const parentEvents: unknown[] = [];
    const childEvents: unknown[] = [];
    sessionEvents.subscribe(codexSessionRef(parentSession), (event) => parentEvents.push(event));
    sessionEvents.subscribe(codexSessionRef(childSession), (event) => childEvents.push(event));
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

    expect(childEvents).toContainEqual(
      expect.objectContaining({
        type: "session_error",
        externalSessionId: "child-thread",
        message: "Codex app-server server request is missing method.",
      }),
    );
    expect(parentEvents).not.toContainEqual(expect.objectContaining({ type: "session_error" }));
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

    expect(pendingInput.nativeRequest("runtime-2", "child-thread", 59)).toBeUndefined();

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

    expect(pendingInput.nativeRequest("runtime-2", "child-thread", 60)).toBeUndefined();
    expect(runtimeTwoEvents).toEqual([]);
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

    const { entry } = pendingInput.addQuestion({
      runtimeId: "runtime-1",
      threadId: "child-thread",
      nativeRequest: {
        id: "question-1",
        method: "item/tool/requestUserInput",
      },
      request: {
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

    expect(pendingInput.question(entry.request.requestId)).toMatchObject({
      route: {
        parentExternalSessionId: "parent-thread",
        childExternalSessionId: "child-thread",
      },
    });
    expect(pendingInput.pendingQuestionEventsForSession("parent-thread")).toHaveLength(1);
  });
});
