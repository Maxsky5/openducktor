import { describe, expect, test } from "bun:test";
import type { Part } from "@opencode-ai/sdk/v2";
import { MANUAL_SESSION_COMPACTION_SLASH_COMMAND } from "@openducktor/contracts";
import type { AgentEvent } from "@openducktor/core";
import {
  buildQueuedSignature,
  makeMockClient,
  OpencodeSdkAdapter,
  sessionRuntimeRef,
  startDefaultSession,
} from "./test-support";

const OPENCODE_MESSAGE_ID_PATTERN = /^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/;

describe("OpencodeSdkAdapter user message", () => {
  test("manual compaction bypasses workflow-tool discovery", async () => {
    const mock = makeMockClient({});
    const summarizeCalls: unknown[] = [];
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    await startDefaultSession(adapter, "build");
    Object.assign(mock.client.session, {
      summarize: async (input: unknown) => {
        summarizeCalls.push(input);
        return { data: true, error: undefined };
      },
    });
    Object.assign(mock.client.mcp, {
      status: async () => {
        throw new Error("MCP discovery must not run");
      },
    });
    Object.assign(mock.client.tool, {
      ids: async () => {
        throw new Error("Tool discovery must not run");
      },
    });
    mock.mcp.statusCalls.length = 0;
    mock.tool.idsCalls.length = 0;
    const events: AgentEvent[] = [];
    const unsubscribe = await adapter.subscribeEvents(
      sessionRuntimeRef("session-opencode-1", { role: "build" }),
      (event) => events.push(event),
    );

    try {
      await adapter.sendUserMessage({
        ...sessionRuntimeRef("session-opencode-1", { role: "build" }),
        parts: [{ kind: "slash_command", command: MANUAL_SESSION_COMPACTION_SLASH_COMMAND }],
        model: { providerId: "openai", modelId: "gpt-5" },
      });
    } finally {
      unsubscribe();
    }

    expect(summarizeCalls).toHaveLength(1);
    expect(events.some((event) => event.type === "user_message")).toBe(false);
    expect(mock.mcp.statusCalls).toEqual([]);
    expect(mock.tool.idsCalls).toEqual([]);
  });

  test("rejected manual compaction preserves an active assistant turn", async () => {
    const mock = makeMockClient({});
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    await startDefaultSession(adapter, "build");
    Object.assign(mock.client.session, {
      summarize: async () => {
        throw new Error("Session is busy");
      },
    });
    const session = (
      adapter as unknown as {
        sessions: Map<
          string,
          {
            activeAssistantMessageId: string | null;
            streamTurnStatus: "active" | "idle";
          }
        >;
      }
    ).sessions.get("session-opencode-1");
    if (!session) {
      throw new Error("Expected adapter session record");
    }
    session.activeAssistantMessageId = "assistant-active";
    session.streamTurnStatus = "active";
    const events: AgentEvent[] = [];
    const unsubscribe = await adapter.subscribeEvents(
      sessionRuntimeRef("session-opencode-1", { role: "build" }),
      (event) => events.push(event),
    );

    try {
      await expect(
        adapter.sendUserMessage({
          ...sessionRuntimeRef("session-opencode-1", { role: "build" }),
          parts: [{ kind: "slash_command", command: MANUAL_SESSION_COMPACTION_SLASH_COMMAND }],
          model: { providerId: "openai", modelId: "gpt-5" },
        }),
      ).rejects.toThrow("Session is busy");
    } finally {
      unsubscribe();
    }

    expect(session.activeAssistantMessageId).toBe("assistant-active");
    expect(session.streamTurnStatus).toBe("active");
    expect(events.some((event) => event.type === "session_idle")).toBe(false);
  });

  test("invalid compaction shape fails before workflow-tool discovery", async () => {
    const mock = makeMockClient({});
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    await startDefaultSession(adapter, "build");
    Object.assign(mock.client.mcp, {
      status: async () => {
        throw new Error("MCP discovery must not run");
      },
    });
    mock.mcp.statusCalls.length = 0;

    await expect(
      adapter.sendUserMessage({
        ...sessionRuntimeRef("session-opencode-1", { role: "build" }),
        parts: [
          { kind: "slash_command", command: MANUAL_SESSION_COMPACTION_SLASH_COMMAND },
          { kind: "text", text: " now" },
        ],
        model: { providerId: "openai", modelId: "gpt-5" },
      }),
    ).rejects.toThrow(
      "OpenCode request failed: compact session: /compact must be sent without arguments or references",
    );
    expect(mock.mcp.statusCalls).toEqual([]);
  });

  test("rejects cached session route mismatches before compaction", async () => {
    const mock = makeMockClient({});
    const summarizeCalls: unknown[] = [];
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    await startDefaultSession(adapter, "build");
    Object.assign(mock.client.session, {
      summarize: async (input: unknown) => {
        summarizeCalls.push(input);
        return { data: true, error: undefined };
      },
    });

    for (const override of [{ repoPath: "/other" }, { workingDirectory: "/other" }]) {
      await expect(
        adapter.sendUserMessage({
          ...sessionRuntimeRef("session-opencode-1", { role: "build" }),
          ...override,
          parts: [{ kind: "slash_command", command: MANUAL_SESSION_COMPACTION_SLASH_COMMAND }],
          model: { providerId: "openai", modelId: "gpt-5" },
        }),
      ).rejects.toThrow("Cannot send OpenCode session 'session-opencode-1'");
    }

    expect(summarizeCalls).toEqual([]);
  });

  test("sendUserMessage forwards selected model with openducktor role-scoped tools", async () => {
    const mock = makeMockClient({});
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    await startDefaultSession(adapter, "spec");

    const events: Array<{ type: string }> = [];
    await adapter.subscribeEvents(sessionRuntimeRef("session-opencode-1"), (event) =>
      events.push(event as { type: string }),
    );

    await adapter.sendUserMessage({
      ...sessionRuntimeRef("session-opencode-1"),
      parts: [{ kind: "text", text: "Write and persist spec" }],
      model: {
        providerId: "openai",
        modelId: "gpt-5",
        variant: "high",
        profileId: "hephaestus",
      },
    });

    expect(mock.session.promptCalls).toHaveLength(0);
    expect(mock.session.promptAsyncCalls).toHaveLength(1);
    expect(mock.session.promptAsyncCalls[0]).toMatchObject({
      sessionID: "session-opencode-1",
      directory: "/repo",
      system: "system prompt",
      model: {
        providerID: "openai",
        modelID: "gpt-5",
      },
      variant: "high",
      agent: "hephaestus",
      tools: {
        edit: false,
        write: false,
        apply_patch: false,
        ast_grep_replace: false,
        lsp_rename: false,
        odt_create_task: false,
        odt_search_tasks: false,
        odt_get_workspaces: false,
        openducktor_odt_read_task: true,
        openducktor_odt_read_task_documents: true,
        openducktor_odt_set_spec: true,
        openducktor_odt_set_plan: false,
        openducktor_odt_build_blocked: false,
        openducktor_odt_build_resumed: false,
        openducktor_odt_build_completed: false,
        openducktor_odt_set_pull_request: false,
        openducktor_odt_qa_approved: false,
        openducktor_odt_qa_rejected: false,
      },
      parts: [{ type: "text", text: "Write and persist spec" }],
    });
    expect(mock.tool.idsCalls).toEqual([{ directory: "/repo" }]);
    expect(mock.mcp.statusCalls).toEqual([{ directory: "/repo" }]);
    expect(events.some((event) => event.type === "assistant_message")).toBe(false);
    expect(events.some((event) => event.type === "session_idle")).toBe(false);
  });

  test("sendUserMessage does not emit assistant output before stream events arrive", async () => {
    const mock = makeMockClient({});
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    await startDefaultSession(adapter, "spec");

    const events: AgentEvent[] = [];
    await adapter.subscribeEvents(sessionRuntimeRef("session-opencode-1"), (event) =>
      events.push(event),
    );

    await adapter.sendUserMessage({
      ...sessionRuntimeRef("session-opencode-1"),
      parts: [{ kind: "text", text: "Recover ids" }],
    });

    expect(events.some((event) => event.type === "assistant_part")).toBe(false);
    expect(events.some((event) => event.type === "assistant_message")).toBe(false);
    expect(events.some((event) => event.type === "session_idle")).toBe(false);
  });

  test("sendUserMessage emits the admitted user message without reloading history", async () => {
    const mock = makeMockClient({});
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    await startDefaultSession(adapter, "build");

    const events: AgentEvent[] = [];
    await adapter.subscribeEvents(
      sessionRuntimeRef("session-opencode-1", { role: "build" }),
      (event) => events.push(event),
    );

    await adapter.sendUserMessage({
      ...sessionRuntimeRef("session-opencode-1", { role: "build" }),
      parts: [{ kind: "text", text: "Kick off the builder" }],
    });

    const userEvents = events.filter(
      (event): event is Extract<AgentEvent, { type: "user_message" }> =>
        event.type === "user_message",
    );
    const promptRequest = mock.session.promptAsyncCalls[0] as { messageID?: string } | undefined;
    expect(userEvents).toEqual([
      expect.objectContaining({
        messageId: expect.stringMatching(OPENCODE_MESSAGE_ID_PATTERN),
        message: "Kick off the builder",
        state: "read",
        parts: [{ kind: "text", text: "Kick off the builder" }],
      }),
    ]);
    expect(userEvents[0]?.messageId).toBe(promptRequest?.messageID);
    expect(mock.session.messagesCalls).toEqual([]);
  });

  test("sendUserMessage keeps history loading out of the send path", async () => {
    const oldUserMessage = {
      info: {
        id: "runtime-user-old",
        role: "user" as const,
        time: { created: Date.parse("2026-02-17T12:00:01Z") },
      },
      parts: [
        {
          id: "runtime-user-old-part",
          sessionID: "session-opencode-1",
          messageID: "runtime-user-old",
          type: "text",
          text: "Already visible",
          time: { start: Date.parse("2026-02-17T12:00:01Z") },
        } as Part,
      ],
    };
    const mock = makeMockClient({
      messagesResponse: [oldUserMessage],
    });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    await startDefaultSession(adapter, "build");

    const events: AgentEvent[] = [];
    await adapter.subscribeEvents(
      sessionRuntimeRef("session-opencode-1", { role: "build" }),
      (event) => events.push(event),
    );

    await adapter.loadSessionHistory(sessionRuntimeRef("session-opencode-1", { role: "build" }));

    await adapter.sendUserMessage({
      ...sessionRuntimeRef("session-opencode-1", { role: "build" }),
      parts: [{ kind: "text", text: "Kick off the builder" }],
    });

    const userEvents = events.filter(
      (event): event is Extract<AgentEvent, { type: "user_message" }> =>
        event.type === "user_message",
    );
    expect(userEvents).toEqual([
      expect.objectContaining({
        messageId: expect.stringMatching(OPENCODE_MESSAGE_ID_PATTERN),
        message: "Kick off the builder",
      }),
    ]);
    expect(mock.session.messagesCalls).toHaveLength(1);
  });

  test("sendUserMessage uses the native session command endpoint for slash commands", async () => {
    const mock = makeMockClient({});
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    await startDefaultSession(adapter, "build");

    await adapter.sendUserMessage({
      ...sessionRuntimeRef("session-opencode-1", { role: "build" }),
      parts: [
        {
          kind: "slash_command",
          command: {
            id: "review",
            trigger: "review",
            title: "review",
            hints: [],
          },
        },
        { kind: "text", text: " summarize the latest session" },
      ],
      model: {
        providerId: "openai",
        modelId: "gpt-5",
        variant: "high",
        profileId: "hephaestus",
      },
    });

    expect(mock.session.commandCalls).toEqual([
      {
        sessionID: "session-opencode-1",
        directory: "/repo",
        messageID: expect.stringMatching(OPENCODE_MESSAGE_ID_PATTERN),
        command: "review",
        arguments: "summarize the latest session",
        model: "openai/gpt-5",
        variant: "high",
        agent: "hephaestus",
      },
    ]);
    expect(mock.session.promptAsyncCalls).toHaveLength(0);
  });

  test("sendUserMessage emits a busy status immediately for slash commands", async () => {
    const mock = makeMockClient({});
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    await startDefaultSession(adapter, "build");

    const events: AgentEvent[] = [];
    await adapter.subscribeEvents(sessionRuntimeRef("session-opencode-1"), (event) =>
      events.push(event),
    );

    await adapter.sendUserMessage({
      ...sessionRuntimeRef("session-opencode-1", { role: "build" }),
      parts: [
        {
          kind: "slash_command",
          command: {
            id: "review",
            trigger: "review",
            title: "review",
            hints: [],
          },
        },
      ],
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "session_status",
        externalSessionId: "session-opencode-1",
        timestamp: "2026-02-17T12:00:00Z",
        status: { type: "busy", message: null },
      }),
    );
  });

  test("sendUserMessage rejects slash commands that are not the first meaningful segment", async () => {
    const mock = makeMockClient({});
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    await startDefaultSession(adapter, "build");

    await expect(
      adapter.sendUserMessage({
        ...sessionRuntimeRef("session-opencode-1", { role: "build" }),
        parts: [
          { kind: "text", text: "before " },
          {
            kind: "slash_command",
            command: {
              id: "review",
              trigger: "review",
              title: "review",
              hints: [],
            },
          },
        ],
      }),
    ).rejects.toThrow("OpenCode slash commands must be the first meaningful message segment.");
    expect(mock.session.commandCalls).toHaveLength(0);
    expect(mock.session.promptAsyncCalls).toHaveLength(0);
  });

  test("sendUserMessage emits session_idle when the send fails after reporting busy", async () => {
    const mock = makeMockClient({
      commandResult: {
        mode: "api_error",
        error: new Error("bad command payload"),
        response: { status: 400, statusText: "Bad Request" },
      },
    });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    await startDefaultSession(adapter, "build");

    const events: AgentEvent[] = [];
    await adapter.subscribeEvents(sessionRuntimeRef("session-opencode-1"), (event) =>
      events.push(event),
    );

    await expect(
      adapter.sendUserMessage({
        ...sessionRuntimeRef("session-opencode-1", { role: "build" }),
        parts: [
          {
            kind: "slash_command",
            command: {
              id: "review",
              trigger: "review",
              title: "review",
              hints: [],
            },
          },
        ],
      }),
    ).rejects.toThrow("OpenCode request failed: run slash command (400 Bad Request)");

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "session_status",
        externalSessionId: "session-opencode-1",
        timestamp: "2026-02-17T12:00:00Z",
        status: { type: "busy", message: null },
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "session_idle",
        externalSessionId: "session-opencode-1",
        timestamp: "2026-02-17T12:00:00Z",
      }),
    );
  });

  test("sendUserMessage keeps stream activity owned by runtime events", async () => {
    const mock = makeMockClient({});
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    await startDefaultSession(adapter, "spec");

    const sessions = (
      adapter as unknown as {
        sessions: Map<
          string,
          { streamTurnStatus: "active" | "idle"; isSendingUserMessage: boolean }
        >;
      }
    ).sessions;
    const session = sessions.get("session-opencode-1");
    if (!session) {
      throw new Error("Expected adapter session record");
    }

    session.streamTurnStatus = "idle";

    await adapter.sendUserMessage({
      ...sessionRuntimeRef("session-opencode-1"),
      parts: [{ kind: "text", text: "Second turn" }],
    });

    expect(session.streamTurnStatus).toBe("idle");
    expect(session.isSendingUserMessage).toBe(false);
  });

  test("sendUserMessage does not pre-queue the first turn without a pending assistant boundary", async () => {
    const mock = makeMockClient({});
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    await startDefaultSession(adapter, "spec");

    const sessions = (
      adapter as unknown as {
        sessions: Map<
          string,
          {
            activeAssistantMessageId: string | null;
            pendingQueuedUserMessages: Array<{ signature: string }>;
          }
        >;
      }
    ).sessions;
    const session = sessions.get("session-opencode-1");
    if (!session) {
      throw new Error("Expected adapter session record");
    }

    session.activeAssistantMessageId = null;

    await adapter.sendUserMessage({
      ...sessionRuntimeRef("session-opencode-1"),
      parts: [{ kind: "text", text: "First turn" }],
    });

    expect(session.pendingQueuedUserMessages).toHaveLength(0);
  });

  test("sendUserMessage pre-queues busy follow-ups when an assistant boundary is active", async () => {
    const mock = makeMockClient({});
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    await startDefaultSession(adapter, "spec");

    const sessions = (
      adapter as unknown as {
        sessions: Map<
          string,
          {
            activeAssistantMessageId: string | null;
            pendingQueuedUserMessages: Array<{ signature: string }>;
          }
        >;
      }
    ).sessions;
    const session = sessions.get("session-opencode-1");
    if (!session) {
      throw new Error("Expected adapter session record");
    }

    session.activeAssistantMessageId = "msg-200";

    await adapter.sendUserMessage({
      ...sessionRuntimeRef("session-opencode-1"),
      parts: [{ kind: "text", text: "Queued follow-up" }],
    });

    expect(session.pendingQueuedUserMessages).toEqual([
      { signature: buildQueuedSignature("Queued follow-up") },
    ]);
  });

  test("sendUserMessage pre-queues follow-ups after a slash command establishes an assistant boundary", async () => {
    const mock = makeMockClient({
      commandResult: {
        mode: "success",
        data: {
          info: {
            id: "msg-command-assistant-1",
          },
        },
      },
    });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    await startDefaultSession(adapter, "build");

    const sessions = (
      adapter as unknown as {
        sessions: Map<
          string,
          {
            activeAssistantMessageId: string | null;
            pendingQueuedUserMessages: Array<{ signature: string }>;
          }
        >;
      }
    ).sessions;
    const session = sessions.get("session-opencode-1");
    if (!session) {
      throw new Error("Expected adapter session record");
    }

    await adapter.sendUserMessage({
      ...sessionRuntimeRef("session-opencode-1", { role: "build" }),
      parts: [
        {
          kind: "slash_command",
          command: {
            id: "review",
            trigger: "review",
            title: "review",
            hints: [],
          },
        },
      ],
    });

    expect(session.activeAssistantMessageId).toBe("msg-command-assistant-1");

    await adapter.sendUserMessage({
      ...sessionRuntimeRef("session-opencode-1", { role: "build" }),
      parts: [{ kind: "text", text: "Queued follow-up" }],
    });

    expect(session.pendingQueuedUserMessages).toEqual([
      { signature: buildQueuedSignature("Queued follow-up") },
    ]);
  });

  test("updateSessionModel refreshes the adapter session model used for subsequent prompts", async () => {
    const mock = makeMockClient({});
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    await startDefaultSession(adapter, "spec");
    adapter.updateSessionModel({
      externalSessionId: "session-opencode-1",
      model: {
        providerId: "openai",
        modelId: "gpt-5",
        variant: "high",
        profileId: "Hephaestus",
      },
    });

    await adapter.sendUserMessage({
      ...sessionRuntimeRef("session-opencode-1"),
      parts: [{ kind: "text", text: "Continue" }],
    });

    expect(mock.session.promptCalls).toHaveLength(0);
    expect(mock.session.promptAsyncCalls).toHaveLength(1);
    expect(mock.session.promptAsyncCalls[0]).toMatchObject({
      model: {
        providerID: "openai",
        modelID: "gpt-5",
      },
      variant: "high",
      agent: "Hephaestus",
    });
  });

  test("sendUserMessage caches workflow tool discovery but checks MCP health for each prompt", async () => {
    const mock = makeMockClient({});
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    await startDefaultSession(adapter, "spec");

    const selectedModel = {
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
    } as const;

    await adapter.sendUserMessage({
      ...sessionRuntimeRef("session-opencode-1"),
      parts: [{ kind: "text", text: "First message" }],
      model: selectedModel,
    });
    await adapter.sendUserMessage({
      ...sessionRuntimeRef("session-opencode-1"),
      parts: [{ kind: "text", text: "Second message" }],
      model: selectedModel,
    });

    expect(mock.tool.idsCalls).toEqual([{ directory: "/repo" }]);
    expect(mock.mcp.statusCalls).toEqual([{ directory: "/repo" }, { directory: "/repo" }]);
    expect(mock.session.promptCalls).toHaveLength(0);
    expect(mock.session.promptAsyncCalls).toHaveLength(2);
  });

  test("sendUserMessage uses global workflow tool discovery even when the session has a selected model", async () => {
    const mock = makeMockClient({
      toolIdsResponse: ["bash", "read", "glob"],
    });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    await startDefaultSession(adapter, "spec", {
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
    });

    await adapter.sendUserMessage({
      ...sessionRuntimeRef("session-opencode-1"),
      parts: [{ kind: "text", text: "Use the saved model" }],
    });

    expect(mock.tool.listCalls).toEqual([]);
    expect(mock.session.promptCalls).toHaveLength(0);
    const promptAsyncCall = mock.session.promptAsyncCalls[0] as
      | { tools?: Record<string, boolean> }
      | undefined;
    expect(promptAsyncCall?.tools).toMatchObject({
      edit: false,
      write: false,
      apply_patch: false,
      ast_grep_replace: false,
      lsp_rename: false,
      odt_create_task: false,
      odt_search_tasks: false,
      odt_get_workspaces: false,
      odt_read_task: true,
      odt_read_task_documents: true,
      odt_set_spec: true,
      odt_set_plan: false,
    });
  });

  test("sendUserMessage wraps promptAsync API errors with response details", async () => {
    const mock = makeMockClient({
      promptAsyncResult: {
        mode: "api_error",
        error: { message: "quota exceeded" },
        response: { status: 429, statusText: "Too Many Requests" },
      },
    });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    await startDefaultSession(adapter, "spec");

    await expect(
      adapter.sendUserMessage({
        ...sessionRuntimeRef("session-opencode-1"),
        parts: [{ kind: "text", text: "Try again" }],
      }),
    ).rejects.toThrow(
      "OpenCode request failed: prompt session (429 Too Many Requests): quota exceeded",
    );
  });

  test("sendUserMessage wraps thrown promptAsync errors", async () => {
    const mock = makeMockClient({
      promptAsyncResult: {
        mode: "throw",
        error: new Error("socket closed"),
      },
    });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    await startDefaultSession(adapter, "spec");

    await expect(
      adapter.sendUserMessage({
        ...sessionRuntimeRef("session-opencode-1"),
        parts: [{ kind: "text", text: "Try again" }],
      }),
    ).rejects.toThrow("OpenCode request failed: prompt session: socket closed");
  });
});
