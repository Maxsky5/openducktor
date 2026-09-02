import { describe, expect, test } from "bun:test";
import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/v2/client";
import { createPrepareOpencodeSessionRuntime, type OpencodeSessionRuntimeSignal } from "./index";
import { permissionAskedEvent, sessionStatusEvent } from "./event-stream.test-support";
import {
  createOpencodeEventFixtures,
  createOpencodeMessageInfoFixture,
  createOpencodeMessageEventGroupFixture,
  createOpencodeSessionFixture,
  type OpencodeEventFixtureInput,
} from "./opencode-protocol-test-fixtures";

type LiveClientHarness = {
  client: OpencodeClient;
  callOrder: string[];
  messageCalls: unknown[];
  promptCalls: unknown[];
  permissionReplyCalls: unknown[];
  questionReplyCalls: unknown[];
  setExternalSessionIds: (sessionIds: string[]) => void;
  setPermissionReplyError: (error: Error | null) => void;
  setPendingApproval: (pending: boolean) => void;
  emit: (event: OpencodeEventFixtureInput) => void;
  emitAndWait: (event: OpencodeEventFixtureInput) => Promise<void>;
  completeStream: () => Promise<void>;
  failStream: (error: Error) => Promise<void>;
  streamSignal: () => AbortSignal | null;
};

type SessionMessagesRequest = Parameters<OpencodeClient["session"]["messages"]>[0];
type SessionPromptRequest = Parameters<OpencodeClient["session"]["promptAsync"]>[0];
type PermissionReplyRequest = Parameters<OpencodeClient["permission"]["reply"]>[0];
type QuestionReplyRequest = Parameters<OpencodeClient["question"]["reply"]>[0];

type QueuedStreamEntry =
  | { type: "event"; event: OpencodeEventFixtureInput; consumed?: () => void }
  | { type: "complete"; consumed: () => void }
  | { type: "failure"; error: Error; consumed: () => void };

