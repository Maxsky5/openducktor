import { describe, expect, mock, test } from "bun:test";
import type { Event, OpencodeClient } from "@opencode-ai/sdk/v2/client";
import {
  MANUAL_SESSION_COMPACTION_SLASH_COMMAND,
  OPENCODE_RUNTIME_DESCRIPTOR,
  type RuntimeInstanceSummary,
} from "@openducktor/contracts";
import type { AgentEvent, PolicyBoundSessionRef, RuntimeKind, SessionRef } from "@openducktor/core";
import { workflowAgentSessionScope } from "@openducktor/core";
import { OpencodeSdkAdapter as BaseOpencodeSdkAdapter } from "./opencode-sdk-adapter";
import type { OpencodeSdkAdapterOptions, SessionRecord } from "./types";

type ClientMethodInput<
  Namespace extends keyof OpencodeClient,
  Method extends keyof OpencodeClient[Namespace],
> = OpencodeClient[Namespace][Method] extends (...args: infer Args) => infer _Result
  ? Args[0]
  : never;

const sessionRef = (externalSessionId = "external-session-1"): SessionRef => ({
  externalSessionId,
  repoPath: "/repo",
  runtimeKind: "opencode",
  workingDirectory: "/repo",
});

const sessionRuntimeRef = (
  externalSessionId = "external-session-1",
  overrides: Partial<Omit<PolicyBoundSessionRef, "runtimeKind" | "runtimePolicy">> = {},
): PolicyBoundSessionRef => ({
  externalSessionId,
  repoPath: "/repo",
  runtimeKind: "opencode",
  workingDirectory: "/repo",
  sessionScope: workflowAgentSessionScope("task-1", "spec"),
  runtimePolicy: { kind: "opencode" },
  systemPrompt: "system",
  ...overrides,
});

const defaultRepoPath = "/repo";
const defaultWorkingDirectory = "/repo";
const opencodeRuntimePolicy = { kind: "opencode" } as const;
const opencodeWorkflowScope = (role: "spec" | "planner" | "build" | "qa") =>
  workflowAgentSessionScope("task-1", role);

const makeRuntimeSummary = (
  routeType: "local_http" | "stdio",
  runtimeId = "runtime-opencode-1",
): RuntimeInstanceSummary => ({
  kind: "opencode",
  runtimeId,
  repoPath: defaultRepoPath,
  taskId: null,
  role: "workspace",
  workingDirectory: defaultWorkingDirectory,
  runtimeRoute:
    routeType === "local_http"
      ? {
          type: "local_http",
          endpoint: "http://127.0.0.1:12345",
        }
      : {
          type: "stdio",
          identity: "runtime-stdio",
        },
  startedAt: "2026-02-22T12:00:00.000Z",
  descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
});

const defaultRepoRuntimeResolver = {
  requireRepoRuntime: async ({
    repoPath,
    runtimeKind,
  }: {
    repoPath: string;
    runtimeKind: RuntimeKind;
  }) => ({
    ...makeRuntimeSummary("local_http"),
    repoPath,
    kind: runtimeKind,
  }),
};

const makeRepoRuntimeResolver = (routeType: "local_http" | "stdio") => ({
  requireRepoRuntime: async ({
    repoPath,
    runtimeKind,
  }: {
    repoPath: string;
    runtimeKind: RuntimeKind;
  }) => ({
    ...makeRuntimeSummary(routeType),
    repoPath,
    kind: runtimeKind,
  }),
});

const OpencodeSdkAdapter = class extends BaseOpencodeSdkAdapter {
  readonly sessionsForTest: Map<string, SessionRecord>;

  constructor(options: OpencodeSdkAdapterOptions = {}) {
    const sessions = new Map<string, SessionRecord>();
    super(
      {
        repoRuntimeResolver: defaultRepoRuntimeResolver,
        ...options,
      },
      { sessions, runtimeEventTransports: new Map() },
    );
    this.sessionsForTest = sessions;
  }
};

