import { describe, expect, test } from "bun:test";
import type { Event, OpencodeClient } from "@opencode-ai/sdk/v2/client";
import type { AgentEvent } from "@openducktor/core";
import { OpencodeSdkAdapter } from "./opencode-sdk-adapter";

const makeMockClient = (): {
  client: OpencodeClient;
  createCalls: unknown[];
  abortCalls: unknown[];
  listCalls: unknown[];
  statusCalls: unknown[];
} => {
  const createCalls: unknown[] = [];
  const abortCalls: unknown[] = [];
  const listCalls: unknown[] = [];
  const statusCalls: unknown[] = [];

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
    event: {
      subscribe: async () => {
        async function* iterator(): AsyncGenerator<Event> {
          for (const event of [] as Event[]) {
            yield event;
          }
          return;
        }
        return { stream: iterator() };
      },
    },
  } as unknown as OpencodeClient;

  return { client, createCalls, abortCalls, listCalls, statusCalls };
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

  test("listRuntimeSessions maps server sessions and statuses", async () => {
    const mock = makeMockClient();
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-22T12:00:00.000Z",
    });

    const sessions = await adapter.listRuntimeSessions({
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

  test("listRuntimeSessions fails fast on malformed runtime statuses", async () => {
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
    } as OpencodeClient;
    const adapter = new OpencodeSdkAdapter({
      createClient: () => malformedClient,
      now: () => "2026-02-22T12:00:00.000Z",
    });

    await expect(
      adapter.listRuntimeSessions({
        runtimeKind: "opencode",
        runtimeConnection: {
          endpoint: "http://127.0.0.1:12345",
          workingDirectory: "/repo",
        },
      }),
    ).rejects.toThrow("Unsupported Opencode runtime session status type");
  });

  test("listRuntimeSessions rejects non-object session status maps", async () => {
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
    } as OpencodeClient;
    const adapter = new OpencodeSdkAdapter({
      createClient: () => malformedClient,
      now: () => "2026-02-22T12:00:00.000Z",
    });

    await expect(
      adapter.listRuntimeSessions({
        runtimeKind: "opencode",
        runtimeConnection: {
          endpoint: "http://127.0.0.1:12345",
          workingDirectory: "/repo",
        },
      }),
    ).rejects.toThrow("Malformed Opencode session status response for directory '/repo'");
  });

  test("listRuntimeSessions normalizes directory keys for status lookups", async () => {
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
    } as OpencodeClient;
    const adapter = new OpencodeSdkAdapter({
      createClient: () => whitespaceClient,
      now: () => "2026-02-22T12:00:00.000Z",
    });

    const sessions = await adapter.listRuntimeSessions({
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

  test("listRuntimeSessions rejects sessions with invalid directories", async () => {
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
    } as OpencodeClient;
    const adapter = new OpencodeSdkAdapter({
      createClient: () => malformedClient,
      now: () => "2026-02-22T12:00:00.000Z",
    });

    await expect(
      adapter.listRuntimeSessions({
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
});
