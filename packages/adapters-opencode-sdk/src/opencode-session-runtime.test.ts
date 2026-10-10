import type { SendAgentUserMessageInput } from "@openducktor/core";
import {
  MANUAL_SESSION_COMPACTION_SLASH_COMMAND,
  type AgentSessionAuthorizedRoot,
} from "@openducktor/contracts";
import type { Session } from "@opencode-ai/sdk/v2/client";
import { describe, expect, test } from "bun:test";
import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/v2/client";
import { createPrepareOpencodeSessionRuntime, type OpencodeSessionRuntimeSignal } from "./index";
import { permissionAskedEvent, sessionStatusEvent } from "./event-stream.test-support";
import type { OpencodePermissionRule } from "./workflow-tool-permissions";
import { TEST_MCP_SERVER_CONFIG } from "./test-support";
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
  const metadata = new Map<string, NonNullable<Session["metadata"]>>();
  const rules = new Map<string, OpencodePermissionRule[]>();
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
      create: async (request) => {
        rules.set(externalSessionId, request?.permission ?? []);
        if (request?.metadata) metadata.set(externalSessionId, request.metadata);
        return {
          data: createOpencodeSessionFixture({
            id: externalSessionId,
            directory: request?.directory ?? "/repo",
            permission: rules.get(externalSessionId),
            metadata: metadata.get(externalSessionId),
          }),
          error: undefined,
        };
      },
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
              permission: rules.get(sessionId),
              metadata: metadata.get(sessionId),
              parentID: input.parentSessionIdsBySessionId?.[sessionId],
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
            permission: rules.get(sessionID),
            metadata: metadata.get(sessionID),
            parentID:
              input.parentSessionIdsBySessionId?.[sessionID] ??
              Object.entries(input.childSessionIdsByParent ?? {}).find(([, children]) =>
                children.includes(sessionID),
              )?.[0],
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
              permission: rules.get(childSessionId),
              metadata: metadata.get(childSessionId),
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
      update: async (request) => {
        if (request.metadata) metadata.set(request.sessionID, request.metadata);
        const permission = [...(rules.get(request.sessionID) ?? []), ...(request.permission ?? [])];
        rules.set(request.sessionID, permission);
        return {
          data: createOpencodeSessionFixture({
            id: request.sessionID,
            metadata: metadata.get(request.sessionID),
            directory: request.directory ?? "/repo",
            permission,
          }),
          error: undefined,
        };
      },
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
      add: async () => ({
        data: { openducktor: { status: "connected" } },
        error: undefined,
      }),
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
  runtimeId: "runtime-1",
  runtimeEndpoint: "http://runtime-1",
  directories: ["/repo"],
} as const;