test("rejects non-OpenCode runtime policy bindings at the adapter boundary", async () => {
  const adapter = new OpencodeSdkAdapter();

  await expect(
    adapter.startSession({
      repoPath: "/repo",
      runtimeKind: "opencode",
      workingDirectory: "/repo",
      sessionScope: workflowAgentSessionScope("task-1", "build"),
      runtimePolicy: {
        kind: "codex",
        policy: {
          sandboxMode: "workspace-write",
          approvalPolicy: "on-request",
          approvalsReviewer: "user",
          commandNetworkAccess: false,
          approvalsReviewerApplies: true,
        },
      },
      systemPrompt: "system",
    }),
  ).rejects.toThrow(
    "Cannot start OpenCode session with runtime 'opencode' and 'codex' runtime policy.",
  );
});

test("rejects fork policy mismatches before runtime side effects", async () => {
  const createClient = mock(() => {
    throw new Error("createClient should not be called");
  });
  const adapter = new OpencodeSdkAdapter({ createClient });

  await expect(
    adapter.forkSession({
      repoPath: "/repo",
      runtimeKind: "opencode",
      workingDirectory: "/repo",
      parentExternalSessionId: "parent-session",
      sessionScope: workflowAgentSessionScope("task-1", "build"),
      runtimePolicy: {
        kind: "codex",
        policy: {
          sandboxMode: "workspace-write",
          approvalPolicy: "on-request",
          approvalsReviewer: "user",
          commandNetworkAccess: false,
          approvalsReviewerApplies: true,
        },
      },
      systemPrompt: "system",
    }),
  ).rejects.toThrow(
    "Cannot fork OpenCode session with runtime 'opencode' and 'codex' runtime policy.",
  );
  expect(createClient).toHaveBeenCalledTimes(0);
});

test("rejects missing resume scope before runtime side effects", async () => {
  const createClient = mock(() => {
    throw new Error("createClient should not be called");
  });
  const requireRepoRuntime = mock(async () => {
    throw new Error("requireRepoRuntime should not be called");
  });
  const adapter = new OpencodeSdkAdapter({
    createClient,
    repoRuntimeResolver: { requireRepoRuntime },
  });

  await expect(
    // @ts-expect-error Deliberately bypass the required control scope to verify the runtime guard.
    adapter.resumeSession({
      ...sessionRef(),
      runtimePolicy: opencodeRuntimePolicy,
      systemPrompt: "system",
    }),
  ).rejects.toThrow("Cannot resume OpenCode session without session context.");
  expect(createClient).toHaveBeenCalledTimes(0);
  expect(requireRepoRuntime).toHaveBeenCalledTimes(0);
  expect(adapter.sessionsForTest.size).toBe(0);
});

test("loads unbound session history without applying a session policy", async () => {
  const mockClient = makeMockClient();
  const adapter = new OpencodeSdkAdapter({ createClient: () => mockClient.client });

  await expect(
    adapter.loadSessionHistory(
      sessionRuntimeRef("unbound-history", {
        sessionScope: undefined,
      }),
    ),
  ).resolves.toEqual([]);
});

