import { describe, expect, test } from "bun:test";
import type { Event, OpencodeClient } from "@opencode-ai/sdk/v2/client";
import { createPrepareOpencodeSessionRuntime, type OpencodeSessionRuntimeSignal } from "./index";

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
    listBarrier?: Promise<void> | (() => Promise<void>);
    listError?: Error;
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
    initiallyConnected?: boolean;
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
  const queuedEvents: QueuedStreamEntry[] =
    input.initiallyConnected === false
      ? []
      : [
          {
            type: "event",
            event: {
              type: "server.connected",
              properties: {},
            } as unknown as Event,
          },
        ];
  let wakeStream: (() => void) | null = null;

  const client = {
    session: {
      list: async () => {
        callOrder.push("list");
        input.onList?.();
        if (typeof input.listBarrier === "function") {
          await input.listBarrier();
        } else {
          await input.listBarrier;
        }
        if (input.listError) {
          throw input.listError;
        }
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
              if (entry.event.type === "server.connected") {
                callOrder.push("connected");
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

const runtimeInput = {
  repoPath: "/repo",
  runtimeId: "runtime-1",
  runtimeEndpoint: "http://runtime-1",
  directories: ["/repo"],
} as const;

const createPrepareRuntime = (harness: LiveClientHarness) =>
  createPrepareOpencodeSessionRuntime({
    createClient: () => harness.client,
    now: () => "2026-07-16T10:02:00.000Z",
  });

describe("OpenCode session runtime connection", () => {
  test("subscribes before its authoritative read without loading message history", async () => {
    const harness = createLiveClientHarness();

    const prepared = await createPrepareRuntime(harness)(runtimeInput);

    expect(harness.callOrder.slice(0, 3)).toEqual(["subscribe", "connected", "list"]);
    expect(prepared.initialSources).toHaveLength(1);
    expect(prepared.initialSources[0]?.pendingApprovals[0]?.requestId).toBe("native-request-1");
    expect(harness.messageCalls).toEqual([]);
    await prepared.release();
  });

  test("aborts initialization while waiting for the runtime event stream", async () => {
    const harness = createLiveClientHarness({ initiallyConnected: false });
    const controller = new AbortController();
    const preparing = createPrepareRuntime(harness)({
      ...runtimeInput,
      signal: controller.signal,
    });
    while (harness.streamSignal() === null) {
      await Promise.resolve();
    }

    controller.abort();
    const outcome = await Promise.race([
      preparing.then(
        () => "resolved" as const,
        () => "rejected" as const,
      ),
      new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 50)),
    ]);
    if (outcome === "pending") {
      await harness.completeStream();
      await preparing.catch(() => undefined);
    }

    expect(outcome).toBe("rejected");
    expect(harness.streamSignal()?.aborted).toBe(true);
  });

  test("aborts initialization while the authoritative session read is pending", async () => {
    let reportListStarted = (): void => undefined;
    const listStarted = new Promise<void>((resolve) => {
      reportListStarted = resolve;
    });
    let releaseList = (): void => undefined;
    const listBarrier = new Promise<void>((resolve) => {
      releaseList = resolve;
    });
    const harness = createLiveClientHarness({
      onList: reportListStarted,
      listBarrier,
    });
    const controller = new AbortController();
    const preparing = createPrepareRuntime(harness)({
      ...runtimeInput,
      signal: controller.signal,
    });
    await listStarted;

    controller.abort();
    const outcome = await Promise.race([
      preparing.then(
        () => "resolved" as const,
        () => "rejected" as const,
      ),
      new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 50)),
    ]);
    releaseList();
    await preparing.catch(() => undefined);

    expect(outcome).toBe("rejected");
    expect(harness.streamSignal()?.aborted).toBe(true);
  });

  test("keeps a shared runtime event stream alive when one initializer is aborted", async () => {
    const harness = createLiveClientHarness({ initiallyConnected: false });
    const prepareRuntime = createPrepareRuntime(harness);
    const firstController = new AbortController();
    const firstPreparing = prepareRuntime({
      ...runtimeInput,
      signal: firstController.signal,
    });
    const secondPreparing = prepareRuntime(runtimeInput);
    while (harness.streamSignal() === null) {
      await Promise.resolve();
    }

    firstController.abort();
    await expect(firstPreparing).rejects.toBeDefined();
    expect(harness.streamSignal()?.aborted).toBe(false);

    harness.emit({ type: "server.connected", properties: {} } as unknown as Event);
    const secondPrepared = await secondPreparing;
    await secondPrepared.release();
    expect(harness.streamSignal()?.aborted).toBe(true);
  });

  test("serializes concurrent session source reads", async () => {
    let listCallCount = 0;
    let blockNextRead = false;
    let resolveReadStarted: () => void = () => undefined;
    let releaseRead: () => void = () => undefined;
    const readStarted = new Promise<void>((resolve) => {
      resolveReadStarted = resolve;
    });
    const readGate = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    const harness = createLiveClientHarness({
      onList: () => {
        listCallCount += 1;
      },
      listBarrier: async () => {
        if (blockNextRead) {
          blockNextRead = false;
          resolveReadStarted();
          await readGate;
        }
      },
    });
    const prepared = await createPrepareRuntime(harness)(runtimeInput);
    blockNextRead = true;

    const first = prepared.connection.readSessionSources();
    await readStarted;
    const second = prepared.connection.readSessionSources();
    await Promise.resolve();

    expect(listCallCount).toBe(2);
    releaseRead();
    await Promise.all([first, second]);
    expect(listCallCount).toBe(3);
    await prepared.release();
  });

  test("reconciles request creation and resolution that occur during initialization", async () => {
    let resolveCreatedReadStarted: () => void = () => undefined;
    let releaseCreatedRead: () => void = () => undefined;
    const createdReadStarted = new Promise<void>((resolve) => {
      resolveCreatedReadStarted = resolve;
    });
    const createdReadGate = new Promise<void>((resolve) => {
      releaseCreatedRead = resolve;
    });
    let createdReadCount = 0;
    const createdHarness = createLiveClientHarness({
      permissionListBarrier: async () => {
        createdReadCount += 1;
        if (createdReadCount === 1) {
          resolveCreatedReadStarted();
          await createdReadGate;
        }
      },
    });
    createdHarness.setPendingApproval(false);
    const creating = createPrepareRuntime(createdHarness)(runtimeInput);
    await createdReadStarted;
    createdHarness.setPendingApproval(true);
    await createdHarness.emitAndWait({
      type: "permission.asked",
      properties: {
        id: "native-request-1",
        sessionID: "session-1",
        permission: "read",
        patterns: ["README.md"],
      },
    } as Event);
    releaseCreatedRead();
    const created = await creating;
    expect(created.initialSources[0]?.pendingApprovals).toHaveLength(1);
    await created.release();

    let resolveResolvedReadStarted: () => void = () => undefined;
    let releaseResolvedRead: () => void = () => undefined;
    const resolvedReadStarted = new Promise<void>((resolve) => {
      resolveResolvedReadStarted = resolve;
    });
    const resolvedReadGate = new Promise<void>((resolve) => {
      releaseResolvedRead = resolve;
    });
    let resolvedReadCount = 0;
    const resolvedHarness = createLiveClientHarness({
      permissionListBarrier: async () => {
        resolvedReadCount += 1;
        if (resolvedReadCount === 1) {
          resolveResolvedReadStarted();
          await resolvedReadGate;
        }
      },
    });
    const resolving = createPrepareRuntime(resolvedHarness)(runtimeInput);
    await resolvedReadStarted;
    resolvedHarness.setPendingApproval(false);
    await resolvedHarness.emitAndWait({
      type: "permission.replied",
      properties: {
        requestID: "native-request-1",
        sessionID: "session-1",
      },
    } as Event);
    releaseResolvedRead();
    const resolved = await resolving;
    expect(resolved.initialSources[0]?.pendingApprovals).toEqual([]);
    await resolved.release();
  });

  test("buffers transcript signals until forwarding starts and preserves delivery order", async () => {
    let resolveListStarted: () => void = () => undefined;
    let releaseList: () => void = () => undefined;
    const listStarted = new Promise<void>((resolve) => {
      resolveListStarted = resolve;
    });
    const listGate = new Promise<void>((resolve) => {
      releaseList = resolve;
    });
    const harness = createLiveClientHarness({
      listBarrier: listGate,
      onList: resolveListStarted,
    });
    const preparing = createPrepareRuntime(harness)(runtimeInput);
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
    const prepared = await preparing;

    let resolveFirstStarted: () => void = () => undefined;
    let releaseFirst: () => void = () => undefined;
    const firstStarted = new Promise<void>((resolve) => {
      resolveFirstStarted = resolve;
    });
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const messages: string[] = [];
    const forwarding = prepared.startForwarding(async (signal) => {
      if (signal.type !== "transcript_event" || signal.event.type !== "assistant_message") {
        return;
      }
      messages.push(signal.event.message);
      if (signal.event.message === "Buffered transcript") {
        resolveFirstStarted();
        await firstGate;
      }
    });
    await firstStarted;

    await harness.emitAndWait({
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
    expect(messages).toEqual(["Buffered transcript"]);

    releaseFirst();
    await forwarding;
    expect(messages).toEqual(["Buffered transcript", "Live transcript"]);
    await prepared.release();
  });

  test("forwards normalized lifecycle details through the shared live-session signal", async () => {
    const harness = createLiveClientHarness();
    const prepared = await createPrepareRuntime(harness)(runtimeInput);
    const signals: OpencodeSessionRuntimeSignal[] = [];
    let resolveStatusSignal: () => void = () => undefined;
    const statusSignal = new Promise<void>((resolve) => {
      resolveStatusSignal = resolve;
    });
    await prepared.startForwarding((signal) => {
      signals.push(signal);
      if (signal.type === "transcript_event" && signal.event.type === "session_status") {
        resolveStatusSignal();
      }
    });

    await harness.emitAndWait({
      type: "session.status",
      properties: {
        sessionID: "session-1",
        status: {
          type: "retry",
          attempt: 2,
          message: "Retrying request",
          next: 250,
        },
      },
    } as Event);
    await statusSignal;

    expect(signals).toContainEqual({
      type: "transcript_event",
      externalSessionId: "session-1",
      event: expect.objectContaining({
        type: "session_status",
        status: {
          type: "retry",
          attempt: 2,
          message: "Retrying request",
          nextEpochMs: 250,
        },
      }),
    });
    await prepared.release();
  });

  test("retains initialization context and reads genuinely missing context on demand", async () => {
    let resolveListStarted: () => void = () => undefined;
    let releaseList: () => void = () => undefined;
    const listStarted = new Promise<void>((resolve) => {
      resolveListStarted = resolve;
    });
    const listGate = new Promise<void>((resolve) => {
      releaseList = resolve;
    });
    const retainedHarness = createLiveClientHarness({
      listBarrier: listGate,
      onList: resolveListStarted,
    });
    const preparing = createPrepareRuntime(retainedHarness)(runtimeInput);
    await listStarted;
    await retainedHarness.emitAndWait({
      type: "message.updated",
      properties: {
        info: {
          id: "assistant-context",
          sessionID: "session-1",
          role: "assistant",
          providerID: "openai",
          modelID: "gpt-5",
          tokens: { input: 30, output: 7 },
        },
        parts: [],
      },
    } as Event);
    releaseList();
    const retained = await preparing;
    expect(retained.initialContextUsageBySessionId.get("session-1")).toEqual({
      totalTokens: 37,
      model: {
        providerId: "openai",
        modelId: "gpt-5",
      },
    });
    expect(retainedHarness.messageCalls).toEqual([]);
    await retained.release();

    const missingHarness = createLiveClientHarness({ totalTokens: 1_200 });
    const missing = await createPrepareRuntime(missingHarness)(runtimeInput);
    await expect(
      missing.connection.loadContextUsage({
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo",
        externalSessionId: "session-1",
      }),
    ).resolves.toEqual({
      totalTokens: 1_200,
      model: {
        providerId: "openai",
        modelId: "gpt-5",
      },
    });
    expect(missingHarness.messageCalls).toEqual([
      {
        directory: "/repo",
        sessionID: "session-1",
        limit: 1,
      },
    ]);
    await missing.release();
  });

  test("keeps native reply identifiers inside the SDK connection", async () => {
    const harness = createLiveClientHarness({ pendingQuestion: true });
    const prepared = await createPrepareRuntime(harness)(runtimeInput);
    const ref = {
      repoPath: "/repo",
      runtimeKind: "opencode" as const,
      workingDirectory: "/repo",
      externalSessionId: "session-1",
    };

    await prepared.connection.replyQuestion({
      ref,
      nativeRequestId: "native-request-1",
      answers: [["Yes"]],
    });

    expect(harness.questionReplyCalls).toEqual([
      {
        directory: "/repo",
        requestID: "native-request-1",
        answers: [["Yes"]],
      },
    ]);
    await prepared.release();
  });

  test("turns unexpected observation failure into one fault signal but stays quiet on release", async () => {
    const failedHarness = createLiveClientHarness();
    const failed = await createPrepareRuntime(failedHarness)(runtimeInput);
    const signals: OpencodeSessionRuntimeSignal[] = [];
    let resolveFault: () => void = () => undefined;
    const faultDelivered = new Promise<void>((resolve) => {
      resolveFault = resolve;
    });
    await failed.startForwarding((signal) => {
      signals.push(signal);
      if (signal.type === "fault") {
        resolveFault();
      }
    });
    await failedHarness.failStream(new Error("socket closed"));
    await faultDelivered;
    expect(signals).toEqual([
      {
        type: "fault",
        message: "OpenCode live event observation failed: socket closed",
      },
    ]);
    await failed.release();

    const releasedHarness = createLiveClientHarness();
    const released = await createPrepareRuntime(releasedHarness)({
      ...runtimeInput,
      runtimeId: "runtime-2",
      runtimeEndpoint: "http://runtime-2",
    });
    const releasedSignals: OpencodeSessionRuntimeSignal[] = [];
    await released.startForwarding((signal) => {
      releasedSignals.push(signal);
    });
    await released.release();
    await Promise.resolve();
    expect(releasedSignals).toEqual([]);
  });

  test("releases the event stream when initialization fails", async () => {
    const harness = createLiveClientHarness({
      listError: new Error("session inventory failed"),
    });

    await expect(createPrepareRuntime(harness)(runtimeInput)).rejects.toThrow(
      "session inventory failed",
    );
    expect(harness.streamSignal()?.aborted).toBe(true);
  });
});