const createPrepareRuntime = (harness: LiveClientHarness) =>
  createPrepareOpencodeSessionRuntime({
    resolveCreationSettings: async () => ({ defaults: [], role: [] }),
    createClient: () => harness.client,
    readDirectory: (_directory, read) => read(),
    resolveMcpServerConfig: async () => TEST_MCP_SERVER_CONFIG,
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
  test.each([
    ["stop", "prompt"],
    ["stop", "command"],
    ["stop", "compact"],
    ["release", "prompt"],
    ["release", "command"],
    ["release", "compact"],
  ] as const)("%s cancels a queued %s before native dispatch", async (action, kind) => {
    const harness = createLiveClientHarness();
    harness.setPendingApproval(false);
    const calls: string[] = [];
    recordNativeSends(harness, calls);
    const prepared = await createPrepareRuntime(harness)(runtimeInput);
    const root = workflowRoot();
    const started = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    let reading: ReturnType<typeof prepared.connection.readSessionSources> | undefined;
    let nextRead: ReturnType<typeof prepared.connection.readSessionSources> | undefined;
    let sending: Promise<unknown> | undefined;
    let readCalls = 0;
    const get = harness.client.session.get;
    try {
      await prepared.connection.startSession({
        ...root,
        runtimePolicy: { kind: "opencode" },
        systemPrompt: "Build it",
      });
      harness.client.session.get = async (...args) => {
        readCalls++;
        started.resolve();
        await finish.promise;
        return get(...args);
      };
      reading = prepared.connection.readSessionSources("/repo", [root]);
      await started.promise;
      sending = prepared.connection.sendUserMessage(userSend(root, kind)).then(
        (message) => ({ message }),
        (error: Error) => ({ error: error.message }),
      );
      if (action === "stop") await prepared.connection.stopSession(root);
      else await prepared.connection.releaseSession(root);
      expect(
        await Promise.race([
          sending,
          new Promise((resolve) => setTimeout(() => resolve("pending"), 50)),
        ]),
      ).toMatchObject({ error: expect.stringContaining("canceled") });
      nextRead = prepared.connection.readSessionSources("/repo", [root]);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(readCalls).toBe(1);
      finish.resolve();
      await Promise.all([reading, nextRead]);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(calls).toEqual([]);
      harness.client.session.get = get;
      await prepared.connection.resumeSession({ ...root, runtimePolicy: { kind: "opencode" } });
      await prepared.connection.sendUserMessage(userSend(root, "prompt"));
      expect(calls).toEqual(["prompt"]);
    } finally {
      finish.resolve();
      await Promise.allSettled([reading, nextRead, sending]);
      await prepared.release();
    }
  });

  test.each([
    ["stop", "prompt"],
    ["stop", "command"],
    ["release", "prompt"],
    ["release", "command"],
  ] as const)("%s cancels a %s during MCP setup", async (action, kind) => {
    const harness = createLiveClientHarness();
    harness.setPendingApproval(false);
    const calls: string[] = [];
    recordNativeSends(harness, calls);
    const prepared = await createPrepareRuntime(harness)(runtimeInput);
    const root = workflowRoot();
    const started = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    let sending: Promise<unknown> | undefined;
    try {
      await prepared.connection.startSession({
        ...root,
        runtimePolicy: { kind: "opencode" },
        systemPrompt: "Build it",
      });
      const status = harness.client.mcp.status;
      harness.client.mcp.status = async (...args) => {
        started.resolve();
        await finish.promise;
        return status(...args);
      };
      let sent = false;
      sending = prepared.connection
        .sendUserMessage(userSend(root, kind), {
          onSent: () => {
            sent = true;
          },
        })
        .then(
          (message) => ({ message }),
          (error: Error) => ({ error: error.message }),
        );
      await started.promise;
      if (action === "stop") await prepared.connection.stopSession(root);
      else await prepared.connection.releaseSession(root);
      expect(
        await Promise.race([
          sending,
          new Promise((resolve) => setTimeout(() => resolve("pending"), 50)),
        ]),
      ).toMatchObject({ error: expect.stringContaining("canceled") });
      finish.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(calls).toEqual([]);
      // The send stopped before the native request, so OpenCode never received the message.
      expect(sent).toBe(false);
    } finally {
      finish.resolve();
      await prepared.release();
      await sending;
    }
  });

  test("reports the native prompt request to the send caller", async () => {
    const harness = createLiveClientHarness();
    harness.setPendingApproval(false);
    const calls: string[] = [];
    recordNativeSends(harness, calls);
    const prepared = await createPrepareRuntime(harness)(runtimeInput);
    const root = workflowRoot();
    try {
      await prepared.connection.startSession({
        ...root,
        runtimePolicy: { kind: "opencode" },
        systemPrompt: "Build it",
      });
      const sentAfter: string[][] = [];
      await prepared.connection.sendUserMessage(userSend(root, "prompt"), {
        onSent: () => {
          sentAfter.push([...calls]);
        },
      });
      expect(sentAfter).toEqual([["prompt"]]);
    } finally {
      await prepared.release();
    }
  });

  test.each(["read", "mcp"] as const)(
    "runtime release cancels a send while %s stays blocked",
    async (waiting) => {
      const harness = createLiveClientHarness();
      harness.setPendingApproval(false);
      const calls: string[] = [];
      recordNativeSends(harness, calls);
      const prepared = await createPrepareRuntime(harness)(runtimeInput);
      const root = workflowRoot();
      const started = Promise.withResolvers<void>();
      const finish = Promise.withResolvers<void>();
      let reading: Promise<unknown> | undefined;
      let sending: Promise<unknown> | undefined;
      try {
        await prepared.connection.startSession({
          ...root,
          runtimePolicy: { kind: "opencode" },
          systemPrompt: "Build it",
        });
        if (waiting === "read") {
          const get = harness.client.session.get;
          harness.client.session.get = async (...args) => {
            started.resolve();
            await finish.promise;
            return get(...args);
          };
          reading = prepared.connection.readSessionSources("/repo", [root]).then(
            (value) => ({ value }),
            (error: Error) => ({ error }),
          );
          await started.promise;
        } else {
          const status = harness.client.mcp.status;
          harness.client.mcp.status = async (...args) => {
            started.resolve();
            await finish.promise;
            return status(...args);
          };
        }
        sending = prepared.connection.sendUserMessage(userSend(root, "prompt")).then(
          (message) => ({ message }),
          (error: Error) => ({ error: error.message }),
        );
        await started.promise;
        await prepared.release();
        expect(
          await Promise.race([
            sending,
            new Promise((resolve) => setTimeout(() => resolve("pending"), 50)),
          ]),
        ).toMatchObject({ error: expect.stringContaining("canceled") });
        finish.resolve();
        await Promise.allSettled([reading, sending]);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(calls).toEqual([]);
      } finally {
        finish.resolve();
        await Promise.allSettled([reading, sending]);
        await prepared.release();
      }
    },
  );

  test.each(["read", "mcp"] as const)(
    "a paused %s in one repository does not block another",
    async (waiting) => {
      const harness = createLiveClientHarness({ externalSessionIds: ["session-1", "session-2"] });
      harness.setPendingApproval(false);
      harness.client.session.abort = async () => ({ data: true, error: undefined });
      const get = harness.client.session.get;
      harness.client.session.get = async (request) => {
        const result = await get(request);
        return { ...result, data: { ...result.data, directory: request.directory! } };
      };
      const prepared = await createPrepareRuntime(harness)({
        ...runtimeInput,
        directories: ["/repo-a", "/repo-b"],
      });
      const rootA: AgentSessionAuthorizedRoot = {
        ...workflowRoot(),
        repoPath: "/repo-a",
        workingDirectory: "/repo-a",
        sessionScope: { kind: "repository" },
      };
      const rootB: AgentSessionAuthorizedRoot = {
        ...rootA,
        repoPath: "/repo-b",
        workingDirectory: "/repo-b",
        externalSessionId: "session-2",
      };
      const started = Promise.withResolvers<void>();
      const finish = Promise.withResolvers<void>();
      const sentB = Promise.withResolvers<void>();
      let workA: Promise<unknown> | undefined;
      let sendingB: Promise<unknown> | undefined;
      const prompt = harness.client.session.promptAsync;
      harness.client.session.promptAsync = (...args) => {
        if (args[0].directory === rootB.workingDirectory) sentB.resolve();
        return prompt(...args);
      };
      try {
        for (const root of [rootA, rootB])
          await prepared.connection.resumeSession({ ...root, runtimePolicy: { kind: "opencode" } });
        if (waiting === "read") {
          const read = harness.client.session.get;
          harness.client.session.get = async (request) => {
            if (request.sessionID === rootA.externalSessionId) {
              started.resolve();
              await finish.promise;
            }
            return read(request);
          };
          workA = prepared.connection.readSessionSources(rootA.repoPath, [rootA]);
        } else {
          const status = harness.client.mcp.status;
          harness.client.mcp.status = async (...args) => {
            if (args[0]?.directory === rootA.workingDirectory) {
              started.resolve();
              await finish.promise;
            }
            return status(...args);
          };
          workA = prepared.connection.sendUserMessage(userSend(rootA, "prompt"));
        }
        await started.promise;
        sendingB = prepared.connection.sendUserMessage(userSend(rootB, "prompt"));
        expect(
          await Promise.race([
            sentB.promise.then(() => "sent"),
            new Promise((resolve) => setTimeout(() => resolve("blocked"), 50)),
          ]),
        ).toBe("sent");
        await sendingB;
        await prepared.connection.stopSession(rootB);
        finish.resolve();
        await workA;
        expect(harness.promptCalls).toHaveLength(waiting === "mcp" ? 2 : 1);
      } finally {
        finish.resolve();
        await prepared.release();
        await Promise.allSettled([workA, sendingB]);
      }
    },
  );

  test("Stop completes while an already dispatched prompt waits for its reply", async () => {
    const harness = createLiveClientHarness();
    harness.setPendingApproval(false);
    harness.client.session.abort = async () => ({ data: true, error: undefined });
    const started = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    const prompt = harness.client.session.promptAsync;
    harness.client.session.promptAsync = async (...args) => {
      const reply = prompt(...args);
      started.resolve();
      await finish.promise;
      return reply;
    };
    const prepared = await createPrepareRuntime(harness)(runtimeInput);
    const root = workflowRoot();
    let sending: Promise<unknown> | undefined;
    try {
      await prepared.connection.startSession({
        ...root,
        runtimePolicy: { kind: "opencode" },
        systemPrompt: "Build it",
      });
      sending = prepared.connection.sendUserMessage(userSend(root, "prompt")).then(
        (message) => ({ message }),
        (error: Error) => ({ error }),
      );
      await started.promise;
      const stopping = prepared.connection.stopSession(root);
      expect(
        await Promise.race([
          stopping.then(() => "stopped"),
          new Promise((resolve) => setTimeout(() => resolve("blocked"), 50)),
        ]),
      ).toBe("stopped");
      expect(await Promise.race([sending, Promise.resolve("pending")])).toBe("pending");
      expect(harness.promptCalls).toHaveLength(1);
    } finally {
      finish.resolve();
      await sending;
      await prepared.release();
    }
  });

  test("sends the first message once after queued workflow attachments finish", async () => {
    const harness = createLiveClientHarness();
    harness.setPendingApproval(false);
    const prepared = await createPrepareRuntime(harness)(runtimeInput);
    const root = workflowRoot();
    const readStarted = Promise.withResolvers<void>();
    const finishRead = Promise.withResolvers<void>();
    const get = harness.client.session.get;
    try {
      await prepared.connection.startSession({
        ...root,
        runtimePolicy: { kind: "opencode" },
        systemPrompt: "Build it",
      });
      harness.client.session.get = async (...args) => {
        readStarted.resolve();
        await finishRead.promise;
        return get(...args);
      };
      const reading = prepared.connection.readSessionSources("/repo", [root]);
      await readStarted.promise;
      const nextRead = prepared.connection.readSessionSources("/repo", [root]);
      const sending = prepared.connection
        .sendUserMessage({
          ...root,
          runtimePolicy: { kind: "opencode" },
          parts: [{ kind: "text", text: "First message" }],
        })
        .then(
          (message) => ({ message }),
          (error: Error) => ({ error }),
        );
      try {
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(await Promise.race([sending, Promise.resolve("pending")])).toBe("pending");
        expect(harness.promptCalls).toEqual([]);
      } finally {
        finishRead.resolve();
        await Promise.all([reading, nextRead]);
      }
      expect(await sending).toMatchObject({
        message: { type: "user_message", externalSessionId: "session-1", message: "First message" },
      });
      expect(harness.promptCalls).toHaveLength(1);
    } finally {
      finishRead.resolve();
      await prepared.release();
    }
  });

  test("keeps a later workflow attachment behind MCP binding validation and native dispatch", async () => {
    const harness = createLiveClientHarness();
    harness.setPendingApproval(false);
    const prepared = await createPrepareRuntime(harness)(runtimeInput);
    const root = workflowRoot();
    const statusStarted = Promise.withResolvers<void>();
    const finishStatus = Promise.withResolvers<void>();
    const readStarted = Promise.withResolvers<void>();
    const finishRead = Promise.withResolvers<void>();
    const promptStarted = Promise.withResolvers<void>();
    const finishPrompt = Promise.withResolvers<void>();
    try {
      await prepared.connection.startSession({
        ...root,
        runtimePolicy: { kind: "opencode" },
        systemPrompt: "Build it",
      });
      const status = harness.client.mcp.status;
      harness.client.mcp.status = async (...args) => {
        statusStarted.resolve();
        await finishStatus.promise;
        return status(...args);
      };
      const get = harness.client.session.get;
      harness.client.session.get = async (...args) => {
        readStarted.resolve();
        await finishRead.promise;
        return get(...args);
      };
      const prompt = harness.client.session.promptAsync;
      harness.client.session.promptAsync = async (...args) => {
        promptStarted.resolve();
        const result = prompt(...args);
        await finishPrompt.promise;
        return result;
      };
      const sending = prepared.connection
        .sendUserMessage({
          ...root,
          runtimePolicy: { kind: "opencode" },
          parts: [{ kind: "text", text: "First message" }],
        })
        .then(
          (message) => ({ message }),
          (error: Error) => ({ error }),
        );
      let reading: ReturnType<typeof prepared.connection.readSessionSources> | undefined;
      try {
        await statusStarted.promise;
        reading = prepared.connection.readSessionSources("/repo", [root]);
        // Let the attachment try to enter while the send still validates its MCP binding.
        await Promise.race([readStarted.promise, new Promise((resolve) => setTimeout(resolve, 0))]);
        finishStatus.resolve();
        expect(await Promise.race([promptStarted.promise.then(() => "sent"), sending])).toBe(
          "sent",
        );
        await readStarted.promise;
        expect(harness.promptCalls).toHaveLength(1);
        finishRead.resolve();
        expect((await reading).failures).toEqual([]);
        expect(await Promise.race([sending, Promise.resolve("pending")])).toBe("pending");
        finishPrompt.resolve();
        expect(await sending).toMatchObject({ message: { message: "First message" } });
      } finally {
        finishStatus.resolve();
        finishRead.resolve();
        finishPrompt.resolve();
        await sending;
        await reading;
      }
    } finally {
      await prepared.release();
    }
  });

  test("returns MCP preparation failures and releases queued attachments for recovery", async () => {
    const harness = createLiveClientHarness();
    harness.setPendingApproval(false);
    const prepared = await createPrepareRuntime(harness)(runtimeInput);
    const root = workflowRoot();
    try {
      await prepared.connection.startSession({
        ...root,
        runtimePolicy: { kind: "opencode" },
        systemPrompt: "Build it",
      });
      const status = harness.client.mcp.status;
      harness.client.mcp.status = async () => {
        throw new Error("MCP readiness failed");
      };
      const message = {
        ...root,
        runtimePolicy: { kind: "opencode" as const },
        parts: [{ kind: "text" as const, text: "First message" }],
      };
      const sending = prepared.connection.sendUserMessage(message);
      const reading = prepared.connection.readSessionSources("/repo", [root]);
      await expect(sending).rejects.toThrow("MCP readiness failed");
      expect(
        await Promise.race([
          reading.then((read) => read.failures),
          new Promise((resolve) => setTimeout(() => resolve("blocked"), 50)),
        ]),
      ).toEqual([]);
      expect(harness.promptCalls).toEqual([]);
      harness.client.mcp.status = status;
      await prepared.connection.sendUserMessage(message);
      expect(harness.promptCalls).toHaveLength(1);
    } finally {
      await prepared.release();
    }
  });

  test("keeps source reads and live events available while the native prompt response is pending", async () => {
    const harness = createLiveClientHarness();
    const promptStarted = Promise.withResolvers<void>();
    const finishPrompt = Promise.withResolvers<void>();
    const prompt = harness.client.session.promptAsync;
    harness.client.session.promptAsync = async (...args) => {
      promptStarted.resolve();
      await finishPrompt.promise;
      return prompt(...args);
    };
    const prepared = await createPrepareRuntime(harness)(runtimeInput);
    const signals: OpencodeSessionRuntimeSignal[] = [];
    await resumeOpenDucktorSession(prepared);
    await prepared.startForwarding((signal) => {
      signals.push(signal);
    });
    const sending = prepared.connection.sendUserMessage({
      repoPath: "/repo",
      runtimeKind: "opencode",
      runtimePolicy: { kind: "opencode" },
      workingDirectory: "/repo",
      externalSessionId: "session-1",
      sessionScope: { kind: "repository" },
      parts: [{ kind: "text", text: "Continue" }],
    });
    let reading: ReturnType<typeof prepared.connection.readSessionSources> | undefined;
    try {
      await promptStarted.promise;
      reading = prepared.connection.readSessionSources("/repo");
      expect(
        await Promise.race([
          reading.then(() => "read"),
          new Promise((resolve) => setTimeout(() => resolve("blocked"), 50)),
        ]),
      ).toBe("read");
      await harness.emitAndWait(sessionStatusEvent({ type: "busy" }, "session-1"));
      expect(signals).toContainEqual({
        type: "session_event",
        externalSessionId: "session-1",
        event: expect.objectContaining({
          type: "session_status",
          status: { type: "busy", message: null },
        }),
      });
    } finally {
      finishPrompt.resolve();
      await sending;
      await reading;
      await prepared.release();
    }
  });

  test("keeps source reads and live events available while slash-command admission is pending", async () => {
    const harness = createLiveClientHarness();
    const commandStarted =
      Promise.withResolvers<Parameters<OpencodeClient["session"]["command"]>[0]>();
    let commandCalls = 0;
    harness.client.session.command = async (request) => {
      commandCalls += 1;
      commandStarted.resolve(request);
      // The response succeeds before the stream admits the command message.
      return {
        data: {
          info: createOpencodeMessageInfoFixture({
            id: "assistant-command-response",
            sessionID: "session-1",
            role: "assistant",
          }),
          parts: [],
        },
        error: undefined,
      };
    };
    const prepared = await createPrepareRuntime(harness)(runtimeInput);
    const signals: OpencodeSessionRuntimeSignal[] = [];
    let sending: ReturnType<typeof prepared.connection.sendUserMessage> | undefined;
    let reading: ReturnType<typeof prepared.connection.readSessionSources> | undefined;
    try {
      await resumeOpenDucktorSession(prepared);
      await prepared.startForwarding((signal) => {
        signals.push(signal);
      });
      sending = prepared.connection.sendUserMessage({
        repoPath: "/repo",
        runtimeKind: "opencode",
        runtimePolicy: { kind: "opencode" },
        workingDirectory: "/repo",
        externalSessionId: "session-1",
        sessionScope: { kind: "repository" },
        parts: [
          {
            kind: "slash_command",
            command: { id: "review", trigger: "review", title: "Review", hints: [] },
          },
        ],
      });
      const outcome = sending.then(
        (message) => ({ message }),
        (error: Error) => ({ error }),
      );
      const request = await commandStarted.promise;
      if (!request.messageID) throw new Error("The native command did not receive a message ID.");
      reading = prepared.connection.readSessionSources("/repo");
      expect(
        await Promise.race([
          reading.then((read) => read.failures),
          new Promise((resolve) => setTimeout(() => resolve("blocked"), 50)),
        ]),
      ).toEqual([]);
      await harness.emitAndWait(sessionStatusEvent({ type: "busy" }, "session-1"));
      expect(signals).toContainEqual({
        type: "session_event",
        externalSessionId: "session-1",
        event: expect.objectContaining({
          type: "session_status",
          status: { type: "busy", message: null },
        }),
      });
      expect(await Promise.race([outcome, Promise.resolve("pending")])).toBe("pending");
      await harness.emitAndWait({
        type: "message.updated",
        properties: {
          info: { id: request.messageID, sessionID: "session-1", role: "user" },
        },
      });
      expect(await outcome).toMatchObject({
        message: { messageId: request.messageID, message: "/review" },
      });
      expect(commandCalls).toBe(1);
      expect(harness.promptCalls).toEqual([]);
    } finally {
      await prepared.release();
      await Promise.allSettled([sending, reading]);
    }
  });

  test.each(["start", "fork", "resume"] as const)(
    "keeps an idle session idle during %s and status refresh, then follows its real turn",
    async (mode) => {
      const harness = createLiveClientHarness();
      harness.setPendingApproval(false);
      harness.client.session.create = async (request) => ({
        data: createOpencodeSessionFixture({
          id: "session-1",
          directory: "/repo",
          permission: request?.permission ?? [],
          metadata: request?.metadata,
        }),
        error: undefined,
      });
      harness.client.session.fork = async () => ({
        data: createOpencodeSessionFixture({ id: "session-1", directory: "/repo" }),
        error: undefined,
      });
      const prepared = await createPrepareRuntime(harness)(runtimeInput);
      const signals: OpencodeSessionRuntimeSignal[] = [];
      await prepared.startForwarding((signal) => {
        signals.push(signal);
      });
      const ref = {
        repoPath: "/repo",
        runtimeKind: "opencode" as const,
        workingDirectory: "/repo",
        externalSessionId: "session-1",
      };
      const input = {
        ...ref,
        runtimePolicy: { kind: "opencode" as const },
        sessionScope: { kind: "repository" as const },
        systemPrompt: "",
      };
      try {
        const summary =
          mode === "start"
            ? await prepared.connection.startSession(input)
            : mode === "fork"
              ? await prepared.connection.forkSession({
                  ...input,
                  parentExternalSessionId: "parent",
                })
              : await prepared.connection.resumeSession(input);
        expect(summary.status).toBe("idle");
        const read = await prepared.connection.readSessionSources(input.repoPath, [input]);
        expect(read.sources[0]?.runtimeActivity).toBe("idle");

        await harness.emitAndWait(sessionStatusEvent({ type: "busy" }, "session-1"));
        expect(
          signals.some(
            (signal) => signal.type === "session_event" && signal.event.type === "session_started",
          ),
        ).toBe(false);
        expect((await prepared.connection.resumeSession(input)).status).toBe("running");

        await harness.emitAndWait(sessionStatusEvent({ type: "idle" }, "session-1"));
        expect((await prepared.connection.resumeSession(input)).status).toBe("idle");
        expect(harness.promptCalls).toEqual([]);
      } finally {
        await prepared.release();
      }
    },
  );

  test("reattaches to a restored active session without settling its control status", async () => {
    const harness = createLiveClientHarness({ busySessionIds: ["session-1"] });
    harness.setPendingApproval(false);
    const prepared = await createPrepareRuntime(harness)(runtimeInput);
    const input = {
      repoPath: "/repo",
      runtimeKind: "opencode" as const,
      workingDirectory: "/repo",
      externalSessionId: "session-1",
      runtimePolicy: { kind: "opencode" as const },
      sessionScope: { kind: "repository" as const },
    };
    try {
      const read = await prepared.connection.readSessionSources(input.repoPath, [input]);
      expect(read.sources[0]?.runtimeActivity).toBe("running");
      expect((await prepared.connection.resumeSession(input)).status).toBe("running");
      expect(harness.promptCalls).toEqual([]);
    } finally {
      await prepared.release();
    }
  });

  test("reads scoped restored roots and children without binding or changing live state", async () => {
    const harness = createLiveClientHarness({
      externalSessionIds: ["session-1", "child-session"],
      parentSessionIdsBySessionId: { "child-session": "session-1" },
      childSessionIdsByParent: { "session-1": ["child-session"] },
    });
    const todoCalls: string[] = [];
    let updateCalls = 0;
    const update = harness.client.session.update;
    harness.client.session.update = async (...args) => {
      updateCalls += 1;
      return update(...args);
    };
    harness.client.session.todo = async ({ sessionID }) => {
      todoCalls.push(sessionID);
      return { data: [], error: undefined };
    };
    const prepared = await createPrepareRuntime(harness)(runtimeInput);
    const signals: OpencodeSessionRuntimeSignal[] = [];
    await prepared.startForwarding((signal) => {
      signals.push(signal);
    });
    try {
      const before = await prepared.connection.readSessionSources("/repo", [
        {
          repoPath: "/repo",
          runtimeKind: "opencode",
          externalSessionId: "session-1",
          workingDirectory: "/repo",
          sessionScope: { kind: "repository" },
        },
      ]);
      const input = {
        repoPath: "/repo",
        runtimeKind: "opencode" as const,
        workingDirectory: "/repo",
        runtimePolicy: { kind: "opencode" as const },
        sessionScope: { kind: "repository" as const },
      };
      for (const externalSessionId of ["session-1", "child-session"]) {
        await expect(
          prepared.queries.loadSessionHistory({ ...input, externalSessionId }),
        ).resolves.toEqual([]);
        await expect(
          prepared.queries.loadSessionTodos({ ...input, externalSessionId }),
        ).resolves.toEqual([]);
      }
      expect(
        await prepared.connection.readSessionSources("/repo", [
          {
            repoPath: "/repo",
            runtimeKind: "opencode",
            externalSessionId: "session-1",
            workingDirectory: "/repo",
            sessionScope: { kind: "repository" },
          },
        ]),
      ).toEqual(before);
      expect(harness.promptCalls).toEqual([]);
      expect(updateCalls).toBe(0);
      expect(harness.permissionReplyCalls).toEqual([]);
      expect(harness.questionReplyCalls).toEqual([]);
      expect(signals).toEqual([]);
      expect(todoCalls).toEqual(["session-1", "child-session"]);
      await prepared.connection.resumeSession({ ...input, externalSessionId: "session-1" });
      await expect(
        prepared.queries.loadSessionHistory({ ...input, externalSessionId: "child-session" }),
      ).resolves.toEqual([]);
      await expect(
        prepared.queries.loadSessionTodos({ ...input, externalSessionId: "child-session" }),
      ).resolves.toEqual([]);
      await expect(
        prepared.queries.loadSessionHistory({
          ...input,
          externalSessionId: "session-1",
          sessionScope: { kind: "workflow", taskId: "other-task", role: "build" },
        }),
      ).rejects.toMatchObject({ code: "scope_mismatch" });
    } finally {
      await prepared.release();
    }
  });
  test("prepares event transport without enumerating runtime sessions", async () => {
    const harness = createLiveClientHarness();

    const prepared = await createPrepareRuntime(harness)(runtimeInput);

    expect(harness.callOrder).toEqual(["subscribe", "connected"]);
    expect(harness.messageCalls).toEqual([]);
    await prepared.release();
  });

  test("lists only owned roots and verified descendants", async () => {
    const harness = createLiveClientHarness({
      externalSessionIds: ["session-1", "child-session", "unknown-session"],
      childSessionIdsByParent: { "session-1": ["child-session"] },
      busySessionIds: ["session-1", "child-session"],
      parentSessionIdsBySessionId: { "child-session": "session-1" },
    });
    const prepared = await createPrepareRuntime(harness)(runtimeInput);

    const { sources } = await prepared.connection.readSessionSources("/repo", [
      {
        repoPath: "/repo",
        runtimeKind: "opencode",
        externalSessionId: "session-1",
        workingDirectory: "/repo",
        sessionScope: { kind: "repository" },
      },
    ]);

    expect(sources).toEqual(
      expect.arrayContaining([
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
      ]),
    );
    expect(sources).toHaveLength(2);
    expect(harness.callOrder).not.toContain("list");
    expect(harness.callOrder).toContain("get:session-1");
    expect(harness.callOrder).toContain("children:session-1");
    await prepared.release();
  });

  test("does not restore a released root from cached sources", async () => {
    const harness = createLiveClientHarness();
    const prepared = await createPrepareRuntime(harness)(runtimeInput);
    const ref = {
      repoPath: "/repo",
      runtimeKind: "opencode" as const,
      externalSessionId: "session-1",
      workingDirectory: "/repo",
    };
    try {
      await prepared.connection.readSessionSources("/repo", [
        { ...ref, sessionScope: { kind: "repository" } },
      ]);
      const readsBeforeRelease = harness.callOrder.filter(
        (call) => call === "get:session-1",
      ).length;

      await prepared.connection.releaseSession(ref);
      const { sources } = await prepared.connection.readSessionSources("/repo");

      expect(sources).toEqual([]);
      expect(harness.callOrder.filter((call) => call === "get:session-1")).toHaveLength(
        readsBeforeRelease,
      );
    } finally {
      await prepared.release();
    }
  });

  test("keeps a root authorized when release fails", async () => {
    const harness = createLiveClientHarness();
    const prepared = await createPrepareRuntime(harness)(runtimeInput);
    const ref = {
      repoPath: "/repo",
      runtimeKind: "opencode" as const,
      externalSessionId: "session-1",
      workingDirectory: "/repo",
    };
    try {
      await resumeOpenDucktorSession(prepared);
      await prepared.connection.readSessionSources("/repo", [
        { ...ref, sessionScope: { kind: "repository" } },
      ]);

      await expect(
        prepared.connection.releaseSession({ ...ref, workingDirectory: "/other" }),
      ).rejects.toThrow("Cannot release OpenCode session");
      expect((await prepared.connection.readSessionSources("/repo")).sources).toEqual(
        expect.arrayContaining([expect.objectContaining({ externalSessionId: "session-1" })]),
      );
    } finally {
      await prepared.release();
    }
  });

  test("keeps a session registered when an older refresh omits it", async () => {
    let markListStarted: () => void = () => undefined;
    let finishList: () => void = () => undefined;
    const listStarted = new Promise<void>((resolve) => {
      markListStarted = resolve;
    });
    const listBarrier = new Promise<void>((resolve) => {
      finishList = resolve;
    });
    let firstRead = true;
    const harness = createLiveClientHarness({
      externalSessionIds: [],
      onPermissionList: markListStarted,
      permissionListBarrier: () => {
        if (!firstRead) return Promise.resolve();
        firstRead = false;
        return listBarrier;
      },
    });
    const prepared = await createPrepareRuntime(harness)(runtimeInput);
    const signals: OpencodeSessionRuntimeSignal[] = [];
    await prepared.startForwarding((signal) => {
      signals.push(signal);
    });

    const refresh = prepared.connection.readSessionSources("/repo", [
      {
        repoPath: "/repo",
        runtimeKind: "opencode",
        externalSessionId: "session-1",
        workingDirectory: "/repo",
        sessionScope: { kind: "repository" },
      },
    ]);
    await listStarted;
    await resumeOpenDucktorSession(prepared);
    finishList();
    await refresh;
    await harness.emitAndWait(sessionStatusEvent({ type: "busy" }, "session-1"));

    expect(signals).toContainEqual({
      type: "session_event",
      externalSessionId: "session-1",
      event: expect.objectContaining({ type: "session_status" }),
    });
    await prepared.release();
  });

  test("lists parent lineage for a child session", async () => {
    const harness = createLiveClientHarness({
      externalSessionIds: ["child-session"],
      parentSessionIdsBySessionId: { "child-session": "parent-session" },
      childSessionIdsByParent: { "parent-session": ["child-session"] },
    });
    const prepared = await createPrepareRuntime(harness)(runtimeInput);

    const { sources } = await prepared.connection.readSessionSources("/repo", [
      {
        repoPath: "/repo",
        runtimeKind: "opencode",
        externalSessionId: "parent-session",
        workingDirectory: "/repo",
        sessionScope: { kind: "repository" },
      },
    ]);

    expect(sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          externalSessionId: "child-session",
          parentExternalSessionId: "parent-session",
        }),
      ]),
    );
    await prepared.release();
  });

  test("retains authorized workflow ownership in runtime snapshots", async () => {
    const harness = createLiveClientHarness();
    const prepared = await createPrepareRuntime(harness)(runtimeInput);
    await prepared.connection.resumeSession({
      repoPath: "/repo",
      runtimeKind: "opencode",
      runtimePolicy: { kind: "opencode" },
      workingDirectory: "/repo",
      externalSessionId: "session-1",
      sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
    });

    const { sources } = await prepared.connection.readSessionSources("/repo", [
      {
        repoPath: "/repo",
        runtimeKind: "opencode",
        externalSessionId: "session-1",
        workingDirectory: "/repo",
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      },
    ]);

    expect(sources[0]?.sessionAssociation).toEqual({
      kind: "workflow",
      taskId: "task-1",
      role: "build",
    });
    await prepared.release();
  });

  test("forwards context updates for a verified descendant", async () => {
    const harness = createLiveClientHarness({
      externalSessionIds: ["session-1", "child-session"],
      childSessionIdsByParent: { "session-1": ["child-session"] },
    });
    const prepared = await createPrepareRuntime(harness)(runtimeInput);
    const signals: OpencodeSessionRuntimeSignal[] = [];
    await prepared.connection.readSessionSources("/repo", [
      {
        repoPath: "/repo",
        runtimeKind: "opencode",
        externalSessionId: "session-1",
        workingDirectory: "/repo",
        sessionScope: { kind: "repository" },
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

  test("forwards deletion for a watched session tree", async () => {
    const harness = createLiveClientHarness({
      externalSessionIds: ["session-1", "child-session"],
      childSessionIdsByParent: { "session-1": ["child-session"] },
    });
    const prepared = await createPrepareRuntime(harness)(runtimeInput);
    const signals: OpencodeSessionRuntimeSignal[] = [];
    await prepared.connection.readSessionSources("/repo", [
      {
        repoPath: "/repo",
        runtimeKind: "opencode",
        externalSessionId: "session-1",
        workingDirectory: "/repo",
        sessionScope: { kind: "repository" },
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

    const childInput = {
      repoPath: "/repo",
      runtimeKind: "opencode" as const,
      runtimePolicy: { kind: "opencode" as const },
      workingDirectory: "/repo",
      externalSessionId: "child-session",
      sessionScope: { kind: "repository" as const },
    };
    await prepared.connection.resumeSession(childInput);
    expect(harness.callOrder.filter((call) => call === "get:child-session")).toHaveLength(2);

    harness.setExternalSessionIds(["session-1"]);
    await prepared.connection.readSessionSources("/repo", [
      {
        repoPath: "/repo",
        runtimeKind: "opencode",
        externalSessionId: "session-1",
        workingDirectory: "/repo",
        sessionScope: { kind: "repository" },
      },
    ]);
    await prepared.connection.resumeSession(childInput);
    expect(harness.callOrder.filter((call) => call === "get:child-session")).toHaveLength(3);
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

  test("refreshes one repository without releasing sessions of another repository", async () => {
    const harness = createLiveClientHarness({ externalSessionIds: ["session-a", "session-b"] });
    const prepared = await createPrepareRuntime(harness)(runtimeInput);
    const signals: OpencodeSessionRuntimeSignal[] = [];
    await prepared.startForwarding((signal) => {
      signals.push(signal);
    });
    const root = (repoPath: string, externalSessionId: string) => ({
      repoPath,
      runtimeKind: "opencode" as const,
      externalSessionId,
      workingDirectory: "/repo",
      sessionScope: { kind: "repository" as const },
    });
    try {
      const readA = await prepared.connection.readSessionSources("/repo-a", [
        root("/repo-a", "session-a"),
      ]);
      const readB = await prepared.connection.readSessionSources("/repo-b", [
        root("/repo-b", "session-b"),
      ]);
      expect(
        readA.sources.map(({ repoPath, externalSessionId }) => [repoPath, externalSessionId]),
      ).toEqual([["/repo-a", "session-a"]]);
      expect(
        readB.sources.map(({ repoPath, externalSessionId }) => [repoPath, externalSessionId]),
      ).toEqual([["/repo-b", "session-b"]]);

      const emptiedA = await prepared.connection.readSessionSources("/repo-a", []);
      expect(emptiedA.sources).toEqual([]);

      await harness.emitAndWait(sessionStatusEvent({ type: "busy" }, "session-b"));
      expect(signals).toContainEqual({
        type: "session_event",
        externalSessionId: "session-b",
        event: expect.objectContaining({ type: "session_status" }),
      });
      const rereadB = await prepared.connection.readSessionSources("/repo-b");
      expect(rereadB.sources).toEqual([
        expect.objectContaining({ repoPath: "/repo-b", externalSessionId: "session-b" }),
      ]);
      expect((await prepared.connection.readSessionSources("/repo-a")).sources).toEqual([]);
    } finally {
      await prepared.release();
    }
  });

  test("rejects roots of another repository in a repository refresh", async () => {
    const harness = createLiveClientHarness();
    const prepared = await createPrepareRuntime(harness)(runtimeInput);
    try {
      await expect(
        prepared.connection.readSessionSources("/repo-a", [
          {
            repoPath: "/repo-b",
            runtimeKind: "opencode",
            externalSessionId: "session-1",
            workingDirectory: "/repo",
            sessionScope: { kind: "repository" },
          },
        ]),
      ).rejects.toThrow("Cannot refresh OpenCode sessions of repository '/repo-a'");
    } finally {
      await prepared.release();
    }
  });

  test("adds the MCP server again after OpenCode disposes its directory instance", async () => {
    const harness = createLiveClientHarness();
    const mcpAdds: string[] = [];
    const add = harness.client.mcp.add;
    harness.client.mcp.add = async (...args) => {
      mcpAdds.push(args[0]?.directory ?? "");
      return add(...args);
    };
    const prepared = await createPrepareRuntime(harness)(runtimeInput);
    await prepared.startForwarding(() => undefined);
    try {
      await resumeOpenDucktorSession(prepared);
      await resumeOpenDucktorSession(prepared);
      expect(mcpAdds).toEqual(["/repo"]);

      await harness.emitAndWait({
        type: "server.instance.disposed",
        properties: { directory: "/repo" },
      });
      await resumeOpenDucktorSession(prepared);

      expect(mcpAdds).toEqual(["/repo", "/repo"]);
    } finally {
      await prepared.release();
    }
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
      if (signal.event.message.length === 0) {
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

  test("forwards pending input as live session state events", async () => {
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
    expect(sessionStatuses).toEqual(["busy"]);
    expect(transcriptEventTypes).not.toContain("user_message");
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

    expect(sessionStatuses).toEqual(["busy", "busy"]);
    expect(transcriptEventTypes).toContain("session_idle");
    expect(transcriptEventTypes).toContain("assistant_message");
    await prepared.release();
  });

  test("waits for its send activity when native events are still being delivered", async () => {
    const harness = createLiveClientHarness();
    const prepared = await createPrepareRuntime(harness)(runtimeInput);
    const nativeStatusStarted = Promise.withResolvers<void>();
    const nativeStatusGate = Promise.withResolvers<void>();
    const nativePartStarted = Promise.withResolvers<void>();
    const nativePartGate = Promise.withResolvers<void>();
    const sendStatusStarted = Promise.withResolvers<void>();
    const sendStatusGate = Promise.withResolvers<void>();
    const pending: Promise<unknown>[] = [];
    try {
      await resumeOpenDucktorSession(prepared);
      let statusCount = 0;
      await prepared.startForwarding(async (signal) => {
        if (signal.type !== "session_event") return;
        if (signal.event.type === "session_status") {
          statusCount++;
          const started = statusCount === 1 ? nativeStatusStarted : sendStatusStarted;
          const gate = statusCount === 1 ? nativeStatusGate : sendStatusGate;
          started.resolve();
          await gate.promise;
        } else if (signal.event.type === "assistant_part") {
          nativePartStarted.resolve();
          await nativePartGate.promise;
        }
      });
      pending.push(
        harness.emitAndWait(
          createOpencodeMessageEventGroupFixture({
            info: { id: "assistant-1", sessionID: "session-1", role: "assistant" },
            parts: [
              {
                id: "assistant-tool",
                sessionID: "session-1",
                messageID: "assistant-1",
                type: "tool",
                callID: "call-1",
                tool: "read",
                state: {
                  status: "running",
                  input: {},
                  title: "Read README",
                  time: { start: 1 },
                },
              },
            ],
          }),
        ),
      );
      await nativeStatusStarted.promise;
      pending.push(
        prepared.connection.sendUserMessage({
          repoPath: "/repo",
          runtimeKind: "opencode",
          runtimePolicy: { kind: "opencode" },
          workingDirectory: "/repo",
          externalSessionId: "session-1",
          sessionScope: { kind: "repository" },
          parts: [{ kind: "text", text: "Do the work" }],
        }),
      );
      nativeStatusGate.resolve();
      await nativePartStarted.promise;
      nativePartGate.resolve();
      await sendStatusStarted.promise;
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(harness.promptCalls).toEqual([]);
      sendStatusGate.resolve();
      await Promise.all(pending);
      expect(harness.promptCalls).toHaveLength(1);
    } finally {
      nativeStatusGate.resolve();
      nativePartGate.resolve();
      sendStatusGate.resolve();
      await Promise.all(pending);
      await prepared.release();
    }
  });

  test.each([
    ["succeeds", false],
    ["fails", true],
  ] as const)(
    "reports a rejected prompt as idle and keeps send errors when idle delivery %s",
    async (_case, failIdleDelivery) => {
      const harness = createLiveClientHarness();
      const promptError = new Error("prompt rejected");
      const idleError = new Error("idle delivery failed");
      harness.client.session.promptAsync = async () => {
        throw promptError;
      };
      const prepared = await createPrepareRuntime(harness)(runtimeInput);
      try {
        await resumeOpenDucktorSession(prepared);
        const activity: string[] = [];
        await prepared.startForwarding((signal) => {
          if (signal.type !== "session_event") return;
          activity.push(signal.event.type);
          if (signal.event.type === "session_idle" && failIdleDelivery) throw idleError;
        });
        const send = prepared.connection.sendUserMessage({
          repoPath: "/repo",
          runtimeKind: "opencode",
          runtimePolicy: { kind: "opencode" },
          workingDirectory: "/repo",
          externalSessionId: "session-1",
          sessionScope: { kind: "repository" },
          parts: [{ kind: "text", text: "Do the work" }],
        });
        if (failIdleDelivery) {
          await expect(send).rejects.toMatchObject({
            errors: [
              expect.objectContaining({ message: expect.stringContaining("prompt rejected") }),
              idleError,
            ],
          });
        } else {
          await expect(send).rejects.toThrow("prompt rejected");
        }
        expect(activity).toEqual(["session_status", "session_idle"]);
      } finally {
        await prepared.release();
      }
    },
  );

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

test("restores workflow roots and descendant denies before publishing reload sources", async () => {
  const children = ["child-session"];
  const harness = createLiveClientHarness({
    externalSessionIds: ["session-1", "child-session"],
    childSessionIdsByParent: { "session-1": children },
  });
  const native = [
    { permission: "bash", pattern: "git *", action: "ask" as const },
    { permission: "task", pattern: "*", action: "deny" as const },
  ];
  const metadata = new Map<string, NonNullable<Session["metadata"]>>();
  const rules = new Map<string, OpencodePermissionRule[]>([
    ["session-1", native],
    ["child-session", [...native]],
  ]);
  const get = harness.client.session.get;
  harness.client.session.get = async (...args) => {
    const response = await get(...args);
    return {
      ...response,
      data: {
        ...response.data!,
        permission: rules.get(args[0].sessionID),
        metadata: metadata.get(args[0].sessionID),
      },
    };
  };
  const updates: Parameters<typeof harness.client.session.update>[0][] = [];
  harness.client.session.update = async (request) => {
    if (request.metadata) metadata.set(request.sessionID, request.metadata);
    updates.push(request);
    const permission = [...(rules.get(request.sessionID) ?? []), ...(request.permission ?? [])];
    rules.set(request.sessionID, permission);
    return {
      data: createOpencodeSessionFixture({
        id: request.sessionID,
        directory: "/repo",
        metadata: metadata.get(request.sessionID),
        permission,
      }),
      error: undefined,
    };
  };
  const prepared = await createPrepareRuntime(harness)(runtimeInput);
  const root = {
    repoPath: "/repo",
    runtimeKind: "opencode" as const,
    workingDirectory: "/repo",
    externalSessionId: "session-1",
    sessionScope: { kind: "workflow" as const, taskId: "task-1", role: "qa" as const },
  };
  try {
    const read = await prepared.connection.readSessionSources("/repo", [root]);
    expect(read.failures).toEqual([]);
    expect(read.sources).toHaveLength(2);
    expect(read.sources[0]?.sessionAssociation).toEqual(root.sessionScope);
    expect(read.sources[1]?.sessionAssociation).toEqual(root.sessionScope);
    expect(rules.get("session-1")?.slice(0, native.length)).toEqual(native);
    expect(rules.get("session-1")).toContainEqual({
      permission: "edit",
      pattern: "*",
      action: "deny",
    });
    expect(rules.get("session-1")).toContainEqual({
      permission: "odt_qa_approved",
      pattern: "*",
      action: "allow",
    });
    const childRules = rules.get("child-session")!;
    expect(childRules.slice(0, native.length)).toEqual(native);
    expect(childRules).toContainEqual({ permission: "edit", pattern: "*", action: "deny" });
    expect(childRules.slice(native.length).every((rule) => rule.action === "deny")).toBe(true);
    const count = updates.length;
    await prepared.connection.readSessionSources("/repo", [root]);
    await prepared.connection.readSessionSources("/repo");
    await prepared.queries.loadSessionHistory({ ...root, runtimePolicy: { kind: "opencode" } });
    expect(updates).toHaveLength(count);

    const lateNative: OpencodePermissionRule[] = [
      { permission: "bash", pattern: "git status", action: "allow" },
    ];
    children.push("late-child");
    rules.set("late-child", lateNative);
    const update = harness.client.session.update;
    harness.client.session.update = async () => ({
      data: undefined,
      error: new Error("late child permission update rejected"),
    });
    const failed = await prepared.connection.readSessionSources("/repo");
    expect(failed.sources).toEqual([]);
    expect(failed.failures).toEqual([
      expect.objectContaining({
        externalSessionId: root.externalSessionId,
        message: expect.stringContaining("late child permission update rejected"),
      }),
    ]);
    expect(failed.failures[0]?.message).toContain("late-child");
    await expect(
      prepared.connection.sendUserMessage({
        ...root,
        runtimePolicy: { kind: "opencode" },
        parts: [{ kind: "text", text: "blocked" }],
      }),
    ).rejects.toThrow("permissions");
    expect(harness.promptCalls).toEqual([]);

    harness.client.session.update = update;
    const recovered = await prepared.connection.readSessionSources("/repo", [root]);
    expect(recovered.failures).toEqual([]);
    expect(recovered.sources).toHaveLength(3);
    expect(
      recovered.sources.find((source) => source.externalSessionId === "late-child"),
    ).toMatchObject({ sessionAssociation: root.sessionScope });
    const lateRules = rules.get("late-child")!;
    expect(lateRules.slice(0, lateNative.length)).toEqual(lateNative);
    expect(lateRules).toContainEqual({ permission: "edit", pattern: "*", action: "deny" });
    expect(lateRules.slice(lateNative.length).every((rule) => rule.action === "deny")).toBe(true);
    expect(updates).toHaveLength(count + 1);
    await prepared.connection.readSessionSources("/repo");
    expect(updates).toHaveLength(count + 1);
  } finally {
    await prepared.release();
  }
});

test("keeps repository roots available after a source read failure without changing permissions", async () => {
  const harness = createLiveClientHarness();
  const get = harness.client.session.get;
  harness.client.session.get = async () => ({
    data: undefined,
    error: new Error("native session unavailable"),
  });
  harness.client.session.update = async () => {
    throw new Error("Repository source reads must not write permissions");
  };
  const prepared = await createPrepareRuntime(harness)(runtimeInput);
  try {
    const read = await prepared.connection.readSessionSources("/repo", [
      {
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo",
        externalSessionId: "session-1",
        sessionScope: { kind: "repository" },
      },
    ]);
    expect(read.sources).toEqual([]);
    expect(read.failures).toHaveLength(1);
    harness.client.session.get = get;
    const recovered = await prepared.connection.readSessionSources("/repo");
    expect(recovered.failures).toEqual([]);
    expect(recovered.sources).toHaveLength(1);
    expect(recovered.sources[0]?.sessionAssociation).toEqual({ kind: "repository" });
  } finally {
    await prepared.release();
  }
});

test("reports failed reload permission setup and excludes the workflow tree", async () => {
  const harness = createLiveClientHarness({
    externalSessionIds: ["session-1", "child-session"],
    childSessionIdsByParent: { "session-1": ["child-session"] },
  });
  const update = harness.client.session.update;
  harness.client.session.update = async () => ({
    data: undefined,
    error: new Error("permission API unavailable"),
    response: new Response(null, { status: 503 }),
  });
  const failingUpdate = harness.client.session.update;
  const prepared = await createPrepareRuntime(harness)(runtimeInput);
  const root = {
    repoPath: "/repo",
    runtimeKind: "opencode" as const,
    workingDirectory: "/repo",
    externalSessionId: "session-1",
    sessionScope: { kind: "workflow" as const, taskId: "task-1", role: "spec" as const },
  };
  try {
    const read = await prepared.connection.readSessionSources("/repo", [root]);
    expect(read.sources).toEqual([]);
    expect(read.failures).toEqual([
      expect.objectContaining({
        externalSessionId: "session-1",
        workingDirectory: "/repo",
        message: expect.stringContaining("permission API unavailable"),
      }),
    ]);
    expect(read.failures[0]?.message).toContain("Reconnect the selected OpenCode runtime");
    expect((await prepared.connection.readSessionSources("/repo")).sources).toEqual([]);
    await expect(
      prepared.connection.sendUserMessage({
        ...root,
        runtimePolicy: { kind: "opencode" },
        parts: [{ kind: "text", text: "blocked" }],
      }),
    ).rejects.toThrow("permissions");
    expect(harness.promptCalls).toEqual([]);
    harness.client.session.update = update;
    const recovered = await prepared.connection.readSessionSources("/repo", [root]);
    expect(recovered.failures).toEqual([]);
    expect(recovered.sources).toHaveLength(2);
    for (const sessionID of ["session-1", "child-session"])
      await harness.client.session.update({
        sessionID,
        directory: "/repo",
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
      });
    const get = harness.client.session.get;
    const readEntered = Promise.withResolvers<void>();
    const releaseRead = Promise.withResolvers<void>();
    const approvalDelivered = Promise.withResolvers<void>();
    await prepared.startForwarding((signal) => {
      if (
        signal.type === "session_event" &&
        signal.event.type === "approval_required" &&
        signal.event.requestId === "approval-during-attachment"
      )
        approvalDelivered.resolve();
    });
    harness.client.session.get = async (...args) => {
      readEntered.resolve();
      await releaseRead.promise;
      return get(...args);
    };
    harness.client.session.update = failingUpdate;
    const restoring = prepared.connection.readSessionSources("/repo", [root]);
    await readEntered.promise;
    const sends = Promise.allSettled(
      ["session-1", "child-session"].map((externalSessionId) =>
        prepared.connection.sendUserMessage({
          ...root,
          externalSessionId,
          runtimePolicy: { kind: "opencode" },
          parts: [{ kind: "text", text: "attachment pending" }],
        }),
      ),
    );
    try {
      expect(harness.promptCalls).toEqual([]);
      harness.emit(
        permissionAskedEvent({
          sessionId: "session-1",
          requestId: "approval-during-attachment",
          permission: "read",
          patterns: ["README.md"],
        }),
      );
      await approvalDelivered.promise;
    } finally {
      releaseRead.resolve();
      await restoring;
    }
    for (const result of await sends) {
      expect(result.status).toBe("rejected");
      if (result.status === "rejected")
        expect(result.reason.message).toContain("permission API unavailable");
    }
    harness.client.session.get = get;
    expect((await restoring).sources).toEqual([]);
    expect((await prepared.connection.readSessionSources("/repo")).sources).toEqual([]);
    harness.client.session.update = update;
    for (const externalSessionId of ["session-1", "child-session"])
      await expect(
        prepared.connection.sendUserMessage({
          ...root,
          externalSessionId,
          runtimePolicy: { kind: "opencode" },
          parts: [{ kind: "text", text: "still blocked" }],
        }),
      ).rejects.toThrow("permissions");
    expect(harness.promptCalls).toEqual([]);
    expect((await prepared.connection.readSessionSources("/repo", [root])).sources).toHaveLength(2);
    await prepared.connection.sendUserMessage({
      ...root,
      runtimePolicy: { kind: "opencode" },
      parts: [{ kind: "text", text: "recovered" }],
    });
    expect(harness.promptCalls).toHaveLength(1);
  } finally {
    await prepared.release();
  }
});

describe("OpenCode MCP binding of imported and continued work", () => {
  const importRef = {
    repoPath: "/repo",
    runtimeKind: "opencode" as const,
    workingDirectory: "/repo",
    externalSessionId: "session-1",
  };

  /** Prepares a runtime whose managed MCP resolution succeeds only while the bridge is available. */
  const prepareWithBridge = async (bridgeAvailable: () => boolean) => {
    const harness = createLiveClientHarness();
    const mcpAdds: string[] = [];
    const v2Client = createOpencodeClient({
      baseUrl: "http://runtime-1",
      fetch: async () =>
        new Response(
          JSON.stringify({
            data: {
              id: "session-1",
              title: "Imported",
              location: { directory: "/repo" },
              time: { updated: 123 },
            },
          }),
          { headers: { "content-type": "application/json" } },
        ),
    });
    const client: OpencodeClient = {
      ...harness.client,
      v2: v2Client.v2,
      mcp: {
        ...harness.client.mcp,
        add: async (request: Parameters<OpencodeClient["mcp"]["add"]>[0]) => {
          mcpAdds.push(request?.directory ?? "");
          return { data: { openducktor: { status: "connected" } }, error: undefined };
        },
      },
    };
    const prepared = await createPrepareOpencodeSessionRuntime({
      createClient: () => client,
      readDirectory: (_directory, read) => read(),
      resolveMcpServerConfig: async () => {
        if (!bridgeAvailable()) throw new Error("MCP bridge unavailable");
        return TEST_MCP_SERVER_CONFIG;
      },
      now: () => "2026-07-16T10:02:00.000Z",
    })(runtimeInput);
    return { harness, prepared, mcpAdds };
  };

  test("an import attachment binds the directory before it admits the root", async () => {
    let available = false;
    const { prepared, mcpAdds } = await prepareWithBridge(() => available);
    const source = await prepared.sessionImport.inspectSession(importRef);

    await expect(source.attach()).rejects.toThrow("MCP bridge unavailable");
    expect(mcpAdds).toEqual([]);

    available = true;
    await source.attach();
    expect(mcpAdds).toEqual(["/repo"]);
    await prepared.release();
  });

  test("a pending-input reply needs the directory binding first", async () => {
    const { harness, prepared } = await prepareWithBridge(() => false);

    await expect(
      prepared.connection.replyApproval({
        ref: importRef,
        nativeRequestId: "native-request-1",
        outcome: "approve_once",
      }),
    ).rejects.toThrow("MCP bridge unavailable");
    await expect(
      prepared.connection.replyQuestion({
        ref: importRef,
        nativeRequestId: "native-request-1",
        answers: [["yes"]],
      }),
    ).rejects.toThrow("MCP bridge unavailable");
    expect(harness.permissionReplyCalls).toEqual([]);
    expect(harness.questionReplyCalls).toEqual([]);
    await prepared.release();
  });
});

function workflowRoot(): AgentSessionAuthorizedRoot {
  return {
    repoPath: "/repo",
    runtimeKind: "opencode",
    workingDirectory: "/repo",
    externalSessionId: "session-1",
    sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
  };
}

function userSend(
  root: AgentSessionAuthorizedRoot,
  kind: "prompt" | "command" | "compact",
): SendAgentUserMessageInput {
  let parts: SendAgentUserMessageInput["parts"];
  switch (kind) {
    case "prompt":
      parts = [{ kind: "text", text: "Continue" }];
      break;
    case "command":
      parts = [
        {
          kind: "slash_command",
          command: { id: "review", trigger: "review", title: "Review", hints: [] },
        },
      ];
      break;
    case "compact":
      parts = [{ kind: "slash_command", command: MANUAL_SESSION_COMPACTION_SLASH_COMMAND }];
      break;
  }
  return {
    ...root,
    runtimePolicy: { kind: "opencode" },
    model: { providerId: "openai", modelId: "gpt-5" },
    parts,
  };
}

function recordNativeSends(harness: LiveClientHarness, calls: string[]): void {
  harness.client.session.abort = async () => ({ data: true, error: undefined });
  const prompt = harness.client.session.promptAsync;
  harness.client.session.promptAsync = (...args) => {
    calls.push("prompt");
    return prompt(...args);
  };
  harness.client.session.command = async () => {
    calls.push("command");
    return {
      data: {
        info: createOpencodeMessageInfoFixture({
          id: "assistant-1",
          sessionID: "session-1",
          role: "assistant",
        }),
        parts: [],
      },
      error: undefined,
    };
  };
  harness.client.session.summarize = async () => {
    calls.push("compact");
    return { data: true, error: undefined };
  };
}