const makeMockClient = (
  options: {
    permissionReplyResult?: {
      data?: unknown;
      error?: unknown;
      response?: unknown;
    };
    questionReplyResult?: {
      data?: unknown;
      error?: unknown;
      response?: unknown;
    };
    sessionUpdateResult?: {
      data?: unknown;
      error?: unknown;
      response?: unknown;
    };
    permissionListData?: unknown[];
  } = {},
) => {
  const createCalls: unknown[] = [];
  const abortCalls: unknown[] = [];
  const getCalls: unknown[] = [];
  const listCalls: unknown[] = [];
  const statusCalls: unknown[] = [];
  const permissionListCalls: unknown[] = [];
  const permissionReplyCalls: unknown[] = [];
  const questionListCalls: unknown[] = [];
  const questionReplyCalls: unknown[] = [];
  const updateCalls: unknown[] = [];
  const forkCalls: unknown[] = [];
  const promptAsyncCalls: unknown[] = [];
  const mcpStatusCalls: unknown[] = [];
  const mcpConnectCalls: unknown[] = [];
  const toolIdCalls: unknown[] = [];

  const client: OpencodeClient = {
    session: {
      create: async (input?: ClientMethodInput<"session", "create">) => {
        createCalls.push(input);
        return { data: { id: "external-session-1" }, error: undefined };
      },
      abort: async (input?: ClientMethodInput<"session", "abort">) => {
        abortCalls.push(input);
        return { data: true, error: undefined };
      },
      get: async (input?: ClientMethodInput<"session", "get">) => {
        getCalls.push(input);
        return {
          data: {
            directory: "/repo",
            id: "external-session-1",
            projectID: "project-1",
            slug: "external-session-1",
            time: {
              created: Date.parse("2026-02-22T12:00:00.000Z"),
              updated: Date.parse("2026-02-22T12:00:00.000Z"),
            },
            title: "BUILD task-1",
            version: "1.18.18",
          },
          error: undefined,
        };
      },
      update: async (input?: ClientMethodInput<"session", "update">) => {
        updateCalls.push(input);
        return (
          options.sessionUpdateResult ?? {
            data: { id: "external-session-1" },
            error: undefined,
          }
        );
      },
      fork: async (input?: ClientMethodInput<"session", "fork">) => {
        forkCalls.push(input);
        return { data: { id: "external-session-fork" }, error: undefined };
      },
      promptAsync: async (input?: ClientMethodInput<"session", "promptAsync">) => {
        promptAsyncCalls.push(input);
        return { data: undefined, error: undefined };
      },
      messages: async () => ({ data: [], error: undefined }),
      children: async () => ({ data: [], error: undefined }),
      list: async (input?: ClientMethodInput<"session", "list">) => {
        listCalls.push(input);
        return {
          data: [
            {
              id: "external-session-1",
              projectID: "project-1",
              directory: "/repo",
              slug: "external-session-1",
              title: "BUILD task-1",
              time: {
                created: Date.parse("2026-02-22T12:00:00.000Z"),
                updated: Date.parse("2026-02-22T12:00:00.000Z"),
              },
              version: "1.18.18",
            },
            {
              id: "external-session-2",
              projectID: "project-2",
              directory: "/other",
              slug: "external-session-2",
              title: "OTHER task",
              time: {
                created: Date.parse("2026-02-22T12:00:00.000Z"),
                updated: Date.parse("2026-02-22T12:00:00.000Z"),
              },
              version: "1.18.18",
            },
          ],
          error: undefined,
        };
      },
      status: async (input?: ClientMethodInput<"session", "status">) => {
        statusCalls.push(input);
        const directory = input?.directory;
        return {
          data:
            directory === "/repo"
              ? {
                  "external-session-1": {
                    type: "retry",
                    attempt: 2,
                    message: "retrying",
                    next: 1234,
                  },
                }
              : directory === "/other"
                ? {
                    "external-session-2": {
                      type: "busy",
                    },
                  }
                : {},
          error: undefined,
        };
      },
    },
    permission: {
      list: async (input?: ClientMethodInput<"permission", "list">) => {
        permissionListCalls.push(input);
        const directory = input?.directory;
        return {
          data:
            directory === "/repo"
              ? (options.permissionListData ?? [
                  {
                    id: "perm-1",
                    sessionID: "external-session-1",
                    permission: "read",
                    patterns: ["**/.env"],
                    metadata: { source: "history" },
                    always: [],
                  },
                ])
              : [],
          error: undefined,
        };
      },
      reply: async (input?: ClientMethodInput<"permission", "reply">) => {
        permissionReplyCalls.push(input);
        return options.permissionReplyResult ?? { data: true, error: undefined };
      },
    },
    question: {
      list: async (input?: ClientMethodInput<"question", "list">) => {
        questionListCalls.push(input);
        const directory = input?.directory;
        return {
          data:
            directory === "/other"
              ? [
                  {
                    id: "question-1",
                    sessionID: "external-session-2",
                    questions: [
                      {
                        header: "Confirm",
                        question: "Ship it?",
                        options: [{ label: "Yes", description: "Approve" }],
                        custom: false,
                      },
                    ],
                  },
                ]
              : [],
          error: undefined,
        };
      },
      reply: async (input?: ClientMethodInput<"question", "reply">) => {
        questionReplyCalls.push(input);
        return options.questionReplyResult ?? { data: true, error: undefined };
      },
    },
    mcp: {
      status: async (input?: ClientMethodInput<"mcp", "status">) => {
        mcpStatusCalls.push(input);
        return { data: { openducktor: { status: "connected" } }, error: undefined };
      },
      connect: async (input?: ClientMethodInput<"mcp", "connect">) => {
        mcpConnectCalls.push(input);
        return { data: true, error: undefined };
      },
    },
    tool: {
      ids: async (input?: ClientMethodInput<"tool", "ids">) => {
        toolIdCalls.push(input);
        return { data: ["odt_read_task", "task"], error: undefined };
      },
    },
    global: {
      event: async () => {
        async function* iterator(): AsyncGenerator<{
          directory: string;
          payload: Event;
        }> {
          yield* [];
        }
        return { stream: iterator() };
      },
    },
  };

  return {
    client,
    createCalls,
    abortCalls,
    getCalls,
    listCalls,
    statusCalls,
    permissionListCalls,
    permissionReplyCalls,
    questionListCalls,
    questionReplyCalls,
    updateCalls,
    forkCalls,
    promptAsyncCalls,
    mcpStatusCalls,
    mcpConnectCalls,
    toolIdCalls,
  } satisfies {
    client: OpencodeClient;
    createCalls: unknown[];
    abortCalls: unknown[];
    getCalls: unknown[];
    listCalls: unknown[];
    statusCalls: unknown[];
    permissionListCalls: unknown[];
    permissionReplyCalls: unknown[];
    questionListCalls: unknown[];
    questionReplyCalls: unknown[];
    updateCalls: unknown[];
    forkCalls: unknown[];
    promptAsyncCalls: unknown[];
    mcpStatusCalls: unknown[];
    mcpConnectCalls: unknown[];
    toolIdCalls: unknown[];
  };
};

