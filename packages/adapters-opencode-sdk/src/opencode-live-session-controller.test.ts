import { describe, expect, test } from "bun:test";
import type { Event, OpencodeClient } from "@opencode-ai/sdk/v2/client";
import { createOpencodeLiveSessionController, type OpencodeLiveSessionChange } from "./index";
import type { RuntimeEventTransportRecord } from "./types";

type LiveClientHarness = {
  client: OpencodeClient;
  callOrder: string[];
  messageCalls: unknown[];
  promptCalls: unknown[];
  permissionReplyCalls: unknown[];
  questionReplyCalls: unknown[];
  setPermissionReplyError: (error: unknown | null) => void;
  setPendingApproval: (pending: boolean) => void;
  emit: (event: Event) => void;
  emitAndWait: (event: Event) => Promise<void>;
  completeStream: () => Promise<void>;
  failStream: (error: Error) => Promise<void>;
  streamSignal: () => AbortSignal | null;
};

type QueuedStreamEntry =
  | { type: "event"; event: Event; consumed?: () => void }
  | { type: "complete"; consumed: () => void }
  | { type: "failure"; error: Error; consumed: () => void };

const createLiveClientHarness = (
  input: {
    externalSessionId?: string;
    externalSessionIds?: string[];
    nativeRequestId?: string;
    totalTokens?: number;
    pendingQuestion?: boolean;
    listBarrier?: Promise<void>;
    onList?: () => void;
    messagesBarrier?: Promise<void>;
    onMessages?: () => void;
    permissionListBarrier?: Promise<void> | (() => Promise<void>);
    onPermissionList?: () => void;
    onPermissionListSettled?: () => void;
    questionListBarrier?: Promise<void> | (() => Promise<void>);
    onQuestionList?: () => void;
    onQuestionListSettled?: () => void;
    streamCloseBarrier?: Promise<void>;
  } = {},
): LiveClientHarness => {
  const externalSessionIds = input.externalSessionIds ?? [input.externalSessionId ?? "session-1"];
  const externalSessionId = externalSessionIds[0] ?? "session-1";
  const nativeRequestId = input.nativeRequestId ?? "native-request-1";
  const callOrder: string[] = [];
  const messageCalls: unknown[] = [];
  const promptCalls: unknown[] = [];
  const permissionReplyCalls: unknown[] = [];
  const questionReplyCalls: unknown[] = [];
  let permissionReplyError: unknown | null = null;
  let pendingApproval = input.pendingQuestion !== true;
  let pendingQuestion = input.pendingQuestion === true;
  let signal: AbortSignal | null = null;
  const queuedEvents: QueuedStreamEntry[] = [];
  let wakeStream: (() => void) | null = null;

  const client = {
    session: {
      list: async () => {
        callOrder.push("list");
        input.onList?.();
        await input.listBarrier;
        return {
          data: externalSessionIds.map((sessionId) => ({
            id: sessionId,
            directory: "/repo",
            title: "Live session",
            time: { created: Date.parse("2026-07-16T10:00:00.000Z") },
          })),
          error: undefined,
        };
      },
      status: async () => ({
        data: Object.fromEntries(
          externalSessionIds.map((sessionId) => [sessionId, { type: "idle" }]),
        ),
        error: undefined,
      }),
      messages: async (request: unknown) => {
        messageCalls.push(request);
        input.onMessages?.();
        await input.messagesBarrier;
        return {
          data:
            typeof input.totalTokens === "number"
              ? [
                  {
                    info: {
                      id: "assistant-latest",
                      role: "assistant",
                      providerID: "openai",
                      modelID: "gpt-5",
                      tokens: { input: input.totalTokens - 100, output: 100 },
                      time: { created: Date.parse("2026-07-16T10:01:00.000Z") },
                    },
                    parts: [],
                  },
                ]
              : [],
          error: undefined,
        };
      },
      promptAsync: async (request: unknown) => {
        promptCalls.push(request);
        return { data: {}, error: undefined };
      },
    },
    permission: {
      list: async () => {
        const data = pendingApproval
          ? externalSessionIds.map((sessionId) => ({
              id: nativeRequestId,
              sessionID: sessionId,
              permission: "read",
              patterns: ["README.md"],
            }))
          : [];
        input.onPermissionList?.();
        if (typeof input.permissionListBarrier === "function") {
          await input.permissionListBarrier();
        } else {
          await input.permissionListBarrier;
        }
        input.onPermissionListSettled?.();
        return { data, error: undefined };
      },
      reply: async (request: unknown) => {
        permissionReplyCalls.push(request);
        if (permissionReplyError) {
          return { data: undefined, error: permissionReplyError };
        }
        pendingApproval = false;
        return { data: true, error: undefined };
      },
    },
    question: {
      list: async () => {
        const data = pendingQuestion
          ? [
              {
                id: nativeRequestId,
                sessionID: externalSessionId,
                questions: [
                  {
                    header: "Confirm",
                    question: "Continue?",
                    options: [{ label: "Yes", description: "Continue" }],
                  },
                ],
              },
            ]
          : [];
        input.onQuestionList?.();
        if (typeof input.questionListBarrier === "function") {
          await input.questionListBarrier();
        } else {
          await input.questionListBarrier;
        }
        input.onQuestionListSettled?.();
        return { data, error: undefined };
      },
      reply: async (request: unknown) => {
        questionReplyCalls.push(request);
        pendingQuestion = false;
        return { data: true, error: undefined };
      },
    },
    global: {
      event: async (options?: { signal?: AbortSignal }) => {
        callOrder.push("subscribe");
        signal = options?.signal ?? null;
        async function* events(): AsyncGenerator<{ directory: string; payload: Event }> {
          try {
            while (!options?.signal?.aborted) {
              if (queuedEvents.length === 0) {
                await new Promise<void>((resolve) => {
                  wakeStream = resolve;
                  options?.signal?.addEventListener("abort", resolve, { once: true });
                });
              }
              const entry = queuedEvents.shift();
              if (!entry) {
                continue;
              }
              if (entry.type === "complete") {
                entry.consumed();
                return;
              }
              if (entry.type === "failure") {
                entry.consumed();
                throw entry.error;
              }
              yield { directory: "/repo", payload: entry.event };
              entry.consumed?.();
            }
          } finally {
            await input.streamCloseBarrier;
          }
        }
        return { stream: events() };
      },
    },
    mcp: {
      status: async () => ({
        data: { openducktor: { status: "connected" } },
        error: undefined,
      }),
    },
    tool: {
      ids: async () => ({ data: [], error: undefined }),
    },
  } as unknown as OpencodeClient;

  return {
    client,
    callOrder,
    messageCalls,
    promptCalls,
    permissionReplyCalls,
    questionReplyCalls,
    setPermissionReplyError: (error) => {
      permissionReplyError = error;
    },
    setPendingApproval: (pending) => {
      pendingApproval = pending;
    },
    emit: (event) => {
      queuedEvents.push({ type: "event", event });
      wakeStream?.();
      wakeStream = null;
    },
    emitAndWait: (event) =>
      new Promise<void>((resolve) => {
        queuedEvents.push({ type: "event", event, consumed: resolve });
        wakeStream?.();
        wakeStream = null;
      }),
    completeStream: () =>
      new Promise<void>((resolve) => {
        queuedEvents.push({ type: "complete", consumed: resolve });
        wakeStream?.();
        wakeStream = null;
      }),
    failStream: (error) =>
      new Promise<void>((resolve) => {
        queuedEvents.push({ type: "failure", error, consumed: resolve });
        wakeStream?.();
        wakeStream = null;
      }),
    streamSignal: () => signal,
  };
};