const createLiveClientHarness = (
  input: {
    externalSessionId?: string;
    externalSessionIds?: string[];
    nativeRequestId?: string;
    totalTokens?: number;
    pendingQuestion?: boolean;
    childSessionIdsByParent?: Readonly<Record<string, ReadonlyArray<string>>>;
    parentSessionIdsBySessionId?: Readonly<Record<string, string>>;
    missingSessionIds?: string[];
    busySessionIds?: string[];
    listBarrier?: () => Promise<void>;
    listError?: Error;
    onList?: () => void;
    messagesBarrier?: () => Promise<void>;
    onMessages?: () => void;
    permissionListBarrier?: () => Promise<void>;
    onPermissionList?: () => void;
    onPermissionListSettled?: () => void;
    questionListBarrier?: () => Promise<void>;
    onQuestionList?: () => void;
    onQuestionListSettled?: () => void;
    streamCloseBarrier?: () => Promise<void>;
    initiallyConnected?: boolean;
  } = {},
): LiveClientHarness => {
  let externalSessionIds = input.externalSessionIds ?? [input.externalSessionId ?? "session-1"];
  const externalSessionId = externalSessionIds[0] ?? "session-1";
  const nativeRequestId = input.nativeRequestId ?? "native-request-1";
  const callOrder: string[] = [];
  const messageCalls: unknown[] = [];
  const promptCalls: unknown[] = [];
  const permissionReplyCalls: unknown[] = [];
  const questionReplyCalls: unknown[] = [];
  let permissionReplyError: Error | null = null;
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
            },
          },
        ];
  let wakeStream: (() => void) | null = null;

  const baseClient = createOpencodeClient({ baseUrl: "http://127.0.0.1:12345" });
  const client: OpencodeClient = {
    ...baseClient,
    session: {
      ...baseClient.session,
      list: async () => {
        callOrder.push("list");
        input.onList?.();
        await input.listBarrier?.();
        if (input.listError) {
          throw input.listError;
        }
        return {
          data: externalSessionIds.map((sessionId) =>
            createOpencodeSessionFixture({
              id: sessionId,
              directory: "/repo",
              title: "Live session",
              time: {
                created: Date.parse("2026-07-16T10:00:00.000Z"),
                updated: Date.parse("2026-07-16T10:00:00.000Z"),
              },
            }),
          ),
          error: undefined,
        };
      },
      get: async ({ sessionID }) => {
        callOrder.push(`get:${sessionID}`);
        const request = new Request(`http://127.0.0.1:12345/session/${sessionID}`);
        if (input.missingSessionIds?.includes(sessionID)) {
          return {
            data: undefined,
            error: { name: "NotFoundError" as const, data: { message: "Session not found" } },
            request,
            response: new Response(null, { status: 404 }),
          };
        }
        return {
          data: createOpencodeSessionFixture({
            id: sessionID,
            parentID: input.parentSessionIdsBySessionId?.[sessionID],
            directory: "/repo",
            title: "OpenDucktor session",
            time: {
              created: Date.parse("2026-07-16T10:00:00.000Z"),
              updated: Date.parse("2026-07-16T10:00:00.000Z"),
            },
          }),
          error: undefined,
          request,
          response: new Response(null, { status: 200 }),
        };
      },
      children: async ({ sessionID }) => {
        callOrder.push(`children:${sessionID}`);
        return {
          data: (input.childSessionIdsByParent?.[sessionID] ?? []).map((childSessionId) =>
            createOpencodeSessionFixture({
              id: childSessionId,
              parentID: sessionID,
              directory: "/repo",
              title: "OpenCode subagent",
              time: {
                created: Date.parse("2026-07-16T10:01:00.000Z"),
                updated: Date.parse("2026-07-16T10:01:00.000Z"),
              },
            }),
          ),
          error: undefined,
        };
      },
      status: async () => ({
        data: (() => {
          callOrder.push("status");
          const busySessionIds = new Set(input.busySessionIds ?? []);
          return Object.fromEntries(
            externalSessionIds.map((sessionId) => [
              sessionId,
              { type: busySessionIds.has(sessionId) ? "busy" : "idle" },
            ]),
          );
        })(),
        error: undefined,
      }),
      messages: async (request: SessionMessagesRequest) => {
        messageCalls.push(request);
        input.onMessages?.();
        await input.messagesBarrier?.();
        return {
          data:
            input.totalTokens !== undefined
              ? [
                  {
                    info: createOpencodeMessageInfoFixture({
                      id: "assistant-latest",
                      role: "assistant",
                      sessionID: externalSessionId,
                      providerID: "openai",
                      modelID: "gpt-5",
                      tokens: { input: input.totalTokens - 100, output: 100 },
                      time: { created: Date.parse("2026-07-16T10:01:00.000Z") },
                    }),
                    parts: [],
                  },
                ]
              : [],
          error: undefined,
        };
      },
      promptAsync: async (request: SessionPromptRequest) => {
        promptCalls.push(request);
        return { data: {}, error: undefined };
      },
      update: async () => ({ data: { id: externalSessionId }, error: undefined }),
    },
    permission: {
      ...baseClient.permission,
      list: async () => {
        callOrder.push("permission.list");
        const data = pendingApproval
          ? externalSessionIds.map((sessionId) => ({
              id: nativeRequestId,
              sessionID: sessionId,
              permission: "read",
              patterns: ["README.md"],
              metadata: {},
              always: [],
            }))
          : [];
        input.onPermissionList?.();
        await input.permissionListBarrier?.();
        input.onPermissionListSettled?.();
        return { data, error: undefined };
      },
      reply: async (request: PermissionReplyRequest) => {
        permissionReplyCalls.push(request);
        if (permissionReplyError) {
          return { data: undefined, error: permissionReplyError };
        }
        pendingApproval = false;
        return { data: true, error: undefined };
      },
    },
    question: {
      ...baseClient.question,
      list: async () => {
        callOrder.push("question.list");
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
        await input.questionListBarrier?.();
        input.onQuestionListSettled?.();
        return { data, error: undefined };
      },
      reply: async (request: QuestionReplyRequest) => {
        questionReplyCalls.push(request);
        pendingQuestion = false;
        return { data: true, error: undefined };
      },
    },
    global: {
      ...baseClient.global,
      event: async (options?: { signal?: AbortSignal }) => {
        callOrder.push("subscribe");
        signal = options?.signal ?? null;
        async function* events() {
          let eventIndex = 0;
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
              for (const payload of createOpencodeEventFixtures(entry.event, eventIndex)) {
                yield { directory: "/repo", payload };
              }
              eventIndex += 1;
              entry.consumed?.();
            }
          } finally {
            await input.streamCloseBarrier?.();
          }
        }
        return { stream: events() };
      },
    },
    mcp: {
      ...baseClient.mcp,
      status: async () => ({
        data: { openducktor: { status: "connected" } },
        error: undefined,
      }),
    },
    tool: {
      ...baseClient.tool,
      ids: async () => ({ data: [], error: undefined }),
    },
  };

  return {
    client,
    callOrder,
    messageCalls,
    promptCalls,
    permissionReplyCalls,
    questionReplyCalls,
    setExternalSessionIds: (sessionIds) => {
      externalSessionIds = sessionIds;
    },
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
    readDirectory: (_directory, read) => read(),
    now: () => "2026-07-16T10:02:00.000Z",
  });

