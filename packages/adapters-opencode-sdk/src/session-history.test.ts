import { describe, expect, test } from "bun:test";
import type { Event, Part } from "@opencode-ai/sdk/v2";
import type { AgentEvent } from "@openducktor/core";
import {
  defaultRepoRuntimeInput,
  defaultRuntimeConnection,
  flushAsync,
  makeMockClient,
  OpencodeSdkAdapter,
  startDefaultSession,
} from "./test-support";
import type { SessionRecord } from "./types";

describe("OpencodeSdkAdapter session history", () => {
  test("loadSessionHistory preserves message model metadata and maps streamed parts", async () => {
    const mock = makeMockClient({
      messagesResponse: [
        {
          info: {
            id: "msg-100",
            role: "user",
            agent: "Hephaestus",
            model: {
              providerID: "openai",
              modelID: "gpt-5",
            },
            variant: "high",
            time: { created: Date.parse("2026-02-17T11:59:00Z") },
          },
          parts: [
            {
              id: "text-user-1",
              sessionID: "session-opencode-1",
              messageID: "msg-100",
              type: "text",
              text: "Use the selected agent",
              time: { start: Date.now(), end: Date.now() },
            } as unknown as Part,
          ],
        },
        {
          info: {
            id: "msg-200",
            role: "assistant",
            providerID: "openai",
            modelID: "gpt-5",
            agent: "Hephaestus",
            variant: "high",
            tokens: {
              input: 2_000,
              output: 450,
            },
            time: { created: Date.parse("2026-02-17T12:00:00Z") },
          },
          parts: [
            {
              id: "reason-1",
              sessionID: "session-opencode-1",
              messageID: "msg-200",
              type: "reasoning",
              text: "Reasoning block",
              time: { start: Date.now(), end: Date.now() },
            } as unknown as Part,
            {
              id: "text-1",
              sessionID: "session-opencode-1",
              messageID: "msg-200",
              type: "text",
              text: "Final answer",
              time: { start: Date.now(), end: Date.now() },
            } as unknown as Part,
          ],
        },
      ],
    });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    const history = await adapter.loadSessionHistory({
      ...defaultRepoRuntimeInput,
      externalSessionId: "session-opencode-1",
      limit: 100,
    });

    expect(history).toHaveLength(2);
    expect(history[0]?.text).toBe("Use the selected agent");
    expect(history[0]?.model).toEqual({
      providerId: "openai",
      modelId: "gpt-5",
      profileId: "Hephaestus",
      variant: "high",
    });
    expect(history[1]?.text).toBe("Final answer");
    if (history[0]?.role !== "user") {
      throw new Error("Expected first history entry to be a user message");
    }
    if (history[1]?.role !== "assistant") {
      throw new Error("Expected second history entry to be an assistant message");
    }
    expect(history[0].state).toBe("read");
    expect(history[1].totalTokens).toBe(2_450);
    expect(history[1]?.model).toEqual({
      providerId: "openai",
      modelId: "gpt-5",
      profileId: "Hephaestus",
      variant: "high",
    });
    expect(history[1]?.parts).toHaveLength(1);
    expect(history[1]?.parts[0]).toMatchObject({
      kind: "reasoning",
      text: "Reasoning block",
    });
  });

  test("loadSessionHistory attaches OpenCode patch diffs to edit tool parts", async () => {
    const originalFetch = globalThis.fetch;
    const requestedUrls: string[] = [];
    globalThis.fetch = (async (url: URL | RequestInfo) => {
      requestedUrls.push(url.toString());
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => [
          {
            file: "src/main.ts",
            patch: "@@ -1 +1 @@\n-old\n+new",
            additions: 1,
            deletions: 1,
            status: "modified",
          },
        ],
      } as Response;
    }) as typeof fetch;

    try {
      const mock = makeMockClient({
        messagesResponse: [
          {
            info: {
              id: "msg-200",
              role: "assistant",
              time: { created: Date.parse("2026-02-17T12:00:00Z") },
            },
            parts: [
              {
                id: "tool-edit-1",
                sessionID: "session-opencode-1",
                messageID: "msg-200",
                callID: "call-edit-1",
                type: "tool",
                tool: "edit",
                state: {
                  status: "completed",
                  input: { filePath: "/repo/src/main.ts" },
                  output: "Edited src/main.ts",
                },
              } as unknown as Part,
              {
                id: "patch-1",
                sessionID: "session-opencode-1",
                messageID: "msg-200",
                type: "patch",
                files: ["/repo/src/main.ts"],
              } as unknown as Part,
            ],
          },
        ],
      });
      const adapter = new OpencodeSdkAdapter({
        createClient: () => mock.client,
        now: () => "2026-02-17T12:00:00Z",
      });

      const history = await adapter.loadSessionHistory({
        ...defaultRepoRuntimeInput,
        externalSessionId: "session-opencode-1",
        limit: 100,
      });

      expect(history).toHaveLength(1);
      const message = history[0];
      if (message?.role !== "assistant") {
        throw new Error("Expected assistant history entry");
      }
      const editPart = message.parts.find((part) => part.kind === "tool");
      expect(editPart).toMatchObject({
        kind: "tool",
        tool: "edit",
        toolType: "file_edit",
        fileChanges: [
          {
            file: "src/main.ts",
            type: "modified",
            additions: 1,
            deletions: 1,
            diff: "@@ -1 +1 @@\n-old\n+new",
          },
        ],
      });
      expect(requestedUrls).toEqual([
        "http://127.0.0.1:12345/session/session-opencode-1/diff?messageID=msg-200",
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("loadSessionHistory scopes OpenCode patch diffs to the patch message", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: URL | RequestInfo) => {
      const messageId = new URL(url.toString()).searchParams.get("messageID");
      const diffByMessageId: Record<string, string> = {
        "msg-200": "@@ -1 +1 @@\n-first\n+second",
        "msg-201": "@@ -1 +1 @@\n-second\n+third",
      };
      const patch = messageId ? diffByMessageId[messageId] : undefined;
      if (!patch) {
        throw new Error(`Unexpected diff request for message '${messageId ?? ""}'.`);
      }
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => [
          {
            file: "src/main.ts",
            patch,
            additions: 1,
            deletions: 1,
            status: "modified",
          },
        ],
      } as Response;
    }) as typeof fetch;

    try {
      const mock = makeMockClient({
        messagesResponse: [
          {
            info: {
              id: "msg-200",
              role: "assistant",
              time: { created: Date.parse("2026-02-17T12:00:00Z") },
            },
            parts: [
              {
                id: "tool-edit-1",
                sessionID: "session-opencode-1",
                messageID: "msg-200",
                callID: "call-edit-1",
                type: "tool",
                tool: "edit",
                state: {
                  status: "completed",
                  input: { filePath: "/repo/src/main.ts" },
                  output: "Edited src/main.ts",
                },
              } as unknown as Part,
              {
                id: "patch-1",
                sessionID: "session-opencode-1",
                messageID: "msg-200",
                type: "patch",
                files: ["/repo/src/main.ts"],
              } as unknown as Part,
            ],
          },
          {
            info: {
              id: "msg-201",
              role: "assistant",
              time: { created: Date.parse("2026-02-17T12:01:00Z") },
            },
            parts: [
              {
                id: "tool-edit-2",
                sessionID: "session-opencode-1",
                messageID: "msg-201",
                callID: "call-edit-2",
                type: "tool",
                tool: "edit",
                state: {
                  status: "completed",
                  input: { filePath: "/repo/src/main.ts" },
                  output: "Edited src/main.ts again",
                },
              } as unknown as Part,
              {
                id: "patch-2",
                sessionID: "session-opencode-1",
                messageID: "msg-201",
                type: "patch",
                files: ["/repo/src/main.ts"],
              } as unknown as Part,
            ],
          },
        ],
      });
      const adapter = new OpencodeSdkAdapter({
        createClient: () => mock.client,
        now: () => "2026-02-17T12:00:00Z",
      });

      const history = await adapter.loadSessionHistory({
        ...defaultRepoRuntimeInput,
        externalSessionId: "session-opencode-1",
        limit: 100,
      });

      expect(history).toHaveLength(2);
      const firstEdit = history[0]?.parts.find((part) => part.kind === "tool");
      const secondEdit = history[1]?.parts.find((part) => part.kind === "tool");
      expect(firstEdit).toMatchObject({
        kind: "tool",
        fileChanges: [
          {
            file: "src/main.ts",
            diff: "@@ -1 +1 @@\n-first\n+second",
          },
        ],
      });
      expect(secondEdit).toMatchObject({
        kind: "tool",
        fileChanges: [
          {
            file: "src/main.ts",
            diff: "@@ -1 +1 @@\n-second\n+third",
          },
        ],
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("loadSessionHistory normalizes subagent correlation keys like the live stream", async () => {
    const mock = makeMockClient({
      messagesResponse: [
        {
          info: {
            id: "msg-200",
            role: "assistant",
            time: { created: Date.parse("2026-02-17T12:00:00Z") },
          },
          parts: [
            {
              id: "subtask-a",
              sessionID: "session-opencode-1",
              messageID: "msg-200",
              type: "subtask",
              agent: "build",
              prompt: "Inspect repo",
              description: "Starting A",
            } as unknown as Part,
            {
              id: "tool-a",
              sessionID: "session-opencode-1",
              messageID: "msg-200",
              callID: "call-a",
              type: "tool",
              tool: "task",
              state: {
                status: "completed",
                input: {
                  subagent_type: "build",
                  prompt: "Inspect repo",
                  description: "Starting A",
                },
                output: {
                  result: "Finished A",
                },
                metadata: {
                  externalSessionId: "child-a",
                },
                time: {
                  start: Date.parse("2026-02-17T12:00:00Z"),
                  end: Date.parse("2026-02-17T12:02:00Z"),
                },
                title: "Task",
              },
            } as unknown as Part,
          ],
        },
      ],
    });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    const history = await adapter.loadSessionHistory({
      ...defaultRepoRuntimeInput,
      externalSessionId: "session-opencode-1",
      limit: 100,
    });

    expect(history).toHaveLength(1);
    if (history[0]?.role !== "assistant") {
      throw new Error("Expected assistant history entry");
    }

    expect(history[0].parts).toHaveLength(2);
    expect(history[0].parts[0]).toMatchObject({
      kind: "subagent",
      status: "running",
      correlationKey: "part:msg-200:subtask-a",
    });
    expect(history[0].parts[1]).toMatchObject({
      kind: "subagent",
      status: "completed",
      externalSessionId: "child-a",
      correlationKey: "part:msg-200:subtask-a",
    });
  });

  test("loadSessionHistory links task tool parts to OpenCode child sessions", async () => {
    const taskStartedAtMs = Date.parse("2026-02-17T12:00:03.000Z");
    const mock = makeMockClient({
      childrenResponse: [
        {
          id: "child-session-a",
          parentID: "session-opencode-1",
          time: {
            created: taskStartedAtMs + 4,
          },
        },
      ],
      messagesResponse: [
        {
          info: {
            id: "msg-200",
            role: "assistant",
            time: { created: Date.parse("2026-02-17T12:00:00Z") },
          },
          parts: [
            {
              id: "tool-task-a",
              sessionID: "session-opencode-1",
              messageID: "msg-200",
              callID: "call-a",
              type: "tool",
              tool: "task",
              state: {
                status: "running",
                input: {
                  subagent_type: "explorer",
                  prompt: "Read omp.json file",
                  description: "Read omp.json file",
                },
                time: {
                  start: taskStartedAtMs,
                },
              },
            } as unknown as Part,
          ],
        },
      ],
    });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    const history = await adapter.loadSessionHistory({
      ...defaultRepoRuntimeInput,
      externalSessionId: "session-opencode-1",
      limit: 100,
    });

    expect(mock.session.childrenCalls).toEqual([
      {
        sessionID: "session-opencode-1",
        directory: "/repo",
      },
    ]);
    if (history[0]?.role !== "assistant") {
      throw new Error("Expected assistant history entry");
    }
    expect(history[0].parts).toEqual([
      expect.objectContaining({
        kind: "subagent",
        status: "running",
        partId: "tool-task-a",
        externalSessionId: "child-session-a",
      }),
    ]);
  });

  test("loadSessionHistory seeds live subagent correlation for later task-tool updates", async () => {
    const streamEvents: Event[] = [
      {
        type: "message.updated",
        properties: {
          info: {
            id: "msg-200",
            role: "assistant",
            sessionID: "session-opencode-1",
            time: {
              created: Date.parse("2026-02-17T12:00:00Z"),
            },
          },
        },
      } as unknown as Event,
      {
        type: "message.part.updated",
        properties: {
          part: {
            id: "tool-a",
            sessionID: "session-opencode-1",
            messageID: "msg-200",
            callID: "call-a",
            type: "tool",
            tool: "task",
            state: {
              status: "running",
              input: {
                subagent_type: "build",
                prompt: "Inspect repo",
                description: "Starting A",
              },
              metadata: {
                externalSessionId: "child-a",
              },
              time: {
                start: Date.parse("2026-02-17T12:00:01Z"),
              },
              title: "Task",
            },
          },
        },
      } as unknown as Event,
    ];
    const mock = makeMockClient({
      streamEvents,
      messagesResponse: [
        {
          info: {
            id: "msg-200",
            role: "assistant",
            time: { created: Date.parse("2026-02-17T12:00:00Z") },
          },
          parts: [
            {
              id: "subtask-a",
              sessionID: "session-opencode-1",
              messageID: "msg-200",
              type: "subtask",
              agent: "build",
              prompt: "Inspect repo",
              description: "Starting A",
            } as Part,
          ],
        },
      ],
    });

    let releaseStream: (() => void) | null = null;
    (
      mock.client.global as unknown as {
        event: (options?: {
          signal?: AbortSignal;
        }) => Promise<{ stream: AsyncIterable<{ directory: string; payload: Event }> }>;
      }
    ).event = async (options?: { signal?: AbortSignal }) => {
      async function* iterator(): AsyncGenerator<{ directory: string; payload: Event }> {
        await new Promise<void>((resolve) => {
          releaseStream = resolve;
          options?.signal?.addEventListener("abort", () => resolve(), { once: true });
        });
        if (options?.signal?.aborted) {
          return;
        }
        for (const event of streamEvents) {
          yield { directory: defaultRuntimeConnection.workingDirectory, payload: event };
        }
      }

      return { stream: iterator() };
    };

    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    const events: AgentEvent[] = [];
    adapter.subscribeEvents("session-opencode-1", (event) => {
      events.push(event);
    });

    await startDefaultSession(adapter, "build");
    const history = await adapter.loadSessionHistory({
      ...defaultRepoRuntimeInput,
      externalSessionId: "session-opencode-1",
      limit: 100,
    });
    const finishStream = releaseStream as (() => void) | null;
    if (finishStream) {
      finishStream();
    }
    await flushAsync();

    expect(history).toHaveLength(1);
    const subagentEvents = events.filter(
      (event): event is Extract<AgentEvent, { type: "assistant_part" }> =>
        event.type === "assistant_part" && event.part.kind === "subagent",
    );
    expect(subagentEvents).toHaveLength(1);
    expect(subagentEvents[0]?.part).toMatchObject({
      kind: "subagent",
      status: "running",
      externalSessionId: "child-a",
      correlationKey: "part:msg-200:subtask-a",
    });
  });

  test("loadSessionHistory seeds live subagent correlation across assistant message boundaries", async () => {
    const streamEvents: Event[] = [
      {
        type: "message.updated",
        properties: {
          info: {
            id: "msg-201",
            role: "assistant",
            sessionID: "session-opencode-1",
            time: {
              created: Date.parse("2026-02-17T12:00:02Z"),
            },
          },
        },
      } as unknown as Event,
      {
        type: "message.part.updated",
        properties: {
          part: {
            id: "tool-a",
            sessionID: "session-opencode-1",
            messageID: "msg-201",
            callID: "call-a",
            type: "tool",
            tool: "task",
            state: {
              status: "completed",
              input: {
                subagent_type: "build",
                prompt: "Inspect repo",
                description: "Starting A",
              },
              output: {
                result: "Finished A",
              },
              metadata: {
                externalSessionId: "child-a",
              },
              time: {
                start: Date.parse("2026-02-17T12:00:01Z"),
                end: Date.parse("2026-02-17T12:02:00Z"),
              },
              title: "Task",
            },
          },
        },
      } as unknown as Event,
    ];
    const mock = makeMockClient({
      streamEvents,
      messagesResponse: [
        {
          info: {
            id: "msg-200",
            role: "assistant",
            time: { created: Date.parse("2026-02-17T12:00:00Z") },
          },
          parts: [
            {
              id: "subtask-a",
              sessionID: "session-opencode-1",
              messageID: "msg-200",
              type: "subtask",
              agent: "build",
              prompt: "Inspect repo",
              description: "Starting A",
            } as Part,
          ],
        },
      ],
    });

    let releaseStream: (() => void) | null = null;
    (
      mock.client.global as unknown as {
        event: (options?: {
          signal?: AbortSignal;
        }) => Promise<{ stream: AsyncIterable<{ directory: string; payload: Event }> }>;
      }
    ).event = async (options?: { signal?: AbortSignal }) => {
      async function* iterator(): AsyncGenerator<{ directory: string; payload: Event }> {
        await new Promise<void>((resolve) => {
          releaseStream = resolve;
          options?.signal?.addEventListener("abort", () => resolve(), { once: true });
        });
        if (options?.signal?.aborted) {
          return;
        }
        for (const event of streamEvents) {
          yield { directory: defaultRuntimeConnection.workingDirectory, payload: event };
        }
      }

      return { stream: iterator() };
    };

    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    const events: AgentEvent[] = [];
    adapter.subscribeEvents("session-opencode-1", (event) => {
      events.push(event);
    });

    await startDefaultSession(adapter, "build");
    const history = await adapter.loadSessionHistory({
      ...defaultRepoRuntimeInput,
      externalSessionId: "session-opencode-1",
      limit: 100,
    });
    const finishStream = releaseStream as (() => void) | null;
    if (finishStream) {
      finishStream();
    }
    await flushAsync();

    expect(history).toHaveLength(1);
    const subagentEvents = events.filter(
      (event): event is Extract<AgentEvent, { type: "assistant_part" }> =>
        event.type === "assistant_part" && event.part.kind === "subagent",
    );
    expect(subagentEvents).toHaveLength(1);
    expect(subagentEvents[0]?.part).toMatchObject({
      kind: "subagent",
      status: "completed",
      externalSessionId: "child-a",
      correlationKey: "part:msg-200:subtask-a",
    });
  });

  test("loadSessionHistory normalizes split-message subagent history to one canonical correlation", async () => {
    const mock = makeMockClient({
      messagesResponse: [
        {
          info: {
            id: "msg-200",
            role: "assistant",
            time: { created: Date.parse("2026-02-17T12:00:00Z") },
          },
          parts: [
            {
              id: "subtask-a",
              sessionID: "session-opencode-1",
              messageID: "msg-200",
              type: "subtask",
              agent: "build",
              prompt: "Inspect repo",
              description: "Starting A",
            } as Part,
          ],
        },
        {
          info: {
            id: "msg-201",
            role: "assistant",
            time: { created: Date.parse("2026-02-17T12:00:02Z") },
          },
          parts: [
            {
              id: "tool-a",
              sessionID: "session-opencode-1",
              messageID: "msg-201",
              callID: "call-a",
              type: "tool",
              tool: "task",
              state: {
                status: "completed",
                input: {
                  subagent_type: "build",
                  prompt: "Inspect repo",
                  description: "Starting A",
                },
                output: {
                  result: "Finished A",
                },
                metadata: {
                  externalSessionId: "child-a",
                },
                time: {
                  start: Date.parse("2026-02-17T12:00:01Z"),
                  end: Date.parse("2026-02-17T12:02:00Z"),
                },
                title: "Task",
              },
            } as unknown as Part,
          ],
        },
      ],
    });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    const history = await adapter.loadSessionHistory({
      ...defaultRepoRuntimeInput,
      externalSessionId: "session-opencode-1",
      limit: 100,
    });

    expect(history).toHaveLength(2);
    if (history[0]?.role !== "assistant" || history[1]?.role !== "assistant") {
      throw new Error("Expected assistant history entries");
    }

    expect(history[0].parts).toHaveLength(1);
    expect(history[0].parts[0]).toMatchObject({
      kind: "subagent",
      status: "running",
      correlationKey: "part:msg-200:subtask-a",
    });
    expect(history[1].parts).toHaveLength(1);
    expect(history[1].parts[0]).toMatchObject({
      kind: "subagent",
      status: "completed",
      externalSessionId: "child-a",
      correlationKey: "part:msg-200:subtask-a",
    });
  });

  test("loadSessionHistory marks queued user messages using the last unfinished assistant boundary", async () => {
    const mock = makeMockClient({
      messagesResponse: [
        {
          info: {
            id: "msg-100",
            role: "user",
            time: { created: Date.parse("2026-02-17T11:59:00Z") },
          },
          parts: [
            {
              id: "text-user-read-z",
              sessionID: "session-opencode-1",
              messageID: "msg-100",
              type: "text",
              text: "Original request",
              time: { start: Date.now(), end: Date.now() },
            } as Part,
          ],
        },
        {
          info: {
            id: "msg-200",
            role: "assistant",
            parentID: "msg-100",
            time: { created: Date.parse("2026-02-17T12:00:00Z") },
          },
          parts: [
            {
              id: "text-assistant-parent-a",
              sessionID: "session-opencode-1",
              messageID: "msg-200",
              type: "text",
              text: "Working on it",
              time: { start: Date.now(), end: Date.now() },
            } as Part,
          ],
        },
        {
          info: {
            id: "msg-300",
            role: "user",
            time: { created: Date.parse("2026-02-17T12:01:00Z") },
          },
          parts: [
            {
              id: "text-user-queued-a",
              sessionID: "session-opencode-1",
              messageID: "msg-300",
              type: "text",
              text: "One more change",
              time: { start: Date.now(), end: Date.now() },
            } as Part,
          ],
        },
      ],
    });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    const history = await adapter.loadSessionHistory({
      ...defaultRepoRuntimeInput,
      externalSessionId: "session-opencode-1",
      limit: 100,
    });

    expect(history).toHaveLength(3);
    if (history[0]?.role !== "user" || history[2]?.role !== "user") {
      throw new Error("Expected first and last history entries to be user messages");
    }
    expect(history[0].messageId).toBe("msg-100");
    expect(history[0].state).toBe("read");
    expect(history[2].messageId).toBe("msg-300");
    expect(history[2].state).toBe("queued");
  });

  test("loadSessionHistory preserves user whitespace and reconstructs adjacent file references", async () => {
    const mock = makeMockClient({
      messagesResponse: [
        {
          info: {
            id: "msg-user-1",
            role: "user",
            text: "  @src/alpha.ts @src/beta.ts  ",
            time: { created: Date.parse("2026-02-17T11:59:00Z") },
          },
          parts: [
            {
              id: "file-alpha",
              sessionID: "session-opencode-1",
              messageID: "msg-user-1",
              type: "file",
              mime: "text/plain",
              filename: "alpha.ts",
              url: "file:///repo/src/alpha.ts",
              source: {
                type: "file",
                path: "src/alpha.ts",
                text: { value: "@src/alpha.ts", start: 2, end: 15 },
              },
            } as Part,
            {
              id: "file-beta",
              sessionID: "session-opencode-1",
              messageID: "msg-user-1",
              type: "file",
              mime: "text/plain",
              filename: "beta.ts",
              url: "file:///repo/src/beta.ts",
              source: {
                type: "file",
                path: "src/beta.ts",
                text: { value: "@src/beta.ts", start: 15, end: 27 },
              },
            } as Part,
          ],
        },
      ],
    });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    const history = await adapter.loadSessionHistory({
      ...defaultRepoRuntimeInput,
      externalSessionId: "session-opencode-1",
      limit: 100,
    });

    expect(history).toHaveLength(1);
    if (history[0]?.role !== "user") {
      throw new Error("Expected user history entry");
    }
    expect(history[0].text).toBe("  @src/alpha.ts @src/beta.ts  ");
    expect(history[0].displayParts).toEqual([
      {
        kind: "text",
        text: "  @src/alpha.ts @src/beta.ts  ",
      },
      {
        kind: "file_reference",
        file: {
          id: "file-alpha",
          path: "src/alpha.ts",
          name: "alpha.ts",
          kind: "code",
        },
        sourceText: {
          start: 2,
          end: 15,
          value: "@src/alpha.ts",
        },
      },
      {
        kind: "file_reference",
        file: {
          id: "file-beta",
          path: "src/beta.ts",
          name: "beta.ts",
          kind: "code",
        },
        sourceText: {
          start: 15,
          end: 27,
          value: "@src/beta.ts",
        },
      },
    ]);
  });

  test("loadSessionHistory collapses redundant slash-command echo text parts", async () => {
    const slashEnvelope = `<auto-slash-command>\n# /test-command Command\n\n**Description**: A command for testing slash commands\n\n**User Arguments**: pouet\n\n**Scope**: opencode\n\n---\n\n## Command Instructions\n\nI just want to test the slash commands mechanism.\nReturn the arguments of this command: pouet\n\n\n---\n\n## User Request\n\npouet\n</auto-slash-command>`;
    const mock = makeMockClient({
      messagesResponse: [
        {
          info: {
            id: "msg-user-slash-1",
            role: "user",
            time: { created: Date.parse("2026-02-17T11:59:00Z") },
          },
          parts: [
            {
              id: "text-user-envelope",
              sessionID: "session-opencode-1",
              messageID: "msg-user-slash-1",
              type: "text",
              text: slashEnvelope,
            } as Part,
            {
              id: "text-user-echo",
              sessionID: "session-opencode-1",
              messageID: "msg-user-slash-1",
              type: "text",
              text: "I just want to test the slash commands mechanism.\nReturn the arguments of this command: pouet",
            } as Part,
          ],
        },
      ],
    });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    const history = await adapter.loadSessionHistory({
      ...defaultRepoRuntimeInput,
      externalSessionId: "session-opencode-1",
      limit: 100,
    });

    expect(history).toHaveLength(1);
    if (history[0]?.role !== "user") {
      throw new Error("Expected user history entry");
    }
    expect(history[0].text).toBe(slashEnvelope);
    expect(history[0].displayParts).toEqual([{ kind: "text", text: slashEnvelope }]);
  });

  test("loadSessionHistory preserves local attachment preview paths from the live session metadata", async () => {
    const mock = makeMockClient({
      messagesResponse: [
        {
          info: {
            id: "msg-user-attachment-1",
            role: "user",
            text: "Describe this screenshot",
            time: { created: Date.parse("2026-02-17T11:59:00Z") },
          },
          parts: [
            {
              id: "file-attachment-1",
              sessionID: "session-opencode-1",
              messageID: "msg-user-attachment-1",
              type: "file",
              mime: "image/png",
              filename: "Screenshot-2026-03-16-at-23.48.30.png",
              url: "https://files.example.invalid/uploaded-image",
            } as Part,
          ],
        },
      ],
    });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    const sessions = (adapter as unknown as { sessions: Map<string, SessionRecord> }).sessions;
    sessions.set("session-opencode-1", {
      externalSessionId: "session-opencode-1",
      eventTransportKey: defaultRuntimeConnection.endpoint,
      input: {
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo/feature-worktree",
        taskId: "task-1",
        role: "spec",
        systemPrompt: "System prompt",
      },
      messageMetadataById: new Map([
        [
          "msg-user-attachment-1",
          {
            timestamp: "2026-02-17T11:59:00Z",
            displayParts: [
              {
                kind: "attachment",
                attachment: {
                  id: "attachment-image-1",
                  path: "/tmp/local-screenshot.png",
                  name: "Screenshot-2026-03-16-at-23.48.30.png",
                  kind: "image",
                  mime: "image/png",
                },
              },
            ],
          },
        ],
      ]),
    } as unknown as SessionRecord);

    const history = await adapter.loadSessionHistory({
      ...defaultRepoRuntimeInput,
      externalSessionId: "session-opencode-1",
      limit: 100,
    });

    if (history[0]?.role !== "user") {
      throw new Error("Expected user history entry");
    }
    expect(history[0].displayParts).toContainEqual(
      expect.objectContaining({
        kind: "attachment",
        attachment: expect.objectContaining({
          path: "/tmp/local-screenshot.png",
          name: "Screenshot-2026-03-16-at-23.48.30.png",
          kind: "image",
          mime: "image/png",
        }),
      }),
    );
  });

  test("loadSessionHistory only reuses preserved attachment parts from the matching runtime endpoint", async () => {
    const mock = makeMockClient({
      messagesResponse: [
        {
          info: {
            id: "msg-user-attachment-1",
            role: "user",
            text: "Describe this screenshot",
            time: { created: Date.parse("2026-02-17T11:59:00Z") },
          },
          parts: [
            {
              id: "file-attachment-1",
              sessionID: "session-opencode-1",
              messageID: "msg-user-attachment-1",
              type: "file",
              mime: "image/png",
              filename: "Screenshot-2026-03-16-at-23.48.30.png",
              url: "https://files.example.invalid/uploaded-image",
            } as Part,
          ],
        },
      ],
    });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    const sessions = (adapter as unknown as { sessions: Map<string, SessionRecord> }).sessions;
    sessions.set("session-runtime-a", {
      externalSessionId: "session-opencode-1",
      eventTransportKey: defaultRuntimeConnection.endpoint,
      input: {
        externalSessionId: "session-runtime-a",
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo/feature-worktree",
        taskId: "task-1",
        role: "spec",
        systemPrompt: "System prompt",
      },
      messageMetadataById: new Map([
        [
          "msg-user-attachment-1",
          {
            timestamp: "2026-02-17T11:59:00Z",
            displayParts: [
              {
                kind: "attachment",
                attachment: {
                  id: "attachment-image-1",
                  path: "/tmp/runtime-a-screenshot.png",
                  name: "Screenshot-2026-03-16-at-23.48.30.png",
                  kind: "image",
                  mime: "image/png",
                },
              },
            ],
          },
        ],
      ]),
    } as unknown as SessionRecord);
    sessions.set("session-runtime-b", {
      externalSessionId: "session-opencode-1",
      eventTransportKey: "http://127.0.0.1:12000",
      input: {
        externalSessionId: "session-runtime-b",
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo/other-worktree",
        taskId: "task-1",
        role: "spec",
        systemPrompt: "System prompt",
      },
      messageMetadataById: new Map([
        [
          "msg-user-attachment-1",
          {
            timestamp: "2026-02-17T11:59:00Z",
            displayParts: [
              {
                kind: "attachment",
                attachment: {
                  id: "attachment-image-2",
                  path: "/tmp/runtime-b-screenshot.png",
                  name: "Screenshot-2026-03-16-at-23.48.30.png",
                  kind: "image",
                  mime: "image/png",
                },
              },
            ],
          },
        ],
      ]),
    } as unknown as SessionRecord);

    const history = await adapter.loadSessionHistory({
      ...defaultRepoRuntimeInput,
      externalSessionId: "session-opencode-1",
      limit: 100,
    });

    if (history[0]?.role !== "user") {
      throw new Error("Expected user history entry");
    }
    expect(history[0].displayParts).toContainEqual(
      expect.objectContaining({
        kind: "attachment",
        attachment: expect.objectContaining({
          path: "/tmp/runtime-a-screenshot.png",
        }),
      }),
    );
    expect(history[0].displayParts).not.toContainEqual(
      expect.objectContaining({
        kind: "attachment",
        attachment: expect.objectContaining({
          path: "/tmp/runtime-b-screenshot.png",
        }),
      }),
    );
  });
});
