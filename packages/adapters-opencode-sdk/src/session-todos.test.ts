import { describe, expect, test } from "bun:test";

import {
  createLoadSessionTodosHarness,
  defaultLoadSessionTodosInput,
  defaultRepoRuntimeInput,
  makeMockClient,
  OpencodeSdkAdapter,
} from "./test-support";

describe("OpencodeSdkAdapter session todos", () => {
  test("loadSessionTodos reads /session/:id/todo and normalizes entries", async () => {
    const mock = makeMockClient({
      todoResult: {
        mode: "success",
        data: [
          {
            id: "todo-1",
            content: "Inspect auth flow",
            status: "in_progress",
            priority: "high",
          },
          {
            id: "todo-2",
            content: "Write spec",
            status: "unexpected_status",
            priority: "unexpected_priority",
          },
        ],
      },
    });
    const createClientCalls: unknown[] = [];
    const adapter = new OpencodeSdkAdapter({
      createClient: (input) => {
        createClientCalls.push(input);
        return mock.client;
      },
      now: () => "2026-02-17T12:00:00Z",
    });

    const todos = await adapter.loadSessionTodos({
      ...defaultRepoRuntimeInput,
      externalSessionId: "session-opencode-1",
    });

    expect(mock.session.todoCalls).toEqual([
      {
        sessionID: "session-opencode-1",
        directory: "/repo",
      },
    ]);
    expect(createClientCalls).toEqual([
      {
        runtimeEndpoint: "http://127.0.0.1:12345",
        workingDirectory: "/repo",
      },
    ]);
    expect(todos).toEqual([
      {
        id: "todo-1",
        content: "Inspect auth flow",
        status: "in_progress",
        priority: "high",
      },
      {
        id: "todo-2",
        content: "Write spec",
        status: "pending",
        priority: "medium",
      },
    ]);
  });

  test("loadSessionTodos rejects client errors with actionable status context", async () => {
    const { adapter, session, createClientCalls } = createLoadSessionTodosHarness({
      todoResult: {
        mode: "api_error",
        error: {
          message: "Service Unavailable",
        },
        status: 503,
        statusText: "Service Unavailable",
      },
    });

    await expect(adapter.loadSessionTodos(defaultLoadSessionTodosInput)).rejects.toThrow(
      "OpenCode request failed: load session todos (503 Service Unavailable): Service Unavailable",
    );
    expect(session.todoCalls).toEqual([
      {
        sessionID: "session-opencode-1",
        directory: "/repo",
      },
    ]);
    expect(createClientCalls).toEqual([
      {
        runtimeEndpoint: "http://127.0.0.1:12345",
        workingDirectory: "/repo",
      },
    ]);
  });

  test("loadSessionTodos rejects thrown request errors", async () => {
    const requestError = new Error("network down");
    const { adapter, session, createClientCalls } = createLoadSessionTodosHarness({
      todoResult: {
        mode: "throw",
        error: requestError,
      },
    });

    await expect(adapter.loadSessionTodos(defaultLoadSessionTodosInput)).rejects.toThrow(
      "OpenCode request failed: load session todos: network down",
    );
    expect(session.todoCalls).toEqual([
      {
        sessionID: "session-opencode-1",
        directory: "/repo",
      },
    ]);
    expect(createClientCalls).toEqual([
      {
        runtimeEndpoint: "http://127.0.0.1:12345",
        workingDirectory: "/repo",
      },
    ]);
  });

  test("loadSessionTodos rejects blank workingDirectory in runtimeConnection", async () => {
    const mock = makeMockClient({
      todoResult: {
        mode: "success",
        data: [],
      },
    });
    const createClientCalls: unknown[] = [];
    const adapter = new OpencodeSdkAdapter({
      createClient: (input) => {
        createClientCalls.push(input);
        return mock.client;
      },
      now: () => "2026-02-17T12:00:00Z",
    });

    await expect(
      adapter.loadSessionTodos({
        ...defaultRepoRuntimeInput,
        workingDirectory: "   ",
        externalSessionId: "session-opencode-1",
      }),
    ).rejects.toThrow("Session workingDirectory is required to load session todos.");

    expect(mock.session.todoCalls).toEqual([]);
    expect(createClientCalls).toEqual([]);
  });

  test("loadSessionTodos trims workingDirectory before forwarding directory", async () => {
    const mock = makeMockClient({
      todoResult: {
        mode: "success",
        data: [],
      },
    });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    const todos = await adapter.loadSessionTodos({
      ...defaultRepoRuntimeInput,
      workingDirectory: "  /repo  ",
      externalSessionId: "session-opencode-1",
    });

    expect(todos).toEqual([]);
    expect(mock.session.todoCalls).toEqual([
      {
        sessionID: "session-opencode-1",
        directory: "/repo",
      },
    ]);
  });
});