describe("opencode-sdk-adapter", () => {
  test("startSession requires the live repo runtime before creating a new session", async () => {
    const mockClient = makeMockClient();
    const requireRepoRuntime = mock(async () => makeRuntimeSummary("local_http"));
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mockClient.client,
      now: () => "2026-02-22T12:00:00.000Z",
      repoRuntimeResolver: {
        requireRepoRuntime,
      },
    });

    await adapter.startSession({
      repoPath: defaultRepoPath,
      workingDirectory: defaultWorkingDirectory,
      runtimeKind: "opencode",
      sessionScope: opencodeWorkflowScope("spec"),
      runtimePolicy: opencodeRuntimePolicy,
      systemPrompt: "system",
    });

    expect(requireRepoRuntime).toHaveBeenCalledTimes(1);
  });

  test("resumeSession requires the live repo runtime without listing live runtimes", async () => {
    const mockClient = makeMockClient();
    const requireRepoRuntime = mock(async () => makeRuntimeSummary("local_http"));
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mockClient.client,
      now: () => "2026-02-22T12:00:00.000Z",
      repoRuntimeResolver: {
        requireRepoRuntime,
      },
    });

    await adapter.resumeSession({
      repoPath: defaultRepoPath,
      workingDirectory: defaultWorkingDirectory,
      runtimeKind: "opencode",
      sessionScope: opencodeWorkflowScope("build"),
      runtimePolicy: opencodeRuntimePolicy,
      systemPrompt: "system",
      externalSessionId: "external-session-1",
    });

    expect(requireRepoRuntime).toHaveBeenCalledTimes(1);
    expect(mockClient.getCalls).toEqual([
      { directory: defaultWorkingDirectory, sessionID: "external-session-1" },
    ]);
  });

  test("replyApproval propagates OpenCode reply errors", async () => {
    const mockClient = makeMockClient({
      permissionReplyResult: {
        data: undefined,
        error: new Error("Permission request not found"),
        response: { status: 404, statusText: "Not Found" },
      },
    });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mockClient.client,
      now: () => "2026-02-22T12:00:00.000Z",
    });

    await adapter.resumeSession({
      repoPath: defaultRepoPath,
      workingDirectory: defaultWorkingDirectory,
      runtimeKind: "opencode",
      sessionScope: opencodeWorkflowScope("build"),
      runtimePolicy: opencodeRuntimePolicy,
      systemPrompt: "system",
      externalSessionId: "external-session-1",
    });

    await expect(
      adapter.replyApproval({
        ...sessionRuntimeRef("external-session-1", {
          sessionScope: opencodeWorkflowScope("build"),
        }),
        externalSessionId: "external-session-1",
        requestId: "missing-permission",
        outcome: "approve_once",
      }),
    ).rejects.toThrow("OpenCode request failed: reply to permission request");
    expect(mockClient.permissionReplyCalls).toEqual([
      {
        directory: defaultWorkingDirectory,
        requestID: "missing-permission",
        reply: "once",
      },
    ]);
  });

  test("replyQuestion propagates OpenCode reply errors", async () => {
    const mockClient = makeMockClient({
      questionReplyResult: {
        data: undefined,
        error: new Error("Question request not found"),
        response: { status: 404, statusText: "Not Found" },
      },
    });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mockClient.client,
      now: () => "2026-02-22T12:00:00.000Z",
    });

    await adapter.resumeSession({
      repoPath: defaultRepoPath,
      workingDirectory: defaultWorkingDirectory,
      runtimeKind: "opencode",
      sessionScope: opencodeWorkflowScope("build"),
      runtimePolicy: opencodeRuntimePolicy,
      systemPrompt: "system",
      externalSessionId: "external-session-1",
    });

    await expect(
      adapter.replyQuestion({
        ...sessionRuntimeRef("external-session-1", {
          sessionScope: opencodeWorkflowScope("build"),
        }),
        externalSessionId: "external-session-1",
        requestId: "missing-question",
        answers: [["yes"]],
      }),
    ).rejects.toThrow("OpenCode request failed: reply to question request");
    expect(mockClient.questionReplyCalls).toEqual([
      {
        directory: defaultWorkingDirectory,
        requestID: "missing-question",
        answers: [["yes"]],
      },
    ]);
  });

  test("startSession registers and stopSession tears down the session", async () => {
    const mock = makeMockClient();
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-22T12:00:00.000Z",
    });

    const summary = await adapter.startSession({
      repoPath: "/repo",
      workingDirectory: "/repo",
      runtimeKind: "opencode",
      sessionScope: opencodeWorkflowScope("spec"),
      runtimePolicy: opencodeRuntimePolicy,
      systemPrompt: "system",
    });

    const events: AgentEvent[] = [];
    await adapter.subscribeEvents(sessionRuntimeRef("external-session-1"), (event) => {
      events.push(event);
    });

    expect(summary.externalSessionId).toBe("external-session-1");
    expect(summary.runtimeKind).toBe("opencode");
    expect(summary.workingDirectory).toBe("/repo");
    expect(adapter.sessionsForTest.has("external-session-1")).toBe(true);
    expect(mock.createCalls).toHaveLength(1);

    await adapter.stopSession(sessionRef("external-session-1"));

    expect(mock.abortCalls).toHaveLength(1);
    expect(adapter.sessionsForTest.has("external-session-1")).toBe(false);
    expect(events.some((event) => event.type === "session_finished")).toBe(true);
  });

  test("replyApproval clears only the matching pending input bucket by request id", async () => {
    const mockClient = makeMockClient();
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mockClient.client,
      now: () => "2026-02-22T12:00:00.000Z",
    });

    await adapter.startSession({
      repoPath: "/repo",
      workingDirectory: "/repo",
      runtimeKind: "opencode",
      sessionScope: opencodeWorkflowScope("spec"),
      runtimePolicy: opencodeRuntimePolicy,
      systemPrompt: "system",
    });

    const session = adapter.sessionsForTest.get("external-session-1");
    expect(session).toBeDefined();
    if (!session) {
      throw new Error("Expected test session to be registered.");
    }
    const approval = {
      type: "approval_required",
      externalSessionId: "external-session-1",
      timestamp: "2026-02-22T12:00:00.000Z",
      requestId: "request-1",
      requestType: "permission_grant",
      title: "Approve write",
      summary: "Approval request for write.",
      affectedPaths: ["src/**"],
      action: { name: "write" },
      mutation: "mutating",
      supportedReplyOutcomes: ["approve_once", "approve_session", "reject"],
    } as const;
    const question = {
      type: "question_required",
      externalSessionId: "external-session-1",
      timestamp: "2026-02-22T12:00:00.000Z",
      requestId: "request-2",
      questions: [
        {
          header: "Scope",
          question: "Pick target",
          options: [{ label: "A", description: "Option A" }],
        },
      ],
    } as const;
    session.pendingSubagentInputEventsByExternalSessionId.set("external-session-1", [
      approval,
      question,
    ]);
    session.pendingSubagentInputEventsByExternalSessionId.set("child-b", [
      { ...question, requestId: "request-1" },
    ]);

    await adapter.replyApproval({
      ...sessionRuntimeRef("external-session-1", {
        sessionScope: opencodeWorkflowScope("spec"),
      }),
      requestId: "request-1",
      outcome: "approve_once",
    });

    expect(session.pendingSubagentInputEventsByExternalSessionId.get("external-session-1")).toEqual(
      [question],
    );
    expect(session.pendingSubagentInputEventsByExternalSessionId.get("child-b")).toEqual([
      { ...question, requestId: "request-1" },
    ]);
  });

  test("checks same-directory MCP health before returning cached workflow tool selection", async () => {
    const mock = makeMockClient();
    const statusCalls: Array<{ directory: string }> = [];
    const connectCalls: Array<{ directory: string; name: string }> = [];
    const toolIdCalls: Array<{ directory: string }> = [];
    const statusResponses = [
      { openducktor: { status: "connected" } },
      {
        openducktor: {
          status: "failed",
          error: "MCP error -32000: Connection closed",
        },
      },
      { openducktor: { status: "connected" } },
    ];
    let statusResponseIndex = 0;
    const client = {
      ...mock.client,
      mcp: {
        status: async (input: { directory: string }) => {
          statusCalls.push(input);
          const response =
            statusResponses[statusResponseIndex] ?? statusResponses[statusResponses.length - 1];
          statusResponseIndex += 1;
          return { data: response, error: undefined };
        },
        connect: async (input: { directory: string; name: string }) => {
          connectCalls.push(input);
          return { data: true, error: undefined };
        },
      },
      tool: {
        ids: async (input: { directory: string }) => {
          toolIdCalls.push(input);
          return { data: ["odt_read_task"], error: undefined };
        },
      },
    } satisfies OpencodeClient;
    const adapter = new OpencodeSdkAdapter({
      createClient: () => client,
      now: () => "2026-02-22T12:00:00.000Z",
    });

    await adapter.startSession({
      repoPath: "/repo",
      workingDirectory: "/repo/.openducktor/worktrees/task-1",
      runtimeKind: "opencode",
      sessionScope: opencodeWorkflowScope("build"),
      runtimePolicy: opencodeRuntimePolicy,
      systemPrompt: "system",
    });

    const events: AgentEvent[] = [];
    const subscribedSessionRef = sessionRuntimeRef("external-session-1", {
      workingDirectory: "/repo/.openducktor/worktrees/task-1",
      sessionScope: opencodeWorkflowScope("build"),
    });
    await adapter.subscribeEvents(subscribedSessionRef, (event) => {
      events.push(event);
    });

    const message = {
      ...subscribedSessionRef,
      parts: [{ kind: "text", text: "Continue" }],
    } satisfies Parameters<OpencodeSdkAdapter["sendUserMessage"]>[0];
    await adapter.sendUserMessage(message);
    await adapter.sendUserMessage(message);

    expect(statusCalls).toEqual([
      { directory: "/repo/.openducktor/worktrees/task-1" },
      { directory: "/repo/.openducktor/worktrees/task-1" },
      { directory: "/repo/.openducktor/worktrees/task-1" },
    ]);
    expect(connectCalls).toEqual([
      {
        directory: "/repo/.openducktor/worktrees/task-1",
        name: "openducktor",
      },
    ]);
    expect(toolIdCalls).toEqual([{ directory: "/repo/.openducktor/worktrees/task-1" }]);
    const reconnectEvents = events.filter(({ type }) => type === "mcp_reconnect_started");
    expect(reconnectEvents).toEqual([
      expect.objectContaining({
        type: "mcp_reconnect_started",
        externalSessionId: "external-session-1",
        timestamp: "2026-02-22T12:00:00.000Z",
        serverName: "openducktor",
        workingDirectory: "/repo/.openducktor/worktrees/task-1",
        status: "failed",
        errorDetails: "MCP error -32000: Connection closed",
        sessionRef: {
          ...sessionRef("external-session-1"),
          workingDirectory: "/repo/.openducktor/worktrees/task-1",
        },
      }),
    ]);
  });

  test("listAvailableSlashCommands forwards runtime inputs to the catalog loader", async () => {
    const list = mock(async () => ({
      data: [
        {
          name: "review",
          description: "Review changes",
          source: "command",
          hints: [],
          template: "Review changes",
        },
      ],
      error: undefined,
    }));
    const createClient: () => OpencodeClient = mock(() => ({
      command: { list },
    }));
    const adapter = new OpencodeSdkAdapter({
      createClient,
      now: () => "2026-02-22T12:00:00.000Z",
    });

    const catalog = await adapter.listAvailableSlashCommands({
      repoPath: defaultRepoPath,
      runtimeKind: "opencode",
      workingDirectory: "/repo/worktrees/task-1",
    });

    expect(createClient).toHaveBeenCalledWith({
      runtimeEndpoint: "http://127.0.0.1:12345",
      workingDirectory: "/repo/worktrees/task-1",
    });
    expect(list).toHaveBeenCalledWith({ directory: "/repo/worktrees/task-1" });
    expect(catalog).toEqual({
      commands: [
        MANUAL_SESSION_COMPACTION_SLASH_COMMAND,
        {
          id: "review",
          trigger: "review",
          title: "review",
          description: "Review changes",
          source: "command",
          hints: [],
        },
      ],
    });
  });

  test("accepts equivalent repo paths when validating resolved runtimes", async () => {
    const list = mock(async () => ({ data: [], error: undefined }));
    const createClient: () => OpencodeClient = mock(() => ({
      command: { list },
    }));
    const adapter = new OpencodeSdkAdapter({
      createClient,
      now: () => "2026-02-22T12:00:00.000Z",
      repoRuntimeResolver: {
        requireRepoRuntime: async () => makeRuntimeSummary("local_http"),
      },
    });

    await adapter.listAvailableSlashCommands({
      repoPath: `${defaultRepoPath}/`,
      runtimeKind: "opencode",
      workingDirectory: `${defaultRepoPath}/`,
    });

    expect(createClient).toHaveBeenCalledWith({
      runtimeEndpoint: "http://127.0.0.1:12345",
      workingDirectory: "/repo/",
    });
  });

  test("listAvailableSlashCommands rejects stdio runtime connections before creating a client", async () => {
    const createClient = mock((): never => {
      throw new Error("Client creation must not run for a stdio runtime connection.");
    });
    const adapter = new OpencodeSdkAdapter({
      createClient,
      now: () => "2026-02-22T12:00:00.000Z",
      repoRuntimeResolver: makeRepoRuntimeResolver("stdio"),
    });

    await expect(
      adapter.listAvailableSlashCommands({
        repoPath: defaultRepoPath,
        runtimeKind: "opencode",
        workingDirectory: defaultRepoPath,
      }),
    ).rejects.toThrow(
      "OpenCode runtime 'runtime-opencode-1' is missing required route contract 'local_http' for repo '/repo'",
    );

    expect(createClient).not.toHaveBeenCalled();
  });

  test("fails repository history restoration on a missing bound OpenCode route", async () => {
    const requireRepoRuntime = mock(async () => makeRuntimeSummary("stdio"));
    const createClient = mock(() => {
      throw new Error("createClient should not be called");
    });
    const adapter = new OpencodeSdkAdapter({
      createClient,
      repoRuntimeResolver: { requireRepoRuntime },
    });

    await expect(
      adapter.loadSessionHistory({
        ...sessionRuntimeRef("repository-history", {
          sessionScope: { kind: "repository" },
        }),
      }),
    ).rejects.toThrow(
      "runtime 'runtime-opencode-1' is missing required route contract 'local_http' for repo '/repo'",
    );
    expect(requireRepoRuntime).toHaveBeenCalledTimes(1);
    expect(createClient).toHaveBeenCalledTimes(0);
  });

  test("listAvailableSubagents forwards runtime inputs to the catalog loader", async () => {
    const agents = mock(async () => ({
      data: [
        {
          name: "reviewer",
          description: "Review changes",
          mode: "subagent",
          options: {},
          permission: [],
        },
      ],
      error: undefined,
    }));
    const createClient: () => OpencodeClient = mock(() => ({ app: { agents } }));
    const adapter = new OpencodeSdkAdapter({ createClient, now: () => "2026-02-22T12:00:00.000Z" });

    const catalog = await adapter.listAvailableSubagents({
      repoPath: defaultRepoPath,
      runtimeKind: "opencode",
      workingDirectory: defaultWorkingDirectory,
    });

    expect(createClient).toHaveBeenCalledWith({
      runtimeEndpoint: "http://127.0.0.1:12345",
      workingDirectory: "/repo",
    });
    expect(agents).toHaveBeenCalledWith({ directory: "/repo" });
    expect(catalog).toEqual({
      subagents: [
        {
          id: "reviewer",
          name: "reviewer",
          label: "reviewer",
          description: "Review changes",
        },
      ],
    });
  });

  test("searchFiles forwards runtime inputs to the catalog loader", async () => {
    const files = mock(async () => ({
      data: ["src/", "src/index.ts"],
      error: undefined,
    }));
    const createClient: () => OpencodeClient = mock(() => ({
      find: { files },
    }));
    const adapter = new OpencodeSdkAdapter({
      createClient,
      now: () => "2026-02-22T12:00:00.000Z",
    });

    const results = await adapter.searchFiles({
      repoPath: defaultRepoPath,
      runtimeKind: "opencode",
      workingDirectory: defaultWorkingDirectory,
      query: "src",
    });

    expect(createClient).toHaveBeenCalledWith({
      runtimeEndpoint: "http://127.0.0.1:12345",
      workingDirectory: "/repo",
    });
    expect(files).toHaveBeenCalledTimes(1);
    expect(files).toHaveBeenCalledWith({
      directory: "/repo",
      limit: 20,
      query: "src",
    });
    expect(results).toEqual([
      {
        id: "src",
        path: "src",
        name: "src",
        kind: "directory",
      },
      {
        id: "src/index.ts",
        path: "src/index.ts",
        name: "index.ts",
        kind: "code",
      },
    ]);
  });
});
