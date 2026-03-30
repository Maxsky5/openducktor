import { describe, expect, mock, test } from "bun:test";
import type { Event, OpencodeClient } from "@opencode-ai/sdk/v2/client";
import type { AgentEvent } from "@openducktor/core";
import { OpencodeSdkAdapter } from "./opencode-sdk-adapter";

const makeMockClient = (): {
  client: OpencodeClient;
  createCalls: unknown[];
  abortCalls: unknown[];
  listCalls: unknown[];
  statusCalls: unknown[];
  permissionListCalls: unknown[];
  questionListCalls: unknown[];
} => {
  const createCalls: unknown[] = [];
  const abortCalls: unknown[] = [];
  const listCalls: unknown[] = [];
  const statusCalls: unknown[] = [];
  const permissionListCalls: unknown[] = [];
  const questionListCalls: unknown[] = [];

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
    listCalls,
    statusCalls,
    permissionListCalls,
    questionListCalls,
  };
};

describe("opencode-sdk-adapter", () => {
  test("startSession registers and stopSession tears down the session", async () => {
    const mock = makeMockClient();
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-22T12:00:00.000Z",
    });

    const events: AgentEvent[] = [];
    adapter.subscribeEvents("session-1", (event) => {
      events.push(event);
    });

    const summary = await adapter.startSession({
      sessionId: "session-1",
      repoPath: "/repo",
      workingDirectory: "/repo",
      taskId: "task-1",
      runtimeKind: "opencode",
      role: "spec",
      scenario: "spec_initial",
      systemPrompt: "system",
      runtimeConnection: {
        endpoint: "http://127.0.0.1:12345",
        workingDirectory: "/repo",
      },
    });

    expect(summary.sessionId).toBe("session-1");
    expect(summary.externalSessionId).toBe("external-session-1");
    expect(adapter.hasSession("session-1")).toBe(true);
    expect(mock.createCalls).toHaveLength(1);

    await adapter.stopSession("session-1");

    expect(mock.abortCalls).toHaveLength(1);
    expect(adapter.hasSession("session-1")).toBe(false);
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
        sessionId: "session-1",
        repoPath: "/repo",
        workingDirectory: "/repo",
        taskId: "task-1",
        runtimeKind: "opencode",
        role: "spec",
        scenario: "spec_initial",
        systemPrompt: "system",
        runtimeConnection: {
          endpoint: "http://127.0.0.1:12345",
          workingDirectory: "/repo",
        },
      }),
    ).rejects.toThrow("client.global.event()");
  });

  test("listLiveAgentSessions maps server sessions and statuses", async () => {
    const mock = makeMockClient();
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-22T12:00:00.000Z",
    });

    const sessions = await adapter.listLiveAgentSessions({
      runtimeKind: "opencode",
      runtimeConnection: {
        endpoint: "http://127.0.0.1:12345",
        workingDirectory: "/repo",
      },
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
      runtimeKind: "opencode",
      runtimeConnection: {
        endpoint: "http://127.0.0.1:12345",
        workingDirectory: "/repo",
      },
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
        runtimeKind: "opencode",
        runtimeConnection: {
          endpoint: "http://127.0.0.1:12345",
          workingDirectory: "/repo",
        },
      }),
    ).rejects.toThrow("OpenCode runtime does not expose the command listing API.");
  });

  test("searchFiles forwards runtime inputs to the catalog loader", async () => {
    const files = mock(async (input: { type?: string }) => ({
      data: input.type === "directory" ? ["src"] : ["src/index.ts"],
      error: undefined,
    }));
    const createClient = mock(() => ({ find: { files } })) as () => OpencodeClient;
    const adapter = new OpencodeSdkAdapter({ createClient, now: () => "2026-02-22T12:00:00.000Z" });

    const results = await adapter.searchFiles({
      runtimeKind: "opencode",
      runtimeConnection: {
        endpoint: "http://127.0.0.1:12345",
        workingDirectory: "/repo",
      },
      query: "src",
    });

    expect(createClient).toHaveBeenCalledWith({
      runtimeEndpoint: "http://127.0.0.1:12345",
      workingDirectory: "/repo",
    });
    expect(files).toHaveBeenCalledTimes(2);
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
        kind: "ts",
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
        runtimeKind: "opencode",
        runtimeConnection: {
          endpoint: "http://127.0.0.1:12345",
          workingDirectory: "/repo",
        },
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
      runtimeKind: "opencode",
      runtimeConnection: {
        endpoint: "http://127.0.0.1:12345",
        workingDirectory: "/repo",
      },
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
        runtimeKind: "opencode",
        runtimeConnection: {
          endpoint: "http://127.0.0.1:12345",
          workingDirectory: "/repo",
        },
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
        runtimeKind: "opencode",
        runtimeConnection: {
          endpoint: "http://127.0.0.1:12345",
          workingDirectory: "/repo",
        },
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
      runtimeKind: "opencode",
      runtimeConnection: {
        endpoint: "http://127.0.0.1:12345",
        workingDirectory: "/repo",
      },
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
        runtimeKind: "opencode",
        runtimeConnection: {
          endpoint: "http://127.0.0.1:12345",
          workingDirectory: "/repo",
        },
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
      runtimeKind: "opencode",
      runtimeConnection: {
        endpoint: "http://127.0.0.1:12345",
        workingDirectory: "/repo",
      },
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
