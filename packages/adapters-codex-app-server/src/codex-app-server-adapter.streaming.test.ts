import { describe, expect, mock, test } from "bun:test";
import {
  codexSessionRuntimeRef,
  codexStartSessionInput,
  codexUserMessageInput,
  createDeferred,
  createHarness,
  createRuntimeStreamSubscription,
  flushCodexAdapterWork,
} from "./codex-app-server-adapter.test-harness";
import type { CodexAppServerAdapter, CodexJsonRpcRequest, CodexJsonRpcTransport } from "./index";

const observeSessionState = async (
  adapter: CodexAppServerAdapter,
  externalSessionId: string,
): Promise<() => void> => {
  const unsubscribe = await adapter.subscribeEvents(
    codexSessionRuntimeRef(externalSessionId),
    () => {},
  );
  await flushCodexAdapterWork();
  return unsubscribe;
};

describe("CodexAppServerAdapter streaming", () => {
  test("rejects subagent reference sends before emitting an accepted user message", async () => {
    const { adapter, transports } = createHarness();

    await adapter.startSession(codexStartSessionInput());
    const events: unknown[] = [];
    await adapter.subscribeEvents(codexSessionRuntimeRef("thread/start-runtime-live"), (event) =>
      events.push(event),
    );

    await expect(
      adapter.sendUserMessage(
        codexUserMessageInput({
          externalSessionId: "thread/start-runtime-live",
          parts: [
            {
              kind: "subagent_reference",
              subagent: {
                id: "reviewer",
                name: "reviewer",
                label: "Reviewer",
              },
            },
          ],
        }),
      ),
    ).rejects.toThrow("Codex app-server does not support 'subagent_reference' user message parts.");

    expect(events).not.toContainEqual(expect.objectContaining({ type: "user_message" }));
    expect(transports.get("runtime-live")?.calls.some((call) => call.method === "turn/start")).toBe(
      false,
    );
  });

  test("rejects subagent reference sends before initializing a missing local session", async () => {
    const { adapter, transports, requireRepoRuntime } = createHarness();

    await expect(
      adapter.sendUserMessage(
        codexUserMessageInput({
          externalSessionId: "thread/start-runtime-live",
          parts: [
            {
              kind: "subagent_reference",
              subagent: {
                id: "reviewer",
                name: "reviewer",
                label: "Reviewer",
              },
            },
          ],
        }),
      ),
    ).rejects.toThrow("Codex app-server does not support 'subagent_reference' user message parts.");

    expect(requireRepoRuntime).not.toHaveBeenCalled();
    expect(transports.size).toBe(0);
  });

  test("settles the active turn when runtime status changes to idle before turn completion", async () => {
    const { subscribeEvents, emitNotification } = createRuntimeStreamSubscription();
    const { adapter, transports } = createHarness({ subscribeEvents }, { deferTurnStart: true });

    await adapter.startSession(codexStartSessionInput());
    const events: Array<{ type?: string }> = [];
    const unsubscribe = await adapter.subscribeEvents(
      codexSessionRuntimeRef("thread/start-runtime-live"),
      (event) => events.push(event),
    );
    await flushCodexAdapterWork();

    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: "thread/start-runtime-live",
        parts: [{ kind: "text", text: "Start now" }],
        model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
      }),
    );
    transports.get("runtime-live")?.turnStartDeferred.resolve({
      turn: { id: "turn-live", status: "running" },
    });
    await flushCodexAdapterWork();

    emitNotification({
      method: "thread/status/changed",
      params: {
        threadId: "thread/start-runtime-live",
        status: { type: "idle" },
      },
    });
    await flushCodexAdapterWork();

    await expect(
      adapter.readSessionRuntimeSnapshot({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread/start-runtime-live",
      }),
    ).resolves.toMatchObject({ classification: "idle" });
    expect(events.some((event) => event.type === "session_idle")).toBe(true);

    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: "thread/start-runtime-live",
        parts: [{ kind: "text", text: "Continue after idle" }],
        model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
      }),
    );

    const runtimeCalls = transports.get("runtime-live")?.calls ?? [];
    expect(runtimeCalls.filter((call) => call.method === "turn/steer")).toEqual([]);
    expect(runtimeCalls.filter((call) => call.method === "turn/start")).toHaveLength(2);
    unsubscribe();
  });

  test("waits for turn completion timing before flushing a final assistant message", async () => {
    const { subscribeEvents, emitNotification } = createRuntimeStreamSubscription();
    const { adapter, transports } = createHarness({ subscribeEvents }, { deferTurnStart: true });

    await adapter.startSession(codexStartSessionInput());
    const events: Array<{ type?: string; message?: string; totalTokens?: number }> = [];
    const unsubscribe = await adapter.subscribeEvents(
      codexSessionRuntimeRef("thread/start-runtime-live"),
      (event) => events.push(event),
    );
    await flushCodexAdapterWork();

    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: "thread/start-runtime-live",
        parts: [{ kind: "text", text: "Start now" }],
        model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
      }),
    );
    transports.get("runtime-live")?.turnStartDeferred.resolve({
      turn: { id: "turn-live", status: "running" },
    });
    await flushCodexAdapterWork();

    emitNotification({
      method: "item/completed",
      params: {
        threadId: "thread/start-runtime-live",
        turnId: "turn-live",
        completedAtMs: 1_777_766_419_650,
        item: {
          type: "agentMessage",
          id: "agent-idle-final",
          phase: "final_answer",
          text: "Done before idle.",
        },
      },
    });
    emitNotification({
      method: "thread/tokenUsage/updated",
      params: {
        threadId: "thread/start-runtime-live",
        turnId: "turn-live",
        tokenUsage: {
          total: { totalTokens: 12_345 },
          last: { totalTokens: 321 },
          modelContextWindow: 200_000,
        },
      },
    });
    emitNotification({
      method: "thread/status/changed",
      params: {
        threadId: "thread/start-runtime-live",
        status: { type: "idle" },
      },
    });
    await flushCodexAdapterWork();

    expect(events.some((event) => event.type === "assistant_message")).toBe(false);
    expect(events.some((event) => event.type === "session_idle")).toBe(false);

    emitNotification({
      method: "turn/completed",
      params: {
        threadId: "thread/start-runtime-live",
        turn: {
          id: "turn-live",
          status: "completed",
          completedAt: 1_777_766_420,
          durationMs: 1_200,
        },
      },
    });
    await flushCodexAdapterWork();

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "session_status",
        timestamp: "2026-05-03T00:00:18.450Z",
        status: { type: "busy", message: null },
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "assistant_message",
        message: "Done before idle.",
        totalTokens: 321,
      }),
    );
    const assistantMessageIndex = events.findIndex((event) => event.type === "assistant_message");
    const sessionIdleIndex = events.findLastIndex((event) => event.type === "session_idle");
    expect(assistantMessageIndex).toBeGreaterThanOrEqual(0);
    expect(sessionIdleIndex).toBeGreaterThan(assistantMessageIndex);
    unsubscribe();
  });

  test("late old turn completion does not clear a newer active turn", async () => {
    const { subscribeEvents, emitNotification } = createRuntimeStreamSubscription();
    const firstTurnStart = createDeferred<unknown>();
    const secondTurnStart = createDeferred<unknown>();
    const pendingTurnStarts = [firstTurnStart, secondTurnStart];
    const calls: CodexJsonRpcRequest[] = [];
    const transport: CodexJsonRpcTransport = {
      request: mock(async <Response>(request: CodexJsonRpcRequest): Promise<Response> => {
        calls.push(request);
        if (request.method === "initialize") {
          return {} as Response;
        }
        if (request.method === "model/list") {
          return {
            data: [
              {
                id: "gpt-5",
                model: "gpt-5",
                displayName: "GPT-5",
                hidden: false,
                supportedReasoningEfforts: [
                  { reasoningEffort: "medium", description: "Balanced reasoning" },
                ],
                defaultReasoningEffort: {
                  reasoningEffort: "medium",
                  description: "Balanced reasoning",
                },
                inputModalities: ["text"],
                supportsPersonality: true,
                isDefault: true,
              },
            ],
            nextCursor: null,
          } as Response;
        }
        if (request.method === "thread/start") {
          return {
            thread: {
              id: "thread/start-runtime-live",
              cwd: "/repo",
              createdAt: 1_778_112_000,
              status: { type: "active", activeFlags: [] },
              turns: [],
            },
            startedAt: "2026-05-07T00:00:00.000Z",
          } as Response;
        }
        if (request.method === "thread/name/set") {
          return {} as Response;
        }
        if (request.method === "thread/loaded/list") {
          return { data: ["thread/start-runtime-live"], nextCursor: null } as Response;
        }
        if (request.method === "thread/list") {
          return {
            data: [
              {
                id: "thread/start-runtime-live",
                cwd: "/repo",
                createdAt: 1_778_112_000,
                status: { type: "active", activeFlags: [] },
              },
            ],
            nextCursor: null,
            backwardsCursor: null,
          } as Response;
        }
        if (request.method === "thread/read") {
          return {
            thread: {
              id: "thread/start-runtime-live",
              cwd: "/repo",
              createdAt: 1_778_112_000,
              status: { type: "active", activeFlags: [] },
              turns: [],
            },
          } as Response;
        }
        if (request.method === "turn/start") {
          const deferred = pendingTurnStarts.shift();
          if (!deferred) {
            throw new Error("Unexpected extra turn/start request.");
          }
          return (await deferred.promise) as Response;
        }
        if (request.method === "turn/steer") {
          return { turnId: "turn-steered" } as Response;
        }
        throw new Error(`Unexpected method '${request.method}'.`);
      }),
    };
    const { adapter } = createHarness({
      subscribeEvents,
      transportFactory: () => transport,
    });

    await adapter.startSession(codexStartSessionInput());
    const unsubscribe = await observeSessionState(adapter, "thread/start-runtime-live");

    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: "thread/start-runtime-live",
        parts: [{ kind: "text", text: "Start first turn" }],
        model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
      }),
    );
    emitNotification({
      method: "turn/started",
      params: {
        threadId: "thread/start-runtime-live",
        turn: { id: "turn-old" },
      },
    });
    emitNotification({
      method: "thread/status/changed",
      params: {
        threadId: "thread/start-runtime-live",
        status: { type: "idle" },
      },
    });
    await flushCodexAdapterWork();

    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: "thread/start-runtime-live",
        parts: [{ kind: "text", text: "Start replacement turn" }],
        model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
      }),
    );
    emitNotification({
      method: "turn/started",
      params: {
        threadId: "thread/start-runtime-live",
        turn: { id: "turn-new" },
      },
    });
    await flushCodexAdapterWork();

    firstTurnStart.resolve({ turn: { id: "turn-old", status: "completed" } });
    await flushCodexAdapterWork();

    await expect(
      adapter.readSessionRuntimeSnapshot({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread/start-runtime-live",
      }),
    ).resolves.toMatchObject({ classification: "running" });

    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: "thread/start-runtime-live",
        parts: [{ kind: "text", text: "Steer replacement turn" }],
        model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
      }),
    );

    expect(calls.filter((call) => call.method === "turn/start")).toHaveLength(2);
    expect(calls).toContainEqual({
      method: "turn/steer",
      params: {
        threadId: "thread/start-runtime-live",
        input: [{ type: "text", text: "Steer replacement turn" }],
        expectedTurnId: "turn-new",
      },
    });
    unsubscribe();
  });

  test("does not settle the active turn from idle status before the turn id is bound", async () => {
    const { subscribeEvents, emitNotification } = createRuntimeStreamSubscription();
    const { adapter, transports } = createHarness({ subscribeEvents }, { deferTurnStart: true });

    await adapter.startSession(codexStartSessionInput());
    const unsubscribe = await observeSessionState(adapter, "thread/start-runtime-live");

    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: "thread/start-runtime-live",
        parts: [{ kind: "text", text: "Start now" }],
        model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
      }),
    );

    emitNotification({
      method: "thread/status/changed",
      params: {
        threadId: "thread/start-runtime-live",
        status: { type: "idle" },
      },
    });
    await flushCodexAdapterWork();

    transports.get("runtime-live")?.turnStartDeferred.resolve({
      turn: { id: "turn-live", status: "running" },
    });
    await flushCodexAdapterWork();

    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: "thread/start-runtime-live",
        parts: [{ kind: "text", text: "Keep steering" }],
        model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
      }),
    );

    const runtimeCalls = transports.get("runtime-live")?.calls ?? [];
    expect(runtimeCalls.filter((call) => call.method === "turn/start")).toHaveLength(1);
    expect(runtimeCalls).toContainEqual({
      method: "turn/steer",
      params: {
        threadId: "thread/start-runtime-live",
        input: [{ type: "text", text: "Keep steering" }],
        expectedTurnId: "turn-live",
      },
    });
    unsubscribe();
  });

  test("emits accepted queued Codex user messages into the runtime transcript stream", async () => {
    const streamListeners: Array<
      (event: { runtimeId: string; kind: "notification"; message: unknown }) => void
    > = [];
    const subscribeEvents = mock((_runtimeId: string, listener) => {
      streamListeners.push(listener);
      return () => {};
    });
    const { adapter, transports } = createHarness({ subscribeEvents }, { deferTurnStart: true });

    await adapter.startSession(codexStartSessionInput());

    const events: unknown[] = [];
    const unsubscribe = await adapter.subscribeEvents(
      codexSessionRuntimeRef("thread/start-runtime-live"),
      (event) => events.push(event),
    );

    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: "thread/start-runtime-live",
        parts: [{ kind: "text", text: "Start now" }],
        model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
      }),
    );
    transports.get("runtime-live")?.turnStartDeferred.resolve({
      turn: { id: "turn-active", status: "running" },
    });
    await flushCodexAdapterWork();

    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: "thread/start-runtime-live",
        parts: [{ kind: "text", text: "Also inspect failing tests" }],
        model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
      }),
    );

    const userMessages = events.filter(
      (event): event is { type: "user_message"; message: string } =>
        (event as { type?: string }).type === "user_message",
    );
    expect(userMessages.map((event) => event.message)).toEqual([
      "Start now",
      "Also inspect failing tests",
    ]);
    expect(transports.get("runtime-live")?.calls).toContainEqual({
      method: "turn/steer",
      params: {
        threadId: "thread/start-runtime-live",
        input: [{ type: "text", text: "Also inspect failing tests" }],
        expectedTurnId: "turn-active",
      },
    });

    streamListeners[0]?.({
      runtimeId: "runtime-live",
      kind: "notification",
      receivedAt: new Date().toISOString(),
      message: {
        method: "item/completed",
        params: {
          threadId: "thread/start-runtime-live",
          turnId: "turn-active",
          item: {
            id: "codex-user-queued-confirmed",
            type: "userMessage",
            content: [{ type: "text", text: "Also inspect failing tests" }],
          },
        },
      },
    });
    await flushCodexAdapterWork();
    const userMessagesAfterNativeEcho = events.filter(
      (event): event is { type: "user_message"; message: string } =>
        (event as { type?: string }).type === "user_message",
    );
    expect(userMessagesAfterNativeEcho.map((event) => event.message)).toEqual([
      "Start now",
      "Also inspect failing tests",
    ]);
    unsubscribe();
  });

  test("does not duplicate streamed user message completions after synthetic echo", async () => {
    const streamListeners: Array<
      (event: { runtimeId: string; kind: "notification"; message: unknown }) => void
    > = [];
    const subscribeEvents = mock((_runtimeId: string, listener) => {
      streamListeners.push(listener);
      return () => {};
    });
    const { adapter } = createHarness({ subscribeEvents });

    await adapter.startSession(codexStartSessionInput());

    const events: unknown[] = [];
    const unsubscribe = await adapter.subscribeEvents(
      codexSessionRuntimeRef("thread/start-runtime-live"),
      (event) => events.push(event),
    );

    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: "thread/start-runtime-live",
        parts: [{ kind: "text", text: "Hello streamed Codex" }],
        model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
      }),
    );

    streamListeners[0]?.({
      runtimeId: "runtime-live",
      kind: "notification",
      receivedAt: new Date().toISOString(),
      message: {
        method: "item/completed",
        params: {
          threadId: "thread/start-runtime-live",
          turnId: "turn-1",
          item: {
            id: "codex-user-confirmed",
            type: "userMessage",
            content: [{ type: "text", text: "Hello   streamed\nCodex" }],
          },
        },
      },
    });
    await flushCodexAdapterWork();

    const userMessages = events.filter(
      (event) => (event as { type?: string }).type === "user_message",
    );
    expect(userMessages).toHaveLength(1);
    expect(userMessages[0]).toEqual(expect.objectContaining({ message: "Hello streamed Codex" }));
    expect(userMessages).not.toContainEqual(
      expect.objectContaining({ messageId: "codex-user-confirmed" }),
    );
    unsubscribe();
  });

  test("does not duplicate structured streamed user message completions after synthetic echo", async () => {
    const streamListeners: Array<
      (event: { runtimeId: string; kind: "notification"; message: unknown }) => void
    > = [];
    const subscribeEvents = mock((_runtimeId: string, listener) => {
      streamListeners.push(listener);
      return () => {};
    });
    const { adapter } = createHarness({ subscribeEvents });

    await adapter.startSession(codexStartSessionInput());

    const events: unknown[] = [];
    const unsubscribe = await adapter.subscribeEvents(
      codexSessionRuntimeRef("thread/start-runtime-live"),
      (event) => events.push(event),
    );

    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: "thread/start-runtime-live",
        parts: [
          { kind: "text", text: "Inspect" },
          {
            kind: "file_reference",
            file: { id: "file-1", path: "/repo/src/app.ts", name: "app.ts", kind: "code" },
          },
        ],
        model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
      }),
    );

    streamListeners[0]?.({
      runtimeId: "runtime-live",
      kind: "notification",
      receivedAt: new Date().toISOString(),
      message: {
        method: "item/completed",
        params: {
          threadId: "thread/start-runtime-live",
          turnId: "turn-1",
          item: {
            id: "codex-structured-user-confirmed",
            type: "userMessage",
            content: [
              { type: "text", text: "Inspect" },
              { type: "mention", name: "app.ts", path: "/repo/src/app.ts" },
            ],
          },
        },
      },
    });
    await flushCodexAdapterWork();

    const userMessages = events.filter(
      (event) => (event as { type?: string }).type === "user_message",
    );
    expect(userMessages).toHaveLength(1);
    expect(userMessages[0]).toEqual(
      expect.objectContaining({
        parts: expect.arrayContaining([
          expect.objectContaining({
            kind: "file_reference",
            file: expect.objectContaining({ name: "app.ts" }),
          }),
        ]),
      }),
    );
    expect(userMessages).not.toContainEqual(
      expect.objectContaining({ messageId: "codex-structured-user-confirmed" }),
    );
    unsubscribe();
  });

  test("does not duplicate streamed skill reference user message completions after synthetic echo", async () => {
    const streamListeners: Array<
      (event: { runtimeId: string; kind: "notification"; message: unknown }) => void
    > = [];
    const subscribeEvents = mock((_runtimeId: string, listener) => {
      streamListeners.push(listener);
      return () => {};
    });
    const { adapter } = createHarness({ subscribeEvents });

    await adapter.startSession(codexStartSessionInput());

    const events: unknown[] = [];
    const unsubscribe = await adapter.subscribeEvents(
      codexSessionRuntimeRef("thread/start-runtime-live"),
      (event) => events.push(event),
    );

    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: "thread/start-runtime-live",
        parts: [
          { kind: "text", text: "Tell me the purpose of " },
          {
            kind: "skill_mention",
            skill: {
              id: "/skills/address-pr-comments/SKILL.md",
              name: "address-pr-comments",
              path: "/skills/address-pr-comments/SKILL.md",
            },
          },
        ],
        model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
      }),
    );

    streamListeners[0]?.({
      runtimeId: "runtime-live",
      kind: "notification",
      receivedAt: new Date().toISOString(),
      message: {
        method: "item/completed",
        params: {
          threadId: "thread/start-runtime-live",
          turnId: "turn-1",
          item: {
            id: "codex-skill-user-confirmed",
            type: "userMessage",
            content: [
              { type: "text", text: "Tell me the purpose of " },
              { type: "text", text: "$address-pr-comments" },
              {
                type: "skill",
                name: "address-pr-comments",
                path: "/skills/address-pr-comments/SKILL.md",
              },
            ],
          },
        },
      },
    });
    await Promise.resolve();

    const userMessages = events.filter(
      (event) => (event as { type?: string }).type === "user_message",
    );
    expect(userMessages).toHaveLength(1);
    expect(userMessages[0]).toEqual(
      expect.objectContaining({
        message: "Tell me the purpose of $address-pr-comments",
        parts: expect.arrayContaining([
          expect.objectContaining({
            kind: "skill_mention",
            skill: expect.objectContaining({ name: "address-pr-comments" }),
          }),
        ]),
      }),
    );
    expect(userMessages).not.toContainEqual(
      expect.objectContaining({ messageId: "codex-skill-user-confirmed" }),
    );
    unsubscribe();
  });

  test("emits sent image attachments with staged paths", async () => {
    const subscribeEvents = mock(() => () => {});
    const { adapter } = createHarness({ subscribeEvents });

    await adapter.startSession(codexStartSessionInput());

    const events: unknown[] = [];
    const unsubscribe = await adapter.subscribeEvents(
      codexSessionRuntimeRef("thread/start-runtime-live"),
      (event) => events.push(event),
    );

    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: "thread/start-runtime-live",
        parts: [
          { kind: "text", text: "Inspect this screenshot" },
          {
            kind: "attachment",
            attachment: {
              id: "attachment-1",
              kind: "image",
              name: "Screenshot 2026-05-20 at 21.01.45.png",
              path: "/tmp/openducktor-local-attachments/staged-screenshot.png",
              mime: "image/png",
            },
          },
        ],
        model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
      }),
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "user_message",
        parts: expect.arrayContaining([
          expect.objectContaining({
            kind: "attachment",
            attachment: expect.objectContaining({
              kind: "image",
              name: "Screenshot 2026-05-20 at 21.01.45.png",
              path: "/tmp/openducktor-local-attachments/staged-screenshot.png",
            }),
          }),
        ]),
      }),
    );
    unsubscribe();
  });

  test("does not retain streamed events for a late renderer subscription", async () => {
    const streamListeners: Array<
      (event: { runtimeId: string; kind: "notification"; message: unknown }) => void
    > = [];
    const subscribeEvents = mock((_runtimeId: string, listener) => {
      streamListeners.push(listener);
      return () => {};
    });
    const { adapter } = createHarness({ subscribeEvents });

    const unsubscribeExistingSessionListener = await observeSessionState(adapter, "thread-saved");
    unsubscribeExistingSessionListener();

    streamListeners[0]?.({
      runtimeId: "runtime-live",
      kind: "notification",
      receivedAt: new Date().toISOString(),
      message: {
        method: "item/agentMessage/delta",
        params: {
          threadId: "thread-saved",
          turnId: "turn-live",
          itemId: "agent-live",
          delta: "buffered text",
        },
      },
    });
    streamListeners[0]?.({
      runtimeId: "runtime-live",
      kind: "notification",
      receivedAt: new Date().toISOString(),
      message: {
        method: "item/started",
        params: {
          threadId: "thread-saved",
          turnId: "turn-live",
          startedAtMs: 1_777_766_440_000,
          item: {
            type: "contextCompaction",
            id: "compact-live",
          },
        },
      },
    });
    streamListeners[0]?.({
      runtimeId: "runtime-live",
      kind: "notification",
      receivedAt: new Date().toISOString(),
      message: {
        method: "item/completed",
        params: {
          threadId: "thread-saved",
          turnId: "turn-live",
          completedAtMs: 1_777_766_441_000,
          item: {
            type: "contextCompaction",
            id: "compact-live",
          },
        },
      },
    });
    await flushCodexAdapterWork();

    const events: unknown[] = [];
    const unsubscribe = await adapter.subscribeEvents(
      codexSessionRuntimeRef("thread-saved"),
      (event) => events.push(event),
    );

    expect(events).toEqual([]);
    unsubscribe();
  });

  test("routes live context compaction lifecycle items", async () => {
    const streamListeners: Array<
      (event: { runtimeId: string; kind: "notification"; message: unknown }) => void
    > = [];
    const subscribeEvents = mock((_runtimeId: string, listener) => {
      streamListeners.push(listener);
      return () => {};
    });
    const { adapter } = createHarness({ subscribeEvents });
    const events: unknown[] = [];

    await observeSessionState(adapter, "thread-saved");
    const unsubscribe = await adapter.subscribeEvents(
      codexSessionRuntimeRef("thread-saved"),
      (event) => events.push(event),
    );

    streamListeners[0]?.({
      runtimeId: "runtime-live",
      kind: "notification",
      receivedAt: new Date().toISOString(),
      message: {
        method: "item/started",
        params: {
          threadId: "thread-saved",
          turnId: "turn-live",
          startedAtMs: 1_777_766_450_000,
          item: {
            type: "contextCompaction",
            id: "compact-live",
          },
        },
      },
    });
    streamListeners[0]?.({
      runtimeId: "runtime-live",
      kind: "notification",
      receivedAt: new Date().toISOString(),
      message: {
        method: "item/completed",
        params: {
          threadId: "thread-saved",
          turnId: "turn-live",
          completedAtMs: 1_777_766_451_000,
          item: {
            type: "contextCompaction",
            id: "compact-live",
          },
        },
      },
    });
    await flushCodexAdapterWork();

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "session_compaction_started",
        externalSessionId: "thread-saved",
        timestamp: expect.any(String),
        messageId: "compact-live",
        message: "Session compaction started.",
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "session_compacted",
        externalSessionId: "thread-saved",
        timestamp: expect.any(String),
        messageId: "compact-live",
        message: "Session compacted.",
      }),
    );
    unsubscribe();
  });

  test("terminalizes orphaned spawns only at turn lifecycle boundaries", async () => {
    const streamListeners: Array<
      (event: { runtimeId: string; kind: "notification"; message: unknown }) => void
    > = [];
    const subscribeEvents = mock((_runtimeId: string, listener) => {
      streamListeners.push(listener);
      return () => {};
    });
    const { adapter } = createHarness({ subscribeEvents });
    const events: unknown[] = [];

    const setupUnsubscribe = await observeSessionState(adapter, "thread-saved");
    const unsubscribe = await adapter.subscribeEvents(
      codexSessionRuntimeRef("thread-saved"),
      (event) => events.push(event),
    );

    try {
      streamListeners[0]?.({
        runtimeId: "runtime-live",
        kind: "notification",
        receivedAt: new Date().toISOString(),
        message: {
          method: "item/started",
          params: {
            threadId: "thread-saved",
            turnId: "turn-live",
            startedAtMs: 1_777_766_452_000,
            item: {
              type: "collabAgentToolCall",
              id: "spawn-live",
              tool: "spawnAgent",
              status: "inProgress",
              senderThreadId: "thread-saved",
              receiverThreadIds: [],
              prompt: "Review this change",
              agentsStates: {},
            },
          },
        },
      });
      await flushCodexAdapterWork();

      expect(events).toContainEqual(
        expect.objectContaining({
          type: "assistant_part",
          externalSessionId: "thread-saved",
          part: expect.objectContaining({
            kind: "subagent",
            correlationKey: "codex-subagent:thread-saved:spawn-live",
            status: "running",
            prompt: "Review this change",
          }),
        }),
      );

      streamListeners[0]?.({
        runtimeId: "runtime-live",
        kind: "notification",
        receivedAt: new Date().toISOString(),
        message: {
          method: "item/completed",
          params: {
            threadId: "thread-saved",
            turnId: "turn-live",
            completedAtMs: 1_777_766_452_021,
            item: {
              type: "agentMessage",
              id: "retry-message",
              text: "The first spawn failed validation. Retrying now.",
            },
          },
        },
      });
      await flushCodexAdapterWork();

      expect(events).not.toContainEqual(
        expect.objectContaining({
          type: "assistant_part",
          externalSessionId: "thread-saved",
          part: expect.objectContaining({
            kind: "subagent",
            correlationKey: "codex-subagent:thread-saved:spawn-live",
            status: "error",
          }),
        }),
      );

      streamListeners[0]?.({
        runtimeId: "runtime-live",
        kind: "notification",
        receivedAt: new Date().toISOString(),
        message: {
          method: "turn/completed",
          params: {
            threadId: "thread-saved",
            turn: {
              id: "turn-live",
              status: "failed",
              completedAt: 1_777_766_452,
            },
          },
        },
      });
      await flushCodexAdapterWork();

      expect(events).toContainEqual(
        expect.objectContaining({
          type: "assistant_part",
          externalSessionId: "thread-saved",
          part: expect.objectContaining({
            kind: "subagent",
            correlationKey: "codex-subagent:thread-saved:spawn-live",
            status: "error",
          }),
        }),
      );

      streamListeners[0]?.({
        runtimeId: "runtime-live",
        kind: "notification",
        receivedAt: new Date().toISOString(),
        message: {
          method: "item/started",
          params: {
            threadId: "thread-saved",
            turnId: "turn-without-followup",
            startedAtMs: 1_777_766_453_000,
            item: {
              type: "collabAgentToolCall",
              id: "spawn-without-followup",
              tool: "spawnAgent",
              status: "inProgress",
              senderThreadId: "thread-saved",
              receiverThreadIds: [],
              prompt: "Review another change",
              agentsStates: {},
            },
          },
        },
      });
      streamListeners[0]?.({
        runtimeId: "runtime-live",
        kind: "notification",
        receivedAt: new Date().toISOString(),
        message: {
          method: "turn/completed",
          params: {
            threadId: "thread-saved",
            turn: {
              id: "turn-without-followup",
              status: "failed",
              completedAt: 1_777_766_454,
            },
          },
        },
      });
      await flushCodexAdapterWork();

      expect(events).toContainEqual(
        expect.objectContaining({
          type: "assistant_part",
          externalSessionId: "thread-saved",
          part: expect.objectContaining({
            kind: "subagent",
            correlationKey: "codex-subagent:thread-saved:spawn-without-followup",
            status: "error",
          }),
        }),
      );

      streamListeners[0]?.({
        runtimeId: "runtime-live",
        kind: "notification",
        receivedAt: new Date().toISOString(),
        message: {
          method: "item/started",
          params: {
            threadId: "thread-saved",
            turnId: "turn-settled-by-idle",
            startedAtMs: 1_777_766_455_000,
            item: {
              type: "collabAgentToolCall",
              id: "spawn-settled-by-idle",
              tool: "spawnAgent",
              status: "inProgress",
              senderThreadId: "thread-saved",
              receiverThreadIds: [],
              prompt: "Review a third change",
              agentsStates: {},
            },
          },
        },
      });
      streamListeners[0]?.({
        runtimeId: "runtime-live",
        kind: "notification",
        receivedAt: new Date().toISOString(),
        message: {
          method: "thread/status/changed",
          params: {
            threadId: "thread-saved",
            status: { type: "idle" },
          },
        },
      });
      await flushCodexAdapterWork();

      expect(events).toContainEqual(
        expect.objectContaining({
          type: "assistant_part",
          externalSessionId: "thread-saved",
          part: expect.objectContaining({
            kind: "subagent",
            correlationKey: "codex-subagent:thread-saved:spawn-settled-by-idle",
            status: "error",
          }),
        }),
      );
    } finally {
      unsubscribe();
      setupUnsubscribe();
    }
  });
});
