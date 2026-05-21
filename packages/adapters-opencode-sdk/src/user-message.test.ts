import { describe, expect, test } from "bun:test";
import type { AgentEvent } from "@openducktor/core";
import {
  buildQueuedSignature,
  makeMockClient,
  OpencodeSdkAdapter,
  startDefaultSession,
} from "./test-support";

describe("OpencodeSdkAdapter user message", () => {
  test("sendUserMessage forwards selected model with openducktor role-scoped tools", async () => {
    const mock = makeMockClient({});
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    await startDefaultSession(adapter, "spec");

    const events: Array<{ type: string }> = [];
    adapter.subscribeEvents("session-opencode-1", (event) =>
      events.push(event as { type: string }),
    );

    await adapter.sendUserMessage({
      externalSessionId: "session-opencode-1",
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
    adapter.subscribeEvents("session-opencode-1", (event) => events.push(event));

    await adapter.sendUserMessage({
      externalSessionId: "session-opencode-1",
      parts: [{ kind: "text", text: "Recover ids" }],
    });

    expect(events.some((event) => event.type === "assistant_part")).toBe(false);
    expect(events.some((event) => event.type === "assistant_message")).toBe(false);
    expect(events.some((event) => event.type === "session_idle")).toBe(false);
  });

  test("sendUserMessage uses the native session command endpoint for slash commands", async () => {
    const mock = makeMockClient({});
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    await startDefaultSession(adapter, "build");

    await adapter.sendUserMessage({
      externalSessionId: "session-opencode-1",
      parts: [
        {
          kind: "slash_command",
          command: {
            id: "compact",
            trigger: "compact",
            title: "compact",
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
        command: "compact",
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
    adapter.subscribeEvents("session-opencode-1", (event) => events.push(event));

    await adapter.sendUserMessage({
      externalSessionId: "session-opencode-1",
      parts: [
        {
          kind: "slash_command",
          command: {
            id: "compact",
            trigger: "compact",
            title: "compact",
            hints: [],
          },
        },
      ],
    });

    expect(events).toContainEqual({
      type: "session_status",
      externalSessionId: "session-opencode-1",
      timestamp: "2026-02-17T12:00:00Z",
      status: { type: "busy" },
    });
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
        externalSessionId: "session-opencode-1",
        parts: [
          { kind: "text", text: "before " },
          {
            kind: "slash_command",
            command: {
              id: "compact",
              trigger: "compact",
              title: "compact",
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
    adapter.subscribeEvents("session-opencode-1", (event) => events.push(event));

    await expect(
      adapter.sendUserMessage({
        externalSessionId: "session-opencode-1",
        parts: [
          {
            kind: "slash_command",
            command: {
              id: "compact",
              trigger: "compact",
              title: "compact",
              hints: [],
            },
          },
        ],
      }),
    ).rejects.toThrow("OpenCode request failed: run slash command (400 Bad Request)");

    expect(events).toContainEqual({
      type: "session_status",
      externalSessionId: "session-opencode-1",
      timestamp: "2026-02-17T12:00:00Z",
      status: { type: "busy" },
    });
    expect(events).toContainEqual({
      type: "session_idle",
      externalSessionId: "session-opencode-1",
      timestamp: "2026-02-17T12:00:00Z",
    });
  });

  test("sendUserMessage resets session activity so the next stream idle can settle the turn", async () => {
    const mock = makeMockClient({});
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    await startDefaultSession(adapter, "spec");

    const sessions = (
      adapter as unknown as {
        sessions: Map<string, { hasIdleSinceActivity: boolean }>;
      }
    ).sessions;
    const session = sessions.get("session-opencode-1");
    if (!session) {
      throw new Error("Expected adapter session record");
    }

    session.hasIdleSinceActivity = true;

    await adapter.sendUserMessage({
      externalSessionId: "session-opencode-1",
      parts: [{ kind: "text", text: "Second turn" }],
    });

    expect(session.hasIdleSinceActivity).toBe(false);
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
      externalSessionId: "session-opencode-1",
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
            hasIdleSinceActivity: boolean;
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

    session.hasIdleSinceActivity = true;
    session.activeAssistantMessageId = "msg-200";

    await adapter.sendUserMessage({
      externalSessionId: "session-opencode-1",
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
      externalSessionId: "session-opencode-1",
      parts: [
        {
          kind: "slash_command",
          command: {
            id: "compact",
            trigger: "compact",
            title: "compact",
            hints: [],
          },
        },
      ],
    });

    expect(session.activeAssistantMessageId).toBe("msg-command-assistant-1");

    await adapter.sendUserMessage({
      externalSessionId: "session-opencode-1",
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
      externalSessionId: "session-opencode-1",
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
      externalSessionId: "session-opencode-1",
      parts: [{ kind: "text", text: "First message" }],
      model: selectedModel,
    });
    await adapter.sendUserMessage({
      externalSessionId: "session-opencode-1",
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
      externalSessionId: "session-opencode-1",
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
        externalSessionId: "session-opencode-1",
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
        externalSessionId: "session-opencode-1",
        parts: [{ kind: "text", text: "Try again" }],
      }),
    ).rejects.toThrow("OpenCode request failed: prompt session: socket closed");
  });
});
