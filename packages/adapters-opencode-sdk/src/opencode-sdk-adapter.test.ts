import { describe, expect, mock, test } from "bun:test";
import type { Event, OpencodeClient } from "@opencode-ai/sdk/v2/client";
import { OPENCODE_RUNTIME_DESCRIPTOR, type RuntimeInstanceSummary } from "@openducktor/contracts";
import type { AgentEvent, RuntimeKind } from "@openducktor/core";
import { OpencodeSdkAdapter as BaseOpencodeSdkAdapter } from "./opencode-sdk-adapter";
import type { OpencodeSdkAdapterOptions } from "./types";

const defaultRepoPath = "/repo";
const defaultWorkingDirectory = "/repo";

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
  ensureRepoRuntime: async ({
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
  ensureRepoRuntime: async ({
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
  constructor(options: OpencodeSdkAdapterOptions = {}) {
    super({ repoRuntimeResolver: defaultRepoRuntimeResolver, ...options });
  }
};

const makeMockClient = (): {
  client: OpencodeClient;
  createCalls: unknown[];
  abortCalls: unknown[];
  getCalls: unknown[];
  listCalls: unknown[];
  statusCalls: unknown[];
  permissionListCalls: unknown[];
  questionListCalls: unknown[];
  questionReplyCalls: unknown[];
} => {
  const createCalls: unknown[] = [];
  const abortCalls: unknown[] = [];
  const getCalls: unknown[] = [];
  const listCalls: unknown[] = [];
  const statusCalls: unknown[] = [];
  const permissionListCalls: unknown[] = [];
  const questionListCalls: unknown[] = [];
  const questionReplyCalls: unknown[] = [];

  const client = {
    session: {
      create: async (input: unknown) => {
        createCalls.push(input);
        return { data: { id: "external-session-1" }, error: undefined };
      },
      abort: async (input: unknown) => {
        abortCalls.push(input);
        return { data: true, error: undefined };
      },
      get: async (input: unknown) => {
        getCalls.push(input);
        return {
          data: {
            id: "external-session-1",
            time: {
              created: Date.parse("2026-02-22T12:00:00.000Z"),
            },
          },
          error: undefined,
        };
      },
      list: async (input?: unknown) => {
        listCalls.push(input);
        return {
          data: [
            {
              id: "external-session-1",
              projectID: "project-1",
              directory: "/repo",
              title: "BUILD task-1",
              time: {
                created: Date.parse("2026-02-22T12:00:00.000Z"),
                updated: Date.parse("2026-02-22T12:00:00.000Z"),
              },
            },
            {
              id: "external-session-2",
              projectID: "project-2",
              directory: "/other",
              title: "OTHER task",
              time: {
                created: Date.parse("2026-02-22T12:00:00.000Z"),
                updated: Date.parse("2026-02-22T12:00:00.000Z"),
              },
            },
          ],
          error: undefined,
        };
      },
      status: async (input?: unknown) => {
        statusCalls.push(input);
        const directory =
          typeof input === "object" && input !== null && "directory" in input
            ? (input as { directory?: string }).directory
            : undefined;
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
      list: async (input?: unknown) => {
        permissionListCalls.push(input);
        const directory =
          typeof input === "object" && input !== null && "directory" in input
            ? (input as { directory?: string }).directory
            : undefined;
        return {
          data:
            directory === "/repo"
              ? [
                  {
                    id: "perm-1",
                    sessionID: "external-session-1",
                    permission: "read",
                    patterns: ["**/.env"],
                    metadata: { source: "history" },
                    always: [],
                  },
                ]
              : [],
          error: undefined,
        };
      },
    },
    question: {
      list: async (input?: unknown) => {
        questionListCalls.push(input);
        const directory =
          typeof input === "object" && input !== null && "directory" in input
            ? (input as { directory?: string }).directory
            : undefined;
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
      reply: async (input: unknown) => {
        questionReplyCalls.push(input);
        return { data: true, error: undefined };
      },
    },
    global: {
      event: async () => {
        async function* iterator(): AsyncGenerator<{ directory: string; payload: Event }> {
          for (const event of [] as Event[]) {
            yield { directory: "/repo", payload: event };
          }
        }
        return { stream: iterator() };
      },
    },
  } as unknown as OpencodeClient;

  return {
    client,
    createCalls,
    abortCalls,
    getCalls,
    listCalls,
    statusCalls,
    permissionListCalls,
    questionListCalls,
    questionReplyCalls,
  };
};

describe("opencode-sdk-adapter", () => {
  test("startSession ensures the repo runtime before creating a new session", async () => {
    const mockClient = makeMockClient();
    const ensureRepoRuntime = mock(async () => makeRuntimeSummary("local_http"));
    const requireRepoRuntime = mock(async () => makeRuntimeSummary("local_http"));
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mockClient.client,
      now: () => "2026-02-22T12:00:00.000Z",
      repoRuntimeResolver: {
        ensureRepoRuntime,
        requireRepoRuntime,
      },
    });

    await adapter.startSession({
      repoPath: defaultRepoPath,
      workingDirectory: defaultWorkingDirectory,
      taskId: "task-1",
      runtimeKind: "opencode",
      role: "spec",
      scenario: "spec_initial",
      systemPrompt: "system",
    });

    expect(ensureRepoRuntime).toHaveBeenCalledTimes(1);
    expect(requireRepoRuntime).not.toHaveBeenCalled();
  });

  test("resumeSession requires an existing repo runtime instead of ensuring one", async () => {
    const mockClient = makeMockClient();
    const ensureRepoRuntime = mock(async () => makeRuntimeSummary("local_http"));
    const requireRepoRuntime = mock(async () => makeRuntimeSummary("local_http"));
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mockClient.client,
      now: () => "2026-02-22T12:00:00.000Z",
      repoRuntimeResolver: {
        ensureRepoRuntime,
        requireRepoRuntime,
      },
    });

    await adapter.resumeSession({
      repoPath: defaultRepoPath,
      workingDirectory: defaultWorkingDirectory,
      taskId: "task-1",
      runtimeKind: "opencode",
      role: "build",
      scenario: "build_implementation_start",
      systemPrompt: "system",
      externalSessionId: "external-session-1",
    });

    expect(ensureRepoRuntime).not.toHaveBeenCalled();
    expect(requireRepoRuntime).toHaveBeenCalledTimes(1);
    expect(mockClient.getCalls).toEqual([
      { directory: defaultWorkingDirectory, sessionID: "external-session-1" },
    ]);
  });

  test("live session reads require an existing repo runtime instead of ensuring one", async () => {
    const mockClient = makeMockClient();
    const ensureRepoRuntime = mock(async () => makeRuntimeSummary("local_http"));
    const requireRepoRuntime = mock(async () => makeRuntimeSummary("local_http"));
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mockClient.client,
      now: () => "2026-02-22T12:00:00.000Z",
      repoRuntimeResolver: {
        ensureRepoRuntime,
        requireRepoRuntime,
      },
    });

    await adapter.listLiveAgentSessionSnapshots({
      repoPath: defaultRepoPath,
      runtimeKind: "opencode",
    });

    expect(ensureRepoRuntime).not.toHaveBeenCalled();
    expect(requireRepoRuntime).toHaveBeenCalledTimes(1);
  });

  test("startSession registers and stopSession tears down the session", async () => {
    const mock = makeMockClient();
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-22T12:00:00.000Z",
    });

    const events: AgentEvent[] = [];
    adapter.subscribeEvents("external-session-1", (event) => {
      events.push(event);
    });

    const summary = await adapter.startSession({
      repoPath: "/repo",
      workingDirectory: "/repo",
      taskId: "task-1",
      runtimeKind: "opencode",
      role: "spec",
      scenario: "spec_initial",
      systemPrompt: "system",
    });

    expect(summary.externalSessionId).toBe("external-session-1");
    expect(adapter.hasSession("external-session-1")).toBe(true);
    expect(mock.createCalls).toHaveLength(1);

    await adapter.stopSession("external-session-1");

    expect(mock.abortCalls).toHaveLength(1);
    expect(adapter.hasSession("external-session-1")).toBe(false);
    expect(events.some((event) => event.type === "session_finished")).toBe(true);
  });

  test("startSession fails fast when the sdk client lacks global event streaming", async () => {
    const mock = makeMockClient();
    const unsupportedClient = {
      ...mock.client,
      global: {},
    } as unknown as OpencodeClient;
    const adapter = new OpencodeSdkAdapter({
      createClient: () => unsupportedClient,
      now: () => "2026-02-22T12:00:00.000Z",
    });

    await expect(
      adapter.startSession({
        repoPath: "/repo",
        workingDirectory: "/repo",
        taskId: "task-1",
        runtimeKind: "opencode",
        role: "spec",
        scenario: "spec_initial",
        systemPrompt: "system",
      }),
    ).rejects.toThrow("client.global.event()");
    expect(adapter.hasSession("external-session-1")).toBe(false);
  });

  test("listLiveAgentSessions maps server sessions and statuses", async () => {
    const mock = makeMockClient();
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-22T12:00:00.000Z",
    });

    const sessions = await adapter.listLiveAgentSessions({
      repoPath: defaultRepoPath,
      runtimeKind: "opencode",
    });

    expect(mock.listCalls).toHaveLength(1);
    expect(mock.statusCalls).toEqual([{ directory: "/repo" }, { directory: "/other" }]);
    expect(sessions).toEqual([
      {
        externalSessionId: "external-session-1",
        title: "BUILD task-1",
        workingDirectory: "/repo",
        startedAt: "2026-02-22T12:00:00.000Z",
        status: {
          type: "retry",
          attempt: 2,
          message: "retrying",
          nextEpochMs: 1234,
        },
      },
      {
        externalSessionId: "external-session-2",
        title: "OTHER task",
        workingDirectory: "/other",
        startedAt: "2026-02-22T12:00:00.000Z",
        status: {
          type: "busy",
        },
      },
    ]);
  });

  test("listAvailableSlashCommands forwards runtime inputs to the catalog loader", async () => {
    const list = mock(async () => ({
      data: [{ name: "review", description: "Review changes", source: "command", hints: [] }],
      error: undefined,
    }));
    const createClient = mock(() => ({ command: { list } })) as () => OpencodeClient;
    const adapter = new OpencodeSdkAdapter({ createClient, now: () => "2026-02-22T12:00:00.000Z" });

    const catalog = await adapter.listAvailableSlashCommands({
      repoPath: defaultRepoPath,
      runtimeKind: "opencode",
    });

    expect(createClient).toHaveBeenCalledWith({
      runtimeEndpoint: "http://127.0.0.1:12345",
      workingDirectory: "/repo",
    });
    expect(list).toHaveBeenCalledWith({ directory: "/repo" });
    expect(catalog).toEqual({
      commands: [
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

  test("listAvailableSlashCommands propagates catalog loader failures", async () => {
    const adapter = new OpencodeSdkAdapter({
      createClient: (() => ({})) as () => OpencodeClient,
      now: () => "2026-02-22T12:00:00.000Z",
    });

    await expect(
      adapter.listAvailableSlashCommands({
        repoPath: defaultRepoPath,
        runtimeKind: "opencode",
      }),
    ).rejects.toThrow("OpenCode runtime does not expose the command listing API.");
  });

  test("accepts equivalent repo paths when validating resolved runtimes", async () => {
    const list = mock(async () => ({ data: [], error: undefined }));
    const createClient = mock(() => ({ command: { list } })) as () => OpencodeClient;
    const adapter = new OpencodeSdkAdapter({
      createClient,
      now: () => "2026-02-22T12:00:00.000Z",
      repoRuntimeResolver: {
        ensureRepoRuntime: async () => makeRuntimeSummary("local_http"),
        requireRepoRuntime: async () => makeRuntimeSummary("local_http"),
      },
    });

    await adapter.listAvailableSlashCommands({
      repoPath: `${defaultRepoPath}/`,
      runtimeKind: "opencode",
    });

    expect(createClient).toHaveBeenCalledWith({
      runtimeEndpoint: "http://127.0.0.1:12345",
      workingDirectory: "/repo/",
    });
  });

  test("listAvailableSlashCommands rejects stdio runtime connections before creating a client", async () => {
    const createClient = mock(() => ({}) as OpencodeClient);
    const adapter = new OpencodeSdkAdapter({
      createClient,
      now: () => "2026-02-22T12:00:00.000Z",
      repoRuntimeResolver: makeRepoRuntimeResolver("stdio"),
    });

    await expect(
      adapter.listAvailableSlashCommands({
        repoPath: defaultRepoPath,
        runtimeKind: "opencode",
      }),
    ).rejects.toThrow(
      "OpenCode runtime route 'stdio' is unsupported for list available slash commands; local_http is required for repo '/repo'.",
    );

    expect(createClient).not.toHaveBeenCalled();
  });

  test("searchFiles forwards runtime inputs to the catalog loader", async () => {
    const files = mock(async () => ({
      data: ["src/", "src/index.ts"],
      error: undefined,
    }));
    const createClient = mock(() => ({ find: { files } })) as () => OpencodeClient;
    const adapter = new OpencodeSdkAdapter({ createClient, now: () => "2026-02-22T12:00:00.000Z" });

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

  test("searchFiles propagates catalog loader failures", async () => {
    const adapter = new OpencodeSdkAdapter({
      createClient: (() => ({})) as () => OpencodeClient,
      now: () => "2026-02-22T12:00:00.000Z",
    });

    await expect(
      adapter.searchFiles({
        repoPath: defaultRepoPath,
        runtimeKind: "opencode",
        workingDirectory: defaultWorkingDirectory,
        query: "src",
      }),
    ).rejects.toThrow("OpenCode runtime does not expose the file search API.");
  });

  test("listLiveAgentSessionSnapshots merges status and pending input into a single live-session view", async () => {
    const mock = makeMockClient();
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-22T12:00:00.000Z",
    });

    const snapshots = await adapter.listLiveAgentSessionSnapshots({
      repoPath: defaultRepoPath,
      runtimeKind: "opencode",
    });

    expect(mock.listCalls).toHaveLength(1);
    expect(mock.statusCalls).toEqual([{ directory: "/repo" }, { directory: "/other" }]);
    expect(mock.permissionListCalls).toEqual([{ directory: "/repo" }, { directory: "/other" }]);
    expect(mock.questionListCalls).toEqual([{ directory: "/repo" }, { directory: "/other" }]);
    expect(snapshots).toEqual([
      {
        externalSessionId: "external-session-1",
        title: "BUILD task-1",
        workingDirectory: "/repo",
        startedAt: "2026-02-22T12:00:00.000Z",
        status: {
          type: "retry",
          attempt: 2,
          message: "retrying",
          nextEpochMs: 1234,
        },
        pendingPermissions: [
          {
            requestId: "perm-1",
            permission: "read",
            patterns: ["**/.env"],
            metadata: { source: "history" },
          },
        ],
        pendingQuestions: [],
      },
      {
        externalSessionId: "external-session-2",
        title: "OTHER task",
        workingDirectory: "/other",
        startedAt: "2026-02-22T12:00:00.000Z",
        status: {
          type: "busy",
        },
        pendingPermissions: [],
        pendingQuestions: [
          {
            requestId: "question-1",
            questions: [
              {
                header: "Confirm",
                question: "Ship it?",
                options: [{ label: "Yes", description: "Approve" }],
                custom: false,
              },
            ],
          },
        ],
      },
    ]);
  });

  test("listLiveAgentSessions fails fast on malformed runtime statuses", async () => {
    const mock = makeMockClient();
    const malformedClient = {
      ...mock.client,
      session: {
        ...mock.client.session,
        status: async () => ({
          data: {
            "external-session-1": {
              type: "unexpected",
            },
          },
          error: undefined,
        }),
      },
    } as unknown as OpencodeClient;
    const adapter = new OpencodeSdkAdapter({
      createClient: () => malformedClient,
      now: () => "2026-02-22T12:00:00.000Z",
    });

    await expect(
      adapter.listLiveAgentSessions({
        repoPath: defaultRepoPath,
        runtimeKind: "opencode",
      }),
    ).rejects.toThrow("Unsupported Opencode live agent session status type");
  });

  test("listLiveAgentSessions rejects non-object session status maps", async () => {
    const mock = makeMockClient();
    const malformedClient = {
      ...mock.client,
      session: {
        ...mock.client.session,
        status: async () => ({
          data: ["bad-status-map"],
          error: undefined,
        }),
      },
    } as unknown as OpencodeClient;
    const adapter = new OpencodeSdkAdapter({
      createClient: () => malformedClient,
      now: () => "2026-02-22T12:00:00.000Z",
    });

    await expect(
      adapter.listLiveAgentSessions({
        repoPath: defaultRepoPath,
        runtimeKind: "opencode",
      }),
    ).rejects.toThrow("Malformed Opencode session status response for directory '/repo'");
  });

  test("listLiveAgentSessions normalizes directory keys for status lookups", async () => {
    const mock = makeMockClient();
    const whitespaceClient = {
      ...mock.client,
      session: {
        ...mock.client.session,
        list: async () => ({
          data: [
            {
              id: "external-session-1",
              projectID: "project-1",
              directory: "  /repo  ",
              title: "BUILD task-1",
              time: {
                created: Date.parse("2026-02-22T12:00:00.000Z"),
              },
            },
          ],
          error: undefined,
        }),
      },
    } as unknown as OpencodeClient;
    const adapter = new OpencodeSdkAdapter({
      createClient: () => whitespaceClient,
      now: () => "2026-02-22T12:00:00.000Z",
    });

    const sessions = await adapter.listLiveAgentSessions({
      repoPath: defaultRepoPath,
      runtimeKind: "opencode",
    });

    expect(mock.statusCalls).toEqual([{ directory: "/repo" }]);
    expect(sessions).toEqual([
      {
        externalSessionId: "external-session-1",
        title: "BUILD task-1",
        workingDirectory: "/repo",
        startedAt: "2026-02-22T12:00:00.000Z",
        status: {
          type: "retry",
          attempt: 2,
          message: "retrying",
          nextEpochMs: 1234,
        },
      },
    ]);
  });

  test("listLiveAgentSessions rejects sessions with invalid directories", async () => {
    const mock = makeMockClient();
    const malformedClient = {
      ...mock.client,
      session: {
        ...mock.client.session,
        list: async () => ({
          data: [
            {
              id: "external-session-1",
              projectID: "project-1",
              directory: "   ",
              title: "BUILD task-1",
              time: {
                created: Date.parse("2026-02-22T12:00:00.000Z"),
              },
            },
          ],
          error: undefined,
        }),
      },
    } as unknown as OpencodeClient;
    const adapter = new OpencodeSdkAdapter({
      createClient: () => malformedClient,
      now: () => "2026-02-22T12:00:00.000Z",
    });

    await expect(
      adapter.listLiveAgentSessions({
        repoPath: defaultRepoPath,
        runtimeKind: "opencode",
      }),
    ).rejects.toThrow(
      "Malformed Opencode session payload for 'external-session-1': missing directory.",
    );
  });

  test("listLiveAgentSessionPendingInput groups pending permissions and questions by external session id", async () => {
    const mock = makeMockClient();
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-22T12:00:00.000Z",
    });

    const pending = await adapter.listLiveAgentSessionPendingInput({
      repoPath: defaultRepoPath,
      runtimeKind: "opencode",
      workingDirectory: defaultWorkingDirectory,
    });

    expect(mock.permissionListCalls).toEqual([{ directory: "/repo" }]);
    expect(mock.questionListCalls).toEqual([{ directory: "/repo" }]);
    expect(pending).toEqual({
      "external-session-1": {
        permissions: [
          {
            requestId: "perm-1",
            permission: "read",
            patterns: ["**/.env"],
            metadata: { source: "history" },
          },
        ],
        questions: [],
      },
    });
  });
});