const resumeOpenDucktorSession = async (
  prepared: Awaited<ReturnType<ReturnType<typeof createPrepareOpencodeSessionRuntime>>>,
): Promise<void> => {
  await prepared.connection.resumeSession({
    repoPath: "/repo",
    runtimeKind: "opencode",
    runtimePolicy: { kind: "opencode" },
    workingDirectory: "/repo",
    externalSessionId: "session-1",
    sessionScope: { kind: "repository" },
  });
};

describe("OpenCode session runtime connection", () => {
  test("prepares event transport without enumerating runtime sessions", async () => {
    const harness = createLiveClientHarness();

    const prepared = await createPrepareRuntime(harness)(runtimeInput);

    expect(harness.callOrder).toEqual(["subscribe", "connected"]);
    expect(harness.messageCalls).toEqual([]);
    await prepared.release();
  });

  test("refreshes only registered OpenDucktor roots without listing sessions", async () => {
    const harness = createLiveClientHarness({
      externalSessionIds: ["session-1", "child-session", "unknown-session"],
      busySessionIds: ["session-1", "child-session"],
      childSessionIdsByParent: { "session-1": ["child-session"] },
    });
    const prepared = await createPrepareRuntime(harness)(runtimeInput);

    const results = await prepared.connection.refreshRegisteredSessions([
      {
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo",
        externalSessionId: "session-1",
      },
    ]);

    expect(results).toEqual([
      {
        type: "present",
        ref: expect.objectContaining({ externalSessionId: "session-1" }),
        sources: [
          expect.objectContaining({
            externalSessionId: "session-1",
            runtimeActivity: "running",
            pendingApprovals: [expect.objectContaining({ requestId: "native-request-1" })],
          }),
          expect.objectContaining({
            externalSessionId: "child-session",
            parentExternalSessionId: "session-1",
            runtimeActivity: "running",
          }),
        ],
      },
    ]);
    expect(
      results.some(
        (result) =>
          result.type === "present" &&
          result.sources.some((source) => source.externalSessionId === "unknown-session"),
      ),
    ).toBe(false);
    expect(harness.callOrder).toContain("get:session-1");
    expect(harness.callOrder).toContain("children:session-1");
    expect(harness.callOrder).not.toContain("list");
    expect(harness.callOrder.filter((call) => call === "get:session-1")).toHaveLength(1);
    expect(harness.callOrder.indexOf("get:session-1")).toBeLessThan(
      harness.callOrder.indexOf("status"),
    );
    await prepared.release();
  });

  test("keeps parent lineage when a registered ref points to a child session", async () => {
    const harness = createLiveClientHarness({
      externalSessionIds: ["child-session"],
      parentSessionIdsBySessionId: { "child-session": "parent-session" },
    });
    const prepared = await createPrepareRuntime(harness)(runtimeInput);

    const results = await prepared.connection.refreshRegisteredSessions([
      {
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo",
        externalSessionId: "child-session",
      },
    ]);

    expect(results).toEqual([
      expect.objectContaining({
        type: "present",
        sources: [
          expect.objectContaining({
            externalSessionId: "child-session",
            parentExternalSessionId: "parent-session",
          }),
        ],
      }),
    ]);
    await prepared.release();
  });

  test("reports a missing registered root without failing other roots", async () => {
    const harness = createLiveClientHarness({
      externalSessionIds: ["session-1", "missing-session"],
      missingSessionIds: ["missing-session"],
    });
    const prepared = await createPrepareRuntime(harness)(runtimeInput);

    const results = await prepared.connection.refreshRegisteredSessions([
      {
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo",
        externalSessionId: "session-1",
      },
      {
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo",
        externalSessionId: "missing-session",
      },
    ]);

    expect(results).toEqual([
      expect.objectContaining({
        type: "present",
        ref: expect.objectContaining({ externalSessionId: "session-1" }),
      }),
      {
        type: "missing",
        ref: {
          repoPath: "/repo",
          runtimeKind: "opencode",
          workingDirectory: "/repo",
          externalSessionId: "missing-session",
        },
      },
    ]);
    await prepared.release();
  });

  test("forwards context updates for a verified descendant", async () => {
    const harness = createLiveClientHarness({
      externalSessionIds: ["session-1", "child-session"],
      childSessionIdsByParent: { "session-1": ["child-session"] },
    });
    const prepared = await createPrepareRuntime(harness)(runtimeInput);
    const signals: OpencodeSessionRuntimeSignal[] = [];
    await prepared.connection.refreshRegisteredSessions([
      {
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo",
        externalSessionId: "session-1",
      },
    ]);
    await prepared.startForwarding((signal) => {
      signals.push(signal);
    });
    await harness.emitAndWait({
      type: "session.updated",
      properties: {
        sessionID: "child-session",
        info: createOpencodeSessionFixture({
          id: "child-session",
          parentID: "session-1",
          directory: "/repo",
        }),
      },
    });
    await harness.emitAndWait({
      type: "message.updated",
      properties: {
        info: createOpencodeMessageInfoFixture({
          id: "assistant-child",
          role: "assistant",
          sessionID: "child-session",
          providerID: "openai",
          modelID: "gpt-5",
          tokens: { input: 900, output: 100 },
          time: { created: Date.parse("2026-07-16T10:03:00.000Z") },
        }),
        parts: [],
      },
    });

    expect(signals).toContainEqual({
      type: "context_updated",
      externalSessionId: "child-session",
      contextUsage: {
        totalTokens: 1_000,
        model: { providerId: "openai", modelId: "gpt-5", profileId: "build" },
      },
    });
    await prepared.release();
  });

  test("forwards deletion only for a registered root lineage", async () => {
    const harness = createLiveClientHarness({
      externalSessionIds: ["session-1", "child-session"],
      childSessionIdsByParent: { "session-1": ["child-session"] },
    });
    const prepared = await createPrepareRuntime(harness)(runtimeInput);
    const signals: OpencodeSessionRuntimeSignal[] = [];
    await prepared.connection.refreshRegisteredSessions([
      {
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo",
        externalSessionId: "session-1",
      },
    ]);
    await prepared.startForwarding((signal) => {
      signals.push(signal);
    });

    await harness.emitAndWait({
      type: "session.deleted",
      properties: {
        sessionID: "child-session",
        info: createOpencodeSessionFixture({
          id: "child-session",
          parentID: "session-1",
          directory: "/repo",
        }),
      },
    });
    await harness.emitAndWait({
      type: "session.deleted",
      properties: {
        sessionID: "unknown-session",
        info: createOpencodeSessionFixture({ id: "unknown-session", directory: "/repo" }),
      },
    });
    expect(signals).toEqual([{ type: "session_removed", externalSessionId: "child-session" }]);
    await prepared.release();
  });

  test("forwards events only after OpenDucktor resumes the session", async () => {
    const harness = createLiveClientHarness();
    const prepared = await createPrepareRuntime(harness)(runtimeInput);
    const signals: OpencodeSessionRuntimeSignal[] = [];
    await resumeOpenDucktorSession(prepared);
    await prepared.startForwarding((signal) => {
      signals.push(signal);
    });

    await harness.emitAndWait(sessionStatusEvent({ type: "busy" }, "session-1"));

    expect(signals).toContainEqual({
      type: "session_event",
      externalSessionId: "session-1",
      event: expect.objectContaining({
        type: "session_status",
        status: expect.objectContaining({ type: "busy" }),
      }),
    });
    expect(harness.callOrder).not.toContain("list");
    await prepared.release();
  });

  test("keeps a confirmed registration without reading the session list", async () => {
    const harness = createLiveClientHarness();
    const prepared = await createPrepareRuntime(harness)(runtimeInput);

    await prepared.connection.sendUserMessage({
      repoPath: "/repo",
      runtimeKind: "opencode",
      runtimePolicy: { kind: "opencode" },
      workingDirectory: "/repo",
      externalSessionId: "session-1",
      sessionScope: { kind: "repository" },
      parts: [{ kind: "text", text: "Continue" }],
    });

    expect(harness.promptCalls).toHaveLength(1);
    expect(harness.callOrder).not.toContain("list");
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

    harness.emit({ type: "server.connected", properties: {} });
    const secondPrepared = await secondPreparing;
    await secondPrepared.release();
    expect(harness.streamSignal()?.aborted).toBe(true);
  });

  test("buffers transcript signals until forwarding starts and preserves delivery order", async () => {
    const harness = createLiveClientHarness();
    const prepared = await createPrepareRuntime(harness)(runtimeInput);
    await resumeOpenDucktorSession(prepared);
    await harness.emitAndWait(
      createOpencodeMessageEventGroupFixture({
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
      }),
    );
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
      if (signal.type !== "session_event" || signal.event.type !== "assistant_message") {
        return;
      }
      messages.push(signal.event.message);
      if (signal.event.message === "Buffered transcript") {
        resolveFirstStarted();
        await firstGate;
      }
    });
    await firstStarted;

    await harness.emitAndWait(
      createOpencodeMessageEventGroupFixture({
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
      }),
    );
    expect(messages).toEqual(["Buffered transcript"]);

    releaseFirst();
    await forwarding;
    expect(messages).toEqual(["Buffered transcript", "Live transcript"]);
    await prepared.release();
  });

  test("forwards pending input as retained session state events", async () => {
    const harness = createLiveClientHarness();
    const prepared = await createPrepareRuntime(harness)(runtimeInput);
    const signals: OpencodeSessionRuntimeSignal[] = [];
    await resumeOpenDucktorSession(prepared);
    await prepared.startForwarding((signal) => {
      signals.push(signal);
    });

    await harness.emitAndWait(
      permissionAskedEvent({
        requestId: "native-request-1",
        sessionId: "session-1",
        permission: "read",
        patterns: ["README.md"],
      }),
    );

    expect(signals).toContainEqual({
      type: "session_event",
      externalSessionId: "session-1",
      event: expect.objectContaining({
        type: "approval_required",
        requestId: "native-request-1",
      }),
    });
    await prepared.release();
  });

  test("forwards runtime-start evidence before a stop-only turn becomes idle", async () => {
    const harness = createLiveClientHarness();
    const prepared = await createPrepareRuntime(harness)(runtimeInput);
    await resumeOpenDucktorSession(prepared);
    const transcriptEventTypes: string[] = [];
    const sessionStatuses: string[] = [];
    await prepared.startForwarding((signal) => {
      if (signal.type !== "session_event") {
        return;
      }
      transcriptEventTypes.push(signal.event.type);
      if (signal.event.type === "session_status") {
        sessionStatuses.push(signal.event.status.type);
      }
    });

    await prepared.connection.sendUserMessage({
      repoPath: "/repo",
      runtimeKind: "opencode",
      runtimePolicy: { kind: "opencode" },
      workingDirectory: "/repo",
      externalSessionId: "session-1",
      sessionScope: { kind: "repository" },
      parts: [{ kind: "text", text: "Do the work" }],
    });
    await harness.emitAndWait({
      type: "message.updated",
      properties: {
        info: {
          id: "assistant-stop-only",
          sessionID: "session-1",
          role: "assistant",
          finish: "stop",
        },
        parts: [
          {
            id: "assistant-stop-only-step",
            sessionID: "session-1",
            messageID: "assistant-stop-only",
            type: "step-finish",
            reason: "stop",
            cost: 0,
            tokens: {},
          },
        ],
      },
    });
    await harness.emitAndWait({
      type: "session.idle",
      properties: { sessionID: "session-1" },
    });

    expect(sessionStatuses).toEqual(["busy"]);
    expect(transcriptEventTypes).toContain("session_idle");
    expect(transcriptEventTypes).not.toContain("assistant_message");
    await prepared.release();
  });

  test("loads context on demand without enumerating sessions", async () => {
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
        profileId: "build",
      },
    });
    expect(missingHarness.messageCalls).toEqual([
      {
        directory: "/repo",
        sessionID: "session-1",
        limit: 1,
      },
    ]);
    expect(missingHarness.callOrder).not.toContain("list");
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
});