describe("OpenCode live session controller", () => {
  test("constructs with the production SDK client factory by default", () => {
    expect(() => createOpencodeLiveSessionController()).not.toThrow();
  });

  test("shares one observation for control and emits a user transcript exactly once", async () => {
    const harness = createLiveClientHarness();
    harness.setPendingApproval(false);
    const controller = createOpencodeLiveSessionController({
      createClient: () => harness.client,
      now: () => "2026-07-16T10:02:00.000Z",
    });
    const attachment = await controller.initializeRuntime({
      repoPath: "/repo",
      runtimeKind: "opencode",
      runtimeId: "runtime-1",
      runtimeEndpoint: "http://runtime-1",
      directories: ["/repo"],
    });
    const transcriptEvents: OpencodeLiveSessionChange[] = [];
    let resolveAssistant: () => void = () => undefined;
    const assistantDelivered = new Promise<void>((resolve) => {
      resolveAssistant = resolve;
    });
    await attachment.startForwarding((change) => {
      if (change.type !== "transcript_event") {
        return;
      }
      transcriptEvents.push(change);
      if (change.event.type === "assistant_message") {
        resolveAssistant();
      }
    });

    const accepted = await controller.sendUserMessage("runtime-1", {
      repoPath: "/repo",
      runtimeKind: "opencode",
      runtimePolicy: { kind: "opencode" },
      workingDirectory: "/repo",
      externalSessionId: "session-1",
      sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      systemPrompt: "Build carefully.",
      parts: [{ kind: "text", text: "Implement the feature." }],
    });
    harness.emit({
      type: "message.updated",
      properties: {
        info: {
          id: accepted.messageId,
          sessionID: "session-1",
          role: "user",
          time: { created: Date.parse("2026-07-16T10:02:00.000Z") },
        },
        parts: [
          {
            id: "user-text",
            sessionID: "session-1",
            messageID: accepted.messageId,
            type: "text",
            text: "Implement the feature.",
          },
        ],
      },
    } as unknown as Event);
    harness.emit({
      type: "message.updated",
      properties: {
        info: {
          id: "assistant-after-user",
          sessionID: "session-1",
          role: "assistant",
          finish: "stop",
          time: { completed: Date.parse("2026-07-16T10:02:01.000Z") },
        },
        parts: [
          {
            id: "assistant-after-user-text",
            sessionID: "session-1",
            messageID: "assistant-after-user",
            type: "text",
            text: "Done.",
            time: { start: 1, end: 2 },
          },
        ],
      },
    } as unknown as Event);
    await Promise.race([
      assistantDelivered,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Expected the assistant event.")), 500);
      }),
    ]);

    expect(harness.callOrder.filter((entry) => entry === "subscribe")).toHaveLength(1);
    expect(harness.promptCalls).toHaveLength(1);
    expect(
      transcriptEvents.filter(
        (change) => change.type === "transcript_event" && change.event.type === "user_message",
      ),
    ).toHaveLength(1);
    expect(
      transcriptEvents.map((change) =>
        change.type === "transcript_event" ? change.event.type : change.type,
      ),
    ).toEqual(["user_message", "assistant_message"]);
    await attachment.release();
  });

  test("subscribes before authoritative initialization without loading history", async () => {
    const harness = createLiveClientHarness();
    const controller = createOpencodeLiveSessionController({
      createClient: () => harness.client,
      now: () => "2026-07-16T10:02:00.000Z",
    });

    const attachment = await controller.initializeRuntime({
      repoPath: "/repo",
      runtimeKind: "opencode",
      runtimeId: "runtime-1",
      runtimeEndpoint: "http://runtime-1",
      directories: ["/repo"],
    });

    expect(harness.callOrder.slice(0, 2)).toEqual(["subscribe", "list"]);
    expect(harness.messageCalls).toEqual([]);
    expect(attachment.snapshots).toHaveLength(1);
    expect(attachment.snapshots[0]).toMatchObject({
      runtimeId: "runtime-1",
      ref: {
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo",
        externalSessionId: "session-1",
      },
      activity: "waiting_for_permission",
      contextUsage: null,
      pendingApprovals: [{ requestId: expect.any(String) }],
      pendingQuestions: [],
    });
    expect(attachment.snapshots[0]?.pendingApprovals[0]?.requestId).not.toBe("native-request-1");

    await attachment.release();
    expect(harness.streamSignal()?.aborted).toBe(true);
  });

  test("can restart a runtime while its released event iterator is still closing", async () => {
    let finishClosingStream: () => void = () => undefined;
    const streamCloseBarrier = new Promise<void>((resolve) => {
      finishClosingStream = resolve;
    });
    const harness = createLiveClientHarness({ streamCloseBarrier });
    const controller = createOpencodeLiveSessionController({
      createClient: () => harness.client,
      now: () => "2026-07-16T10:02:00.000Z",
    });
    const input = {
      repoPath: "/repo",
      runtimeKind: "opencode" as const,
      runtimeId: "runtime-1",
      runtimeEndpoint: "http://runtime-1",
      directories: ["/repo"],
    };

    const firstAttachment = await controller.initializeRuntime(input);
    await firstAttachment.release();
    const secondAttachment = await controller.initializeRuntime(input);

    expect(harness.callOrder.filter((entry) => entry === "subscribe")).toHaveLength(2);
    finishClosingStream();
    await secondAttachment.release();
  });

  test("clears one runtime and aggregates independent cleanup failures", async () => {
    const firstHarness = createLiveClientHarness();
    const secondHarness = createLiveClientHarness();
    const controller = createOpencodeLiveSessionController({
      createClient: ({ runtimeEndpoint }) =>
        runtimeEndpoint === "http://runtime-2" ? secondHarness.client : firstHarness.client,
      now: () => "2026-07-16T10:02:00.000Z",
    });
    await controller.initializeRuntime({
      repoPath: "/repo",
      runtimeKind: "opencode",
      runtimeId: "runtime-1",
      runtimeEndpoint: "http://runtime-1",
      directories: ["/repo"],
    });
    const secondAttachment = await controller.initializeRuntime({
      repoPath: "/repo",
      runtimeKind: "opencode",
      runtimeId: "runtime-2",
      runtimeEndpoint: "http://runtime-2",
      directories: ["/repo"],
    });
    const internals = controller as unknown as {
      runtimeEventTransports: Map<string, RuntimeEventTransportRecord>;
      runtimes: Map<
        string,
        {
          sessions: Map<unknown, unknown>;
          eventSessions: Map<unknown, unknown>;
          routesByOccurrenceId: Map<unknown, unknown>;
          occurrenceIdByNativeKey: Map<unknown, unknown>;
          contextUsageBySessionId: Map<unknown, unknown>;
          contextLoads: Map<unknown, unknown>;
          pendingChanges: unknown[];
          pendingTranscriptChanges: unknown[];
          bufferedEventsBeforeSubscribers: unknown[];
          initializationEvents: unknown[];
          observation: unknown;
        }
      >;
    };
    const firstState = internals.runtimes.get("runtime-1");
    const firstTransport = internals.runtimeEventTransports.get("runtime-1");
    if (!firstState || !firstTransport) {
      throw new Error("Expected the first OpenCode runtime internals.");
    }
    const deleteSubscriber = firstTransport.subscribers.delete.bind(firstTransport.subscribers);
    firstTransport.subscribers.delete = (externalSessionId) => {
      deleteSubscriber(externalSessionId);
      throw new Error("session cleanup failed");
    };
    const abortObservation = firstTransport.controller.abort.bind(firstTransport.controller);
    firstTransport.controller.abort = () => {
      throw new Error("observation cleanup failed");
    };

    try {
      let releaseError: unknown;
      try {
        await controller.releaseRuntime("runtime-1");
      } catch (error) {
        releaseError = error;
      }
      expect(releaseError).toBeInstanceOf(AggregateError);
      expect(releaseError instanceof Error ? releaseError.message : "").toContain(
        "session cleanup failed",
      );
      expect(releaseError instanceof Error ? releaseError.message : "").toContain(
        "observation cleanup failed",
      );
      expect(() => controller.readRuntimeSnapshots("runtime-1")).toThrow(
        "Unknown OpenCode live runtime 'runtime-1'",
      );
      expect(firstState.sessions.size).toBe(0);
      expect(firstState.eventSessions.size).toBe(0);
      expect(firstState.routesByOccurrenceId.size).toBe(0);
      expect(firstState.occurrenceIdByNativeKey.size).toBe(0);
      expect(firstState.contextUsageBySessionId.size).toBe(0);
      expect(firstState.contextLoads.size).toBe(0);
      expect(firstState.pendingChanges).toEqual([]);
      expect(firstState.pendingTranscriptChanges).toEqual([]);
      expect(firstState.bufferedEventsBeforeSubscribers).toEqual([]);
      expect(firstState.initializationEvents).toEqual([]);
      expect(firstState.observation).toBeNull();
      expect(controller.readRuntimeSnapshots("runtime-2")).toHaveLength(1);
      expect(secondHarness.streamSignal()?.aborted).toBe(false);
    } finally {
      abortObservation();
      await secondAttachment.release();
    }
  });

  test("attempts every session cleanup when one runtime session release fails", async () => {
    const harness = createLiveClientHarness({
      externalSessionIds: ["session-a", "session-b"],
    });
    const controller = createOpencodeLiveSessionController({
      createClient: () => harness.client,
      now: () => "2026-07-16T10:02:00.000Z",
    });
    await controller.initializeRuntime({
      repoPath: "/repo",
      runtimeKind: "opencode",
      runtimeId: "runtime-1",
      runtimeEndpoint: "http://runtime-1",
      directories: ["/repo"],
    });
    const internals = controller as unknown as {
      runtimeEventTransports: Map<string, RuntimeEventTransportRecord>;
      runtimes: Map<string, { eventSessions: Map<unknown, unknown> }>;
    };
    const state = internals.runtimes.get("runtime-1");
    const transport = internals.runtimeEventTransports.get("runtime-1");
    if (!state || !transport) {
      throw new Error("Expected OpenCode runtime internals.");
    }
    const attemptedSessionIds: string[] = [];
    const deleteSubscriber = transport.subscribers.delete.bind(transport.subscribers);
    transport.subscribers.delete = (externalSessionId) => {
      attemptedSessionIds.push(externalSessionId);
      const deleted = deleteSubscriber(externalSessionId);
      if (externalSessionId === "session-a") {
        throw new Error("session-a cleanup failed");
      }
      return deleted;
    };

    let releaseError: unknown;
    try {
      await controller.releaseRuntime("runtime-1");
    } catch (error) {
      releaseError = error;
    }

    expect(releaseError).toBeInstanceOf(AggregateError);
    expect(releaseError instanceof Error ? releaseError.message : "").toContain(
      "session-a cleanup failed",
    );
    expect(attemptedSessionIds).toEqual(["session-a", "session-b"]);
    expect(state.eventSessions.size).toBe(0);
    expect(() => controller.readRuntimeSnapshots("runtime-1")).toThrow(
      "Unknown OpenCode live runtime 'runtime-1'",
    );
  });

  test("buffers normalized transcript events until forwarding starts and preserves listener order", async () => {
    let releaseList: () => void = () => undefined;
    let resolveListStarted: () => void = () => undefined;
    const listBarrier = new Promise<void>((resolve) => {
      releaseList = resolve;
    });
    const listStarted = new Promise<void>((resolve) => {
      resolveListStarted = resolve;
    });
    const harness = createLiveClientHarness({ listBarrier, onList: resolveListStarted });
    const controller = createOpencodeLiveSessionController({
      createClient: () => harness.client,
      now: () => "2026-07-16T10:02:00.000Z",
    });

    const initializing = controller.initializeRuntime({
      repoPath: "/repo",
      runtimeKind: "opencode",
      runtimeId: "runtime-1",
      runtimeEndpoint: "http://runtime-1",
      directories: ["/repo"],
    });
    await listStarted;
    harness.emit({
      type: "message.updated",
      properties: {
        info: {
          id: "assistant-buffered",
          sessionID: "session-1",
          role: "assistant",
          finish: "stop",
          time: { completed: Date.parse("2026-07-16T10:01:00.000Z") },
        },
        parts: [
          {
            id: "assistant-buffered-text",
            sessionID: "session-1",
            messageID: "assistant-buffered",
            type: "text",
            text: "Buffered transcript",
            time: { start: 1, end: 2 },
          },
        ],
      },
    } as unknown as Event);
    releaseList();

    const attachment = await initializing;
    let releaseFirstChange: () => void = () => undefined;
    let resolveFirstChange: () => void = () => undefined;
    const firstChangeBarrier = new Promise<void>((resolve) => {
      releaseFirstChange = resolve;
    });
    const firstChangeStarted = new Promise<void>((resolve) => {
      resolveFirstChange = resolve;
    });
    const messages: string[] = [];
    const routedSessionIds: string[] = [];
    const routedRuntimeIds: string[] = [];
    let resolveLiveChange: () => void = () => undefined;
    const liveChangeDelivered = new Promise<void>((resolve) => {
      resolveLiveChange = resolve;
    });
    let forwardingSettled = false;
    const forwarding = attachment
      .startForwarding(async (change) => {
        if (change.type !== "transcript_event" || change.event.type !== "assistant_message") {
          return;
        }
        messages.push(change.event.message);
        routedSessionIds.push(change.ref.externalSessionId);
        routedRuntimeIds.push(change.runtimeId);
        if (change.event.message === "Buffered transcript") {
          resolveFirstChange();
          await firstChangeBarrier;
        }
        if (change.event.message === "Live transcript") {
          resolveLiveChange();
        }
      })
      .then(() => {
        forwardingSettled = true;
      });
    await firstChangeStarted;

    harness.emit({
      type: "message.updated",
      properties: {
        info: {
          id: "assistant-live",
          sessionID: "session-1",
          role: "assistant",
          finish: "stop",
          time: { completed: Date.parse("2026-07-16T10:01:01.000Z") },
        },
        parts: [
          {
            id: "assistant-live-text",
            sessionID: "session-1",
            messageID: "assistant-live",
            type: "text",
            text: "Live transcript",
            time: { start: 3, end: 4 },
          },
        ],
      },
    } as unknown as Event);
    await Promise.resolve();
    expect(forwardingSettled).toBe(false);
    expect(messages).toEqual(["Buffered transcript"]);

    releaseFirstChange();
    await forwarding;
    await Promise.race([
      liveChangeDelivered,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Expected the live transcript event.")), 500);
      }),
    ]);
    expect(messages).toEqual(["Buffered transcript", "Live transcript"]);
    expect(routedSessionIds).toEqual(["session-1", "session-1"]);
    expect(routedRuntimeIds).toEqual(["runtime-1", "runtime-1"]);
    await attachment.release();
  });

  test("includes a request created after the initial pending read exactly once", async () => {
    let releasePendingRead: () => void = () => undefined;
    let resolvePendingReadStarted: () => void = () => undefined;
    const pendingReadBarrier = new Promise<void>((resolve) => {
      releasePendingRead = resolve;
    });
    const pendingReadStarted = new Promise<void>((resolve) => {
      resolvePendingReadStarted = resolve;
    });
    const harness = createLiveClientHarness({
      permissionListBarrier: pendingReadBarrier,
      onPermissionList: resolvePendingReadStarted,
    });
    harness.setPendingApproval(false);
    const controller = createOpencodeLiveSessionController({
      createClient: () => harness.client,
      now: () => "2026-07-16T10:02:00.000Z",
    });
    const initializing = controller.initializeRuntime({
      repoPath: "/repo",
      runtimeKind: "opencode",
      runtimeId: "runtime-1",
      runtimeEndpoint: "http://runtime-1",
      directories: ["/repo"],
    });
    await pendingReadStarted;
    harness.setPendingApproval(true);
    harness.emit({
      type: "permission.asked",
      properties: {
        id: "native-request-1",
        sessionID: "session-1",
        permission: "read",
        patterns: ["README.md"],
      },
    } as unknown as Event);
    releasePendingRead();

    const attachment = await initializing;
    expect(attachment.snapshots[0]?.pendingApprovals).toHaveLength(1);
    const replayedChanges: OpencodeLiveSessionChange[] = [];
    await attachment.startForwarding((change) => {
      replayedChanges.push(change);
    });
    expect(replayedChanges).toEqual([]);
    await attachment.release();
  });

  test("does not resurrect a request resolved after the initial pending read", async () => {
    let releasePendingRead: () => void = () => undefined;
    let resolvePendingReadStarted: () => void = () => undefined;
    const pendingReadBarrier = new Promise<void>((resolve) => {
      releasePendingRead = resolve;
    });
    const pendingReadStarted = new Promise<void>((resolve) => {
      resolvePendingReadStarted = resolve;
    });
    const harness = createLiveClientHarness({
      permissionListBarrier: pendingReadBarrier,
      onPermissionList: resolvePendingReadStarted,
    });
    const controller = createOpencodeLiveSessionController({
      createClient: () => harness.client,
      now: () => "2026-07-16T10:02:00.000Z",
    });
    const initializing = controller.initializeRuntime({
      repoPath: "/repo",
      runtimeKind: "opencode",
      runtimeId: "runtime-1",
      runtimeEndpoint: "http://runtime-1",
      directories: ["/repo"],
    });
    await pendingReadStarted;
    harness.setPendingApproval(false);
    harness.emit({
      type: "permission.replied",
      properties: {
        requestID: "native-request-1",
        sessionID: "session-1",
      },
    } as unknown as Event);
    releasePendingRead();

    const attachment = await initializing;
    expect(attachment.snapshots[0]?.pendingApprovals).toEqual([]);
    await attachment.release();
  });

  test("does not lose a request at the final initialization handoff", async () => {
    let releasePendingRead: () => void = () => undefined;
    let resolvePendingReadStarted: () => void = () => undefined;
    const pendingReadBarrier = new Promise<void>((resolve) => {
      releasePendingRead = resolve;
    });
    const pendingReadStarted = new Promise<void>((resolve) => {
      resolvePendingReadStarted = resolve;
    });
    const harness = createLiveClientHarness({
      permissionListBarrier: pendingReadBarrier,
      onPermissionList: resolvePendingReadStarted,
    });
    harness.setPendingApproval(false);
    const controller = createOpencodeLiveSessionController({
      createClient: () => harness.client,
      now: () => "2026-07-16T10:02:00.000Z",
    });
    const initializing = controller.initializeRuntime({
      repoPath: "/repo",
      runtimeKind: "opencode",
      runtimeId: "runtime-1",
      runtimeEndpoint: "http://runtime-1",
      directories: ["/repo"],
    });
    await pendingReadStarted;
    releasePendingRead();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    harness.setPendingApproval(true);
    harness.emit({
      type: "permission.asked",
      properties: {
        id: "native-request-1",
        sessionID: "session-1",
        permission: "read",
        patterns: ["README.md"],
      },
    } as unknown as Event);

    const attachment = await initializing;
    const replayedChanges: OpencodeLiveSessionChange[] = [];
    let resolvePendingRepresented: () => void = () => undefined;
    const pendingRepresented = new Promise<void>((resolve) => {
      resolvePendingRepresented = resolve;
    });
    await attachment.startForwarding((change) => {
      replayedChanges.push(change);
      if (change.type === "session_upsert" && change.snapshot.pendingApprovals.length > 0) {
        resolvePendingRepresented();
      }
    });
    if (attachment.snapshots.every((snapshot) => snapshot.pendingApprovals.length === 0)) {
      await Promise.race([
        pendingRepresented,
        new Promise<never>((_, reject) => {
          setTimeout(
            () => reject(new Error("Expected the handoff request to be represented.")),
            500,
          );
        }),
      ]);
    }
    const representedRequests = [
      ...attachment.snapshots.flatMap((snapshot) => snapshot.pendingApprovals),
      ...replayedChanges.flatMap((change) =>
        change.type === "session_upsert" ? change.snapshot.pendingApprovals : [],
      ),
    ];
    expect(representedRequests).toHaveLength(1);
    await attachment.release();
  });

  test("serializes an approval reply behind an in-flight authoritative refresh", async () => {
    let gateRefresh = false;
    let releaseRefresh: () => void = () => undefined;
    let resolveRefreshStarted: () => void = () => undefined;
    const refreshBarrier = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const refreshStarted = new Promise<void>((resolve) => {
      resolveRefreshStarted = resolve;
    });
    const harness = createLiveClientHarness({
      permissionListBarrier: async () => {
        if (gateRefresh) {
          await refreshBarrier;
        }
      },
      onPermissionList: () => {
        if (gateRefresh) {
          resolveRefreshStarted();
        }
      },
    });
    const controller = createOpencodeLiveSessionController({
      createClient: () => harness.client,
      now: () => "2026-07-16T10:02:00.000Z",
    });
    const attachment = await controller.initializeRuntime({
      repoPath: "/repo",
      runtimeKind: "opencode",
      runtimeId: "runtime-1",
      runtimeEndpoint: "http://runtime-1",
      directories: ["/repo"],
    });
    const snapshot = attachment.snapshots[0];
    const occurrenceId = snapshot?.pendingApprovals[0]?.requestId;
    if (!snapshot || !occurrenceId) {
      throw new Error("Expected pending approval.");
    }

    gateRefresh = true;
    const refreshing = harness.emitAndWait({
      type: "session.updated",
      properties: {
        info: { id: "session-1", directory: "/repo", title: "Live session" },
      },
    } as unknown as Event);
    await refreshStarted;
    const replying = controller.replyApproval({
      runtimeId: "runtime-1",
      ref: snapshot.ref,
      requestId: occurrenceId,
      outcome: "approve_once",
    });
    const replyCallsBeforeRefreshSettled = harness.permissionReplyCalls.length;

    releaseRefresh();
    await Promise.all([refreshing, replying]);
    expect(replyCallsBeforeRefreshSettled).toBe(0);
    expect(controller.readRuntimeSnapshots("runtime-1")[0]?.pendingApprovals).toEqual([]);
    await attachment.release();
  });

  test("serializes a question reply behind an in-flight authoritative refresh", async () => {
    let gateRefresh = false;
    let releaseRefresh: () => void = () => undefined;
    let resolveRefreshStarted: () => void = () => undefined;
    const refreshBarrier = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const refreshStarted = new Promise<void>((resolve) => {
      resolveRefreshStarted = resolve;
    });
    const harness = createLiveClientHarness({
      pendingQuestion: true,
      questionListBarrier: async () => {
        if (gateRefresh) {
          await refreshBarrier;
        }
      },
      onQuestionList: () => {
        if (gateRefresh) {
          resolveRefreshStarted();
        }
      },
    });
    const controller = createOpencodeLiveSessionController({
      createClient: () => harness.client,
      now: () => "2026-07-16T10:02:00.000Z",
    });
    const attachment = await controller.initializeRuntime({
      repoPath: "/repo",
      runtimeKind: "opencode",
      runtimeId: "runtime-1",
      runtimeEndpoint: "http://runtime-1",
      directories: ["/repo"],
    });
    const snapshot = attachment.snapshots[0];
    const occurrenceId = snapshot?.pendingQuestions[0]?.requestId;
    if (!snapshot || !occurrenceId) {
      throw new Error("Expected pending question.");
    }

    gateRefresh = true;
    const refreshing = harness.emitAndWait({
      type: "session.updated",
      properties: {
        info: { id: "session-1", directory: "/repo", title: "Live session" },
      },
    } as unknown as Event);
    await refreshStarted;
    const replying = controller.replyQuestion({
      runtimeId: "runtime-1",
      ref: snapshot.ref,
      requestId: occurrenceId,
      answers: [["Yes"]],
    });
    const replyCallsBeforeRefreshSettled = harness.questionReplyCalls.length;

    releaseRefresh();
    await Promise.all([refreshing, replying]);
    expect(replyCallsBeforeRefreshSettled).toBe(0);
    expect(controller.readRuntimeSnapshots("runtime-1")[0]?.pendingQuestions).toEqual([]);
    await attachment.release();
  });

  test("reports unexpected observation completion without faulting an intentional release", async () => {
    const harness = createLiveClientHarness();
    const controller = createOpencodeLiveSessionController({
      createClient: () => harness.client,
      now: () => "2026-07-16T10:02:00.000Z",
    });
    const attachment = await controller.initializeRuntime({
      repoPath: "/repo",
      runtimeKind: "opencode",
      runtimeId: "runtime-1",
      runtimeEndpoint: "http://runtime-1",
      directories: ["/repo"],
    });
    let resolveFault: (change: OpencodeLiveSessionChange) => void = () => undefined;
    const fault = new Promise<OpencodeLiveSessionChange>((resolve) => {
      resolveFault = resolve;
    });
    await attachment.startForwarding((change) => {
      if (change.type === "runtime_fault") {
        resolveFault(change);
      }
    });

    await harness.completeStream();
    const terminalChange = await Promise.race([
      fault,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Expected an OpenCode observation fault.")), 500);
      }),
    ]);
    expect(terminalChange).toEqual({
      type: "runtime_fault",
      runtimeId: "runtime-1",
      message: "OpenCode live event observation ended unexpectedly.",
    });
    await attachment.release();

    const intentional = createLiveClientHarness();
    const intentionalController = createOpencodeLiveSessionController({
      createClient: () => intentional.client,
      now: () => "2026-07-16T10:02:00.000Z",
    });
    const intentionalAttachment = await intentionalController.initializeRuntime({
      repoPath: "/repo",
      runtimeKind: "opencode",
      runtimeId: "runtime-2",
      runtimeEndpoint: "http://runtime-2",
      directories: ["/repo"],
    });
    const intentionalChanges: OpencodeLiveSessionChange[] = [];
    await intentionalAttachment.startForwarding((change) => {
      intentionalChanges.push(change);
    });
    await intentionalAttachment.release();
    await Promise.resolve();
    expect(intentionalChanges).not.toContainEqual(
      expect.objectContaining({ type: "runtime_fault" }),
    );
  });

  test("normalizes an observation failure into an actionable terminal fault", async () => {
    const harness = createLiveClientHarness();
    const controller = createOpencodeLiveSessionController({
      createClient: () => harness.client,
      now: () => "2026-07-16T10:02:00.000Z",
    });
    const attachment = await controller.initializeRuntime({
      repoPath: "/repo",
      runtimeKind: "opencode",
      runtimeId: "runtime-1",
      runtimeEndpoint: "http://runtime-1",
      directories: ["/repo"],
    });
    let resolveFault: (change: OpencodeLiveSessionChange) => void = () => undefined;
    const fault = new Promise<OpencodeLiveSessionChange>((resolve) => {
      resolveFault = resolve;
    });
    await attachment.startForwarding((change) => {
      if (change.type === "runtime_fault") {
        resolveFault(change);
      }
    });

    await harness.failStream(new Error("connection lost"));
    const terminalChange = await Promise.race([
      fault,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Expected an OpenCode observation fault.")), 500);
      }),
    ]);
    expect(terminalChange).toEqual({
      type: "runtime_fault",
      runtimeId: "runtime-1",
      message: "OpenCode live event observation failed: connection lost",
    });
    await attachment.release();
  });

  test("retains context from live assistant message events without reading messages", async () => {
    const harness = createLiveClientHarness();
    const controller = createOpencodeLiveSessionController({
      createClient: () => harness.client,
      now: () => "2026-07-16T10:02:00.000Z",
    });
    let resolveContextChange: () => void = () => undefined;
    const contextChanged = new Promise<void>((resolve) => {
      resolveContextChange = resolve;
    });
    const attachment = await controller.initializeRuntime({
      repoPath: "/repo",
      runtimeKind: "opencode",
      runtimeId: "runtime-1",
      runtimeEndpoint: "http://runtime-1",
      directories: ["/repo"],
    });
    await attachment.startForwarding((change) => {
      if (change.type === "session_upsert" && change.snapshot.contextUsage) {
        resolveContextChange();
      }
    });

    harness.emit({
      type: "message.updated",
      properties: {
        info: {
          id: "assistant-1",
          sessionID: "session-1",
          role: "assistant",
          providerID: "openai",
          modelID: "gpt-5",
          tokens: { input: 900, output: 100 },
          time: { created: Date.parse("2026-07-16T10:01:00.000Z") },
        },
      },
    } as unknown as Event);
    await contextChanged;

    expect(controller.readRuntimeSnapshots("runtime-1")[0]?.contextUsage).toEqual({
      totalTokens: 1_000,
      model: { providerId: "openai", modelId: "gpt-5" },
    });
    expect(harness.messageCalls).toEqual([]);
    expect(harness.callOrder.filter((entry) => entry === "list")).toHaveLength(1);
    await attachment.release();
  });

  test("loads genuinely missing context with one latest-message request", async () => {
    const harness = createLiveClientHarness({ totalTokens: 1_000 });
    const controller = createOpencodeLiveSessionController({
      createClient: () => harness.client,
      now: () => "2026-07-16T10:02:00.000Z",
    });
    const attachment = await controller.initializeRuntime({
      repoPath: "/repo",
      runtimeKind: "opencode",
      runtimeId: "runtime-1",
      runtimeEndpoint: "http://runtime-1",
      directories: ["/repo"],
    });

    const contextUsage = await controller.loadSessionContextUsage("runtime-1", {
      repoPath: "/repo",
      runtimeKind: "opencode",
      workingDirectory: "/repo",
      externalSessionId: "session-1",
    });

    expect(contextUsage).toEqual({
      totalTokens: 1_000,
      model: { providerId: "openai", modelId: "gpt-5" },
    });
    expect(harness.messageCalls).toEqual([
      { directory: "/repo", sessionID: "session-1", limit: 1 },
    ]);
    await attachment.release();
  });

  test("does not overwrite live context received during a latest-message request", async () => {
    let releaseMessages: () => void = () => undefined;
    let resolveMessagesStarted: () => void = () => undefined;
    const messagesBarrier = new Promise<void>((resolve) => {
      releaseMessages = resolve;
    });
    const messagesStarted = new Promise<void>((resolve) => {
      resolveMessagesStarted = resolve;
    });
    const harness = createLiveClientHarness({
      totalTokens: 1_000,
      messagesBarrier,
      onMessages: resolveMessagesStarted,
    });
    const controller = createOpencodeLiveSessionController({
      createClient: () => harness.client,
      now: () => "2026-07-16T10:02:00.000Z",
    });
    const attachment = await controller.initializeRuntime({
      repoPath: "/repo",
      runtimeKind: "opencode",
      runtimeId: "runtime-1",
      runtimeEndpoint: "http://runtime-1",
      directories: ["/repo"],
    });
    let resolveLiveContext: () => void = () => undefined;
    const liveContextApplied = new Promise<void>((resolve) => {
      resolveLiveContext = resolve;
    });
    await attachment.startForwarding((change) => {
      if (change.type === "session_upsert" && change.snapshot.contextUsage?.totalTokens === 2_000) {
        resolveLiveContext();
      }
    });
    const ref = attachment.snapshots[0]?.ref;
    if (!ref) {
      throw new Error("Expected live session snapshot");
    }

    const loading = controller.loadSessionContextUsage("runtime-1", ref);
    await messagesStarted;
    harness.emit({
      type: "message.updated",
      properties: {
        info: {
          id: "assistant-live-context",
          sessionID: "session-1",
          role: "assistant",
          providerID: "openai",
          modelID: "gpt-5",
          tokens: { input: 1_900, output: 100 },
        },
      },
    } as unknown as Event);
    await liveContextApplied;
    releaseMessages();

    await expect(loading).resolves.toEqual({
      totalTokens: 2_000,
      model: { providerId: "openai", modelId: "gpt-5" },
    });
    expect(controller.readRuntimeSnapshots("runtime-1")[0]?.contextUsage?.totalTokens).toBe(2_000);
    await attachment.release();
  });

  test("fails an in-flight context load when its runtime is released", async () => {
    let releaseMessages: () => void = () => undefined;
    let resolveMessagesStarted: () => void = () => undefined;
    const messagesBarrier = new Promise<void>((resolve) => {
      releaseMessages = resolve;
    });
    const messagesStarted = new Promise<void>((resolve) => {
      resolveMessagesStarted = resolve;
    });
    const harness = createLiveClientHarness({
      messagesBarrier,
      onMessages: resolveMessagesStarted,
    });
    const controller = createOpencodeLiveSessionController({
      createClient: () => harness.client,
      now: () => "2026-07-16T10:02:00.000Z",
    });
    const attachment = await controller.initializeRuntime({
      repoPath: "/repo",
      runtimeKind: "opencode",
      runtimeId: "runtime-1",
      runtimeEndpoint: "http://runtime-1",
      directories: ["/repo"],
    });
    const ref = attachment.snapshots[0]?.ref;
    if (!ref) {
      throw new Error("Expected live session snapshot");
    }

    const loading = controller.loadSessionContextUsage("runtime-1", ref);
    await messagesStarted;
    const releasing = attachment.release();
    releaseMessages();

    await releasing;
    await expect(loading).rejects.toThrow(
      "OpenCode runtime 'runtime-1' was released while context usage was loading",
    );
  });

  test("isolates equal native request ids across runtimes and runtime shutdown", async () => {
    const runtimeA = createLiveClientHarness({
      externalSessionId: "session-a",
      nativeRequestId: "shared-native-id",
    });
    const runtimeB = createLiveClientHarness({
      externalSessionId: "session-b",
      nativeRequestId: "shared-native-id",
    });
    const controller = createOpencodeLiveSessionController({
      createClient: ({ runtimeEndpoint }) =>
        runtimeEndpoint === "http://runtime-a" ? runtimeA.client : runtimeB.client,
      now: () => "2026-07-16T10:02:00.000Z",
    });
    const attachmentA = await controller.initializeRuntime({
      repoPath: "/repo",
      runtimeKind: "opencode",
      runtimeId: "runtime-a",
      runtimeEndpoint: "http://runtime-a",
      directories: ["/repo"],
    });
    const attachmentB = await controller.initializeRuntime({
      repoPath: "/repo",
      runtimeKind: "opencode",
      runtimeId: "runtime-b",
      runtimeEndpoint: "http://runtime-b",
      directories: ["/repo"],
    });
    const snapshotA = attachmentA.snapshots[0];
    const snapshotB = attachmentB.snapshots[0];
    const occurrenceA = snapshotA?.pendingApprovals[0]?.requestId;
    const occurrenceB = snapshotB?.pendingApprovals[0]?.requestId;
    if (!snapshotA || !snapshotB || !occurrenceA || !occurrenceB) {
      throw new Error("Expected overlapping pending approvals");
    }

    expect(occurrenceA).not.toBe(occurrenceB);
    await controller.replyApproval({
      runtimeId: "runtime-a",
      ref: snapshotA.ref,
      requestId: occurrenceA,
      outcome: "approve_once",
    });

    expect(runtimeA.permissionReplyCalls).toEqual([
      { directory: "/repo", requestID: "shared-native-id", reply: "once" },
    ]);
    expect(runtimeB.permissionReplyCalls).toEqual([]);
    expect(controller.readRuntimeSnapshots("runtime-a")[0]?.pendingApprovals).toEqual([]);
    expect(controller.readRuntimeSnapshots("runtime-b")[0]?.pendingApprovals).toHaveLength(1);

    await attachmentA.release();
    expect(runtimeA.streamSignal()?.aborted).toBe(true);
    expect(runtimeB.streamSignal()?.aborted).toBe(false);
    expect(controller.readRuntimeSnapshots("runtime-b")).toHaveLength(1);
    await attachmentB.release();
  });

  test("isolates equal native request ids across sessions in one runtime", async () => {
    const harness = createLiveClientHarness({
      externalSessionIds: ["session-a", "session-b"],
      nativeRequestId: "shared-native-id",
    });
    const controller = createOpencodeLiveSessionController({
      createClient: () => harness.client,
      now: () => "2026-07-16T10:02:00.000Z",
    });
    const attachment = await controller.initializeRuntime({
      repoPath: "/repo",
      runtimeKind: "opencode",
      runtimeId: "runtime-1",
      runtimeEndpoint: "http://runtime-1",
      directories: ["/repo"],
    });
    const [sessionA, sessionB] = attachment.snapshots;
    const occurrenceA = sessionA?.pendingApprovals[0]?.requestId;
    const occurrenceB = sessionB?.pendingApprovals[0]?.requestId;
    if (!sessionA || !sessionB || !occurrenceA || !occurrenceB) {
      throw new Error("Expected overlapping pending approvals");
    }

    expect(occurrenceA).not.toBe(occurrenceB);
    await controller.replyApproval({
      runtimeId: "runtime-1",
      ref: sessionA.ref,
      requestId: occurrenceA,
      outcome: "reject",
    });
    const retained = controller.readRuntimeSnapshots("runtime-1");
    expect(
      retained.find((snapshot) => snapshot.ref.externalSessionId === "session-a")?.pendingApprovals,
    ).toEqual([]);
    expect(
      retained.find((snapshot) => snapshot.ref.externalSessionId === "session-b")?.pendingApprovals,
    ).toEqual([expect.objectContaining({ requestId: occurrenceB })]);
    await attachment.release();
  });

  test("routes opaque question occurrences without exposing the native id", async () => {
    const harness = createLiveClientHarness({
      nativeRequestId: "native-question-id",
      pendingQuestion: true,
    });
    const controller = createOpencodeLiveSessionController({
      createClient: () => harness.client,
      now: () => "2026-07-16T10:02:00.000Z",
    });
    const attachment = await controller.initializeRuntime({
      repoPath: "/repo",
      runtimeKind: "opencode",
      runtimeId: "runtime-1",
      runtimeEndpoint: "http://runtime-1",
      directories: ["/repo"],
    });
    const snapshot = attachment.snapshots[0];
    const occurrenceId = snapshot?.pendingQuestions[0]?.requestId;
    if (!snapshot || !occurrenceId) {
      throw new Error("Expected pending question");
    }

    expect(occurrenceId).not.toBe("native-question-id");
    await controller.replyQuestion({
      runtimeId: "runtime-1",
      ref: snapshot.ref,
      requestId: occurrenceId,
      answers: [["Yes"]],
    });

    expect(harness.questionReplyCalls).toEqual([
      {
        directory: "/repo",
        requestID: "native-question-id",
        answers: [["Yes"]],
      },
    ]);
    expect(controller.readRuntimeSnapshots("runtime-1")[0]?.pendingQuestions).toEqual([]);
    await attachment.release();
  });

  test("awaits the normalized change listener before completing a reply", async () => {
    const harness = createLiveClientHarness();
    const controller = createOpencodeLiveSessionController({
      createClient: () => harness.client,
      now: () => "2026-07-16T10:02:00.000Z",
    });
    let resolveListenerStarted: () => void = () => undefined;
    let releaseListener: () => void = () => undefined;
    const listenerStarted = new Promise<void>((resolve) => {
      resolveListenerStarted = resolve;
    });
    const listenerBarrier = new Promise<void>((resolve) => {
      releaseListener = resolve;
    });
    const attachment = await controller.initializeRuntime({
      repoPath: "/repo",
      runtimeKind: "opencode",
      runtimeId: "runtime-1",
      runtimeEndpoint: "http://runtime-1",
      directories: ["/repo"],
    });
    await attachment.startForwarding(async (change) => {
      if (change.type === "session_upsert") {
        resolveListenerStarted();
        await listenerBarrier;
      }
    });
    const snapshot = attachment.snapshots[0];
    const occurrenceId = snapshot?.pendingApprovals[0]?.requestId;
    if (!snapshot || !occurrenceId) {
      throw new Error("Expected pending approval");
    }

    let replySettled = false;
    const reply = controller
      .replyApproval({
        runtimeId: "runtime-1",
        ref: snapshot.ref,
        requestId: occurrenceId,
        outcome: "approve_once",
      })
      .then(() => {
        replySettled = true;
      });
    await listenerStarted;
    await Promise.resolve();
    expect(replySettled).toBe(false);

    releaseListener();
    await reply;
    expect(replySettled).toBe(true);
    await attachment.release();
  });

  test("surfaces a failed delivery without poisoning the ordered terminal fault", async () => {
    const harness = createLiveClientHarness();
    const controller = createOpencodeLiveSessionController({
      createClient: () => harness.client,
      now: () => "2026-07-16T10:02:00.000Z",
    });
    let resolveFirstDelivery: () => void = () => undefined;
    let releaseFirstDelivery: () => void = () => undefined;
    let resolveFault: (change: OpencodeLiveSessionChange) => void = () => undefined;
    const firstDeliveryStarted = new Promise<void>((resolve) => {
      resolveFirstDelivery = resolve;
    });
    const firstDeliveryBarrier = new Promise<void>((resolve) => {
      releaseFirstDelivery = resolve;
    });
    const fault = new Promise<OpencodeLiveSessionChange>((resolve) => {
      resolveFault = resolve;
    });
    const deliveryFailure = new Error("normalized listener rejected the delivery");
    const deliveredTypes: OpencodeLiveSessionChange["type"][] = [];
    let rejectNextUpsert = true;
    const attachment = await controller.initializeRuntime({
      repoPath: "/repo",
      runtimeKind: "opencode",
      runtimeId: "runtime-1",
      runtimeEndpoint: "http://runtime-1",
      directories: ["/repo"],
    });
    await attachment.startForwarding(async (change) => {
      deliveredTypes.push(change.type);
      if (change.type === "session_upsert" && rejectNextUpsert) {
        rejectNextUpsert = false;
        resolveFirstDelivery();
        await firstDeliveryBarrier;
        throw deliveryFailure;
      }
      if (change.type === "runtime_fault") {
        resolveFault(change);
      }
    });
    const snapshot = attachment.snapshots[0];
    const occurrenceId = snapshot?.pendingApprovals[0]?.requestId;
    if (!snapshot || !occurrenceId) {
      throw new Error("Expected pending approval");
    }

    const replyResult = controller
      .replyApproval({
        runtimeId: "runtime-1",
        ref: snapshot.ref,
        requestId: occurrenceId,
        outcome: "approve_once",
      })
      .then(
        () => ({ status: "fulfilled" as const }),
        (error: unknown) => ({ status: "rejected" as const, error }),
      );
    await firstDeliveryStarted;
    const streamFailed = harness.failStream(new Error("connection lost"));
    releaseFirstDelivery();

    await streamFailed;
    await expect(replyResult).resolves.toEqual({
      status: "rejected",
      error: deliveryFailure,
    });
    const terminalChange = await Promise.race([
      fault,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Expected the ordered terminal fault.")), 500);
      }),
    ]);
    expect(terminalChange).toEqual({
      type: "runtime_fault",
      runtimeId: "runtime-1",
      message: "OpenCode live event observation failed: connection lost",
    });
    expect(deliveredTypes).toEqual(["session_upsert", "runtime_fault"]);
    await attachment.release();
  });

  test("keeps an unresolved occurrence after a native reply failure", async () => {
    const harness = createLiveClientHarness();
    harness.setPermissionReplyError(new Error("native reply failed"));
    const controller = createOpencodeLiveSessionController({
      createClient: () => harness.client,
      now: () => "2026-07-16T10:02:00.000Z",
    });
    const attachment = await controller.initializeRuntime({
      repoPath: "/repo",
      runtimeKind: "opencode",
      runtimeId: "runtime-1",
      runtimeEndpoint: "http://runtime-1",
      directories: ["/repo"],
    });
    const snapshot = attachment.snapshots[0];
    const occurrenceId = snapshot?.pendingApprovals[0]?.requestId;
    if (!snapshot || !occurrenceId) {
      throw new Error("Expected pending approval");
    }

    await expect(
      controller.replyApproval({
        runtimeId: "runtime-1",
        ref: snapshot.ref,
        requestId: occurrenceId,
        outcome: "reject",
      }),
    ).rejects.toThrow("OpenCode request failed: reply to permission request");

    expect(controller.readRuntimeSnapshots("runtime-1")[0]?.pendingApprovals).toEqual([
      expect.objectContaining({ requestId: occurrenceId }),
    ]);
    harness.setPermissionReplyError(null);
    await expect(
      controller.replyApproval({
        runtimeId: "runtime-1",
        ref: snapshot.ref,
        requestId: occurrenceId,
        outcome: "approve_once",
      }),
    ).resolves.toBeUndefined();
    expect(harness.permissionReplyCalls).toHaveLength(2);
    expect(controller.readRuntimeSnapshots("runtime-1")[0]?.pendingApprovals).toEqual([]);
    await attachment.release();
  });

  test("assigns a new opaque occurrence when a native request id is reused", async () => {
    const harness = createLiveClientHarness();
    const controller = createOpencodeLiveSessionController({
      createClient: () => harness.client,
      now: () => "2026-07-16T10:02:00.000Z",
    });
    let resolveRecreated: () => void = () => undefined;
    const recreated = new Promise<void>((resolve) => {
      resolveRecreated = resolve;
    });
    let recreatedOccurrence: string | null = null;
    const attachment = await controller.initializeRuntime({
      repoPath: "/repo",
      runtimeKind: "opencode",
      runtimeId: "runtime-1",
      runtimeEndpoint: "http://runtime-1",
      directories: ["/repo"],
    });
    await attachment.startForwarding((change) => {
      if (change.type !== "session_upsert") {
        return;
      }
      const requestId = change.snapshot.pendingApprovals[0]?.requestId;
      if (requestId) {
        recreatedOccurrence = requestId;
        resolveRecreated();
      }
    });
    const snapshot = attachment.snapshots[0];
    const firstOccurrence = snapshot?.pendingApprovals[0]?.requestId;
    if (!snapshot || !firstOccurrence) {
      throw new Error("Expected pending approval");
    }
    await controller.replyApproval({
      runtimeId: "runtime-1",
      ref: snapshot.ref,
      requestId: firstOccurrence,
      outcome: "approve_once",
    });

    harness.setPendingApproval(true);
    harness.emit({
      type: "session.updated",
      properties: {
        info: {
          id: "session-1",
          directory: "/repo",
          title: "Live session",
        },
      },
    } as unknown as Event);
    await recreated;

    expect(recreatedOccurrence).not.toBe(firstOccurrence);
    await expect(
      controller.replyApproval({
        runtimeId: "runtime-1",
        ref: snapshot.ref,
        requestId: firstOccurrence,
        outcome: "approve_once",
      }),
    ).rejects.toThrow("Unknown or resolved OpenCode approval occurrence");
    await attachment.release();
  });
});
