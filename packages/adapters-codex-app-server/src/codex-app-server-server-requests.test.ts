import { describe, expect, mock, test } from "bun:test";
import { type AgentRole, CODEX_APP_SERVER_SERVER_REQUEST_METHOD } from "@openducktor/contracts";
import type { AgentEvent } from "@openducktor/core";
import {
  type CodexServerRequestHandlerContext,
  handleCodexServerRequest,
} from "./codex-app-server-server-requests";
import { CodexPendingInputState } from "./codex-pending-input-state";
import { CodexSubagentLinkState } from "./codex-subagent-link-state";
import type { CodexServerRequestRecord, CodexSessionState } from "./types";
import type { JsonValue } from "@openducktor/contracts";

const createSession = (
  role: AgentRole | null,
  threadId = role ? `thread-${role}` : "thread-unknown-role",
): CodexSessionState => ({
  summary: {
    externalSessionId: threadId,
    sessionAssociation: role ? { kind: "workflow", taskId: "task-1", role } : { kind: "unbound" },
    startedAt: "2026-05-07T00:00:00.000Z",
    status: "running",
  },
  systemPrompt: "Use the repo rules.",
  role,
  runtimeId: "runtime-live",
  repoPath: "/repo",
  threadId,
  workingDirectory: "/repo",
  taskId: "task-1",
});

const createRequestContext = ({
  events,
  pendingInput = new CodexPendingInputState(),
  respondServerRequest = mock(async () => {}),
  subagents = new CodexSubagentLinkState(),
  sessions = new Map<string, CodexSessionState>(),
  activeTurnsBySessionId = new Map(),
  bindActiveTurnId = () => false,
  flushQueuedUserMessagesLater = () => {},
}: {
  events: unknown[];
  pendingInput?: CodexPendingInputState;
  respondServerRequest?: CodexServerRequestHandlerContext["respondServerRequest"];
  subagents?: CodexSubagentLinkState;
  sessions?: Map<string, CodexSessionState>;
  activeTurnsBySessionId?: CodexServerRequestHandlerContext["activeTurnsBySessionId"];
  bindActiveTurnId?: CodexServerRequestHandlerContext["bindActiveTurnId"];
  flushQueuedUserMessagesLater?: CodexServerRequestHandlerContext["flushQueuedUserMessagesLater"];
}): CodexServerRequestHandlerContext => ({
  respondServerRequest,
  pendingInput,
  activeTurnsBySessionId,
  subagents,
  sessionForThreadId: (threadId) => sessions.get(threadId),
  bindActiveTurnId,
  flushQueuedUserMessagesLater,
  emitSessionEvent: (externalSessionId: string, event: AgentEvent) =>
    events.push({
      ...(event as Record<string, JsonValue>),
      emittedExternalSessionId: externalSessionId,
    }),
  emitRetainedSessionEvent: (session, event) =>
    events.push({
      ...event,
      emittedExternalSessionId: session.threadId,
    }),
});

const mcpToolApprovalRequest = ({
  id,
  serverName,
  toolName,
  threadId = "thread-spec",
  includeToolTitle = true,
}: {
  id: number;
  serverName: string;
  toolName: string;
  threadId?: string;
  includeToolTitle?: boolean;
}): CodexServerRequestRecord => ({
  id,
  method: CODEX_APP_SERVER_SERVER_REQUEST_METHOD.MCP_SERVER_ELICITATION_REQUEST,
  params: {
    threadId,
    turnId: "turn-spec",
    serverName,
    mode: "form",
    message: `Allow the ${serverName} MCP server to run tool "${toolName}"?`,
    requestedSchema: { type: "object", properties: {} },
    _meta: {
      codex_approval_kind: "mcp_tool_call",
      ...(includeToolTitle ? { tool_title: toolName } : {}),
      persist: ["session"],
    },
  },
});

describe("handleCodexServerRequest", () => {
  test("allows Codex to replay a request after live delivery fails", async () => {
    const session = createSession("build");
    const pendingInput = new CodexPendingInputState();
    const events: unknown[] = [];
    const handledRequestKeys = new Set<string>();
    const context = createRequestContext({
      events,
      pendingInput,
      sessions: new Map([[session.threadId, session]]),
    });
    let failDelivery = true;
    context.emitSessionEvent = (externalSessionId, event) => {
      if (failDelivery) {
        throw new Error("simulated live delivery failure");
      }
      events.push({ ...event, emittedExternalSessionId: externalSessionId });
    };
    const request = mcpToolApprovalRequest({
      id: 28,
      serverName: "external",
      toolName: "odt_read_task",
      threadId: session.threadId,
    });

    await expect(
      handleCodexServerRequest(context, session, request, handledRequestKeys),
    ).rejects.toThrow("simulated live delivery failure");

    failDelivery = false;
    await expect(
      handleCodexServerRequest(context, session, request, handledRequestKeys),
    ).resolves.toBe(true);
    const pending = pendingInput.nativeRequest("runtime-live", session.threadId, 28);
    expect(pending?.kind).toBe("approval");
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "approval_required",
        requestId: pending?.entry.request.requestId,
      }),
    );
  });

  test("does not replay a request after Codex already received its response", async () => {
    const session = createSession("spec");
    const events: unknown[] = [];
    const respondServerRequest = mock(async () => {});
    const handledRequestKeys = new Set<string>();
    const context = createRequestContext({
      events,
      respondServerRequest,
      sessions: new Map([[session.threadId, session]]),
    });
    context.emitRetainedSessionEvent = () => {
      throw new Error("simulated post-response delivery failure");
    };
    const request = mcpToolApprovalRequest({
      id: 27,
      serverName: "openducktor",
      toolName: "odt_set_plan",
      threadId: session.threadId,
    });

    await expect(
      handleCodexServerRequest(context, session, request, handledRequestKeys),
    ).rejects.toThrow("simulated post-response delivery failure");
    await expect(
      handleCodexServerRequest(context, session, request, handledRequestKeys),
    ).resolves.toBe(false);

    expect(respondServerRequest).toHaveBeenCalledTimes(1);
  });

  test("surfaces command approvals when the session role is unknown", async () => {
    const respondServerRequest = mock(async () => {});
    const pendingInput = new CodexPendingInputState();
    const events: unknown[] = [];

    await expect(
      handleCodexServerRequest(
        createRequestContext({ events, pendingInput, respondServerRequest }),
        createSession(null),
        {
          id: 29,
          method: CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_COMMAND_EXECUTION_REQUEST_APPROVAL,
          params: {
            threadId: "thread-unknown-role",
            turnId: "turn-unknown-role",
            itemId: "call-1",
            startedAtMs: 1,
            command: "curl -I https://example.com",
            cwd: "/repo",
            reason: "Need network access.",
            networkApprovalContext: { host: "example.com" },
          },
        },
        new Set(),
      ),
    ).resolves.toBe(true);

    expect(respondServerRequest).not.toHaveBeenCalled();
    const pending = pendingInput.nativeRequest("runtime-live", "thread-unknown-role", 29);
    expect(pending).toMatchObject({
      kind: "approval",
      entry: {
        runtimeId: "runtime-live",
        threadId: "thread-unknown-role",
        request: {
          requestType: "command_execution",
          title: "Network access approval requested",
        },
      },
    });
    expect(pending?.entry.request.metadata).toBeUndefined();
    expect(pending?.entry.request.requestId).not.toBe("29");
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "approval_required",
        requestId: pending?.entry.request.requestId,
        requestInstanceId: pending?.entry.request.requestId,
      }),
    );
  });

  test("surfaces unknown approval-like requests when the session role is unknown", async () => {
    const respondServerRequest = mock(async () => {});
    const pendingInput = new CodexPendingInputState();
    const events: unknown[] = [];

    await handleCodexServerRequest(
      createRequestContext({ events, pendingInput, respondServerRequest }),
      createSession(null),
      {
        id: 30,
        method: "status/check",
        params: { threadId: "thread-unknown-role", turnId: "turn-unknown-role" },
      },
      new Set(),
    );

    expect(respondServerRequest).not.toHaveBeenCalled();
    const pending = pendingInput.nativeRequest("runtime-live", "thread-unknown-role", 30);
    expect(pending).toMatchObject({
      kind: "approval",
      entry: {
        request: {
          title: "Codex status/check",
        },
      },
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "approval_required",
        requestId: pending?.entry.request.requestId,
      }),
    );
  });

  test("keeps external MCP approvals user-mediated for read-only roles", async () => {
    const respondServerRequest = mock(async () => {});
    const pendingInput = new CodexPendingInputState();
    const events: unknown[] = [];

    await expect(
      handleCodexServerRequest(
        createRequestContext({ events, pendingInput, respondServerRequest }),
        createSession("spec"),
        mcpToolApprovalRequest({ id: 31, serverName: "semble", toolName: "search" }),
        new Set(),
      ),
    ).resolves.toBe(true);

    expect(respondServerRequest).not.toHaveBeenCalled();
    const pending = pendingInput.nativeRequest("runtime-live", "thread-spec", 31);
    expect(pending?.entry.request.tool?.name).toBe("search");
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "approval_required",
        requestId: pending?.entry.request.requestId,
      }),
    );
  });

  test("surfaces managed network command approvals for read-only roles", async () => {
    const respondServerRequest = mock(async () => {});
    const pendingInput = new CodexPendingInputState();
    const events: unknown[] = [];

    await expect(
      handleCodexServerRequest(
        createRequestContext({ events, pendingInput, respondServerRequest }),
        createSession("spec"),
        {
          id: "network-command-approval-1",
          method: CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_COMMAND_EXECUTION_REQUEST_APPROVAL,
          params: {
            threadId: "thread-spec",
            turnId: "turn-spec",
            itemId: "call-1",
            startedAtMs: 1,
            command: "curl -I https://example.com",
            cwd: "/repo",
            reason: "Need network access.",
            networkApprovalContext: { host: "example.com" },
          },
        },
        new Set(),
      ),
    ).resolves.toBe(true);

    expect(respondServerRequest).not.toHaveBeenCalled();
    const pending = pendingInput.nativeRequest(
      "runtime-live",
      "thread-spec",
      "network-command-approval-1",
    );
    expect(pending).toMatchObject({
      kind: "approval",
      entry: {
        runtimeId: "runtime-live",
        threadId: "thread-spec",
        request: {
          requestType: "command_execution",
          mutation: "unknown",
        },
      },
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "approval_required",
        requestId: pending?.entry.request.requestId,
        mutation: "unknown",
      }),
    );
  });

  test("does not apply OpenDucktor workflow policy to other MCP servers", async () => {
    const respondServerRequest = mock(async () => {});
    const pendingInput = new CodexPendingInputState();
    const events: unknown[] = [];

    await expect(
      handleCodexServerRequest(
        createRequestContext({ events, pendingInput, respondServerRequest }),
        createSession("spec"),
        mcpToolApprovalRequest({ id: 33, serverName: "external", toolName: "odt_set_plan" }),
        new Set(),
      ),
    ).resolves.toBe(true);

    expect(respondServerRequest).not.toHaveBeenCalled();
    expect(
      pendingInput.nativeRequest("runtime-live", "thread-spec", 33)?.entry.request.tool?.name,
    ).toBe("odt_set_plan");
  });

  test("rejects request owners that are neither the current session nor a known child route", async () => {
    const parentSession = createSession("build", "parent-thread");
    const pendingInput = new CodexPendingInputState();
    const events: unknown[] = [];

    await expect(
      handleCodexServerRequest(
        createRequestContext({ events, pendingInput }),
        parentSession,
        mcpToolApprovalRequest({
          id: 34,
          serverName: "semble",
          toolName: "search",
          threadId: "unknown-child-thread",
        }),
        new Set(),
      ),
    ).rejects.toThrow("no known session or subagent route");

    expect(pendingInput.nativeRequest("runtime-live", "unknown-child-thread", 34)).toBeUndefined();
    expect(events).toEqual([]);
  });

  test("rejects disallowed OpenDucktor workflow MCP approvals by role", async () => {
    const respondServerRequest = mock(async () => {});
    const pendingInput = new CodexPendingInputState();
    const events: unknown[] = [];

    await expect(
      handleCodexServerRequest(
        createRequestContext({ events, pendingInput, respondServerRequest }),
        createSession("spec"),
        mcpToolApprovalRequest({ id: 32, serverName: "openducktor", toolName: "odt_set_plan" }),
        new Set(),
      ),
    ).resolves.toBe(false);

    expect(pendingInput.nativeRequest("runtime-live", "thread-spec", 32)).toBeUndefined();
    expect(respondServerRequest).toHaveBeenCalledWith(
      "runtime-live",
      32,
      expect.objectContaining({ action: "decline" }),
      undefined,
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "session_error",
        message: expect.stringContaining("role 'spec' is not allowed to use odt_set_plan"),
      }),
    );
  });

  test("automatically approves OpenDucktor workflow MCP tools allowed for the bound role", async () => {
    const respondServerRequest = mock(async () => {});
    const pendingInput = new CodexPendingInputState();
    const events: unknown[] = [];

    await expect(
      handleCodexServerRequest(
        createRequestContext({ events, pendingInput, respondServerRequest }),
        createSession("build"),
        mcpToolApprovalRequest({
          id: 36,
          serverName: "openducktor",
          toolName: "odt_read_task",
          threadId: "thread-build",
        }),
        new Set(),
      ),
    ).resolves.toBe(false);

    expect(pendingInput.nativeRequest("runtime-live", "thread-build", 36)).toBeUndefined();
    expect(respondServerRequest).toHaveBeenCalledWith(
      "runtime-live",
      36,
      expect.objectContaining({ action: "accept" }),
      undefined,
    );
    expect(events).toEqual([]);
  });

  test("routes known OpenDucktor MCP tools through user approval for repository sessions", async () => {
    const respondServerRequest = mock(async () => {});
    const pendingInput = new CodexPendingInputState();
    const events: unknown[] = [];
    const repositorySession = createSession(null, "thread-repository");
    repositorySession.summary.sessionAssociation = { kind: "repository" };

    await expect(
      handleCodexServerRequest(
        createRequestContext({ events, pendingInput, respondServerRequest }),
        repositorySession,
        mcpToolApprovalRequest({
          id: 35,
          serverName: "openducktor",
          toolName: "odt_create_task",
          threadId: "thread-repository",
        }),
        new Set(),
      ),
    ).resolves.toBe(true);

    expect(pendingInput.nativeRequest("runtime-live", "thread-repository", 35)).toMatchObject({
      kind: "approval",
      entry: {
        runtimeId: "runtime-live",
        threadId: "thread-repository",
        request: { tool: { name: "odt_create_task" } },
      },
    });
    expect(respondServerRequest).not.toHaveBeenCalled();
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "approval_required",
      }),
    );
  });

  test("rejects unknown trusted OpenDucktor tool identities for repository sessions", async () => {
    const respondServerRequest = mock(async () => {});
    const pendingInput = new CodexPendingInputState();
    const events: unknown[] = [];
    const repositorySession = createSession(null, "thread-repository");
    repositorySession.summary.sessionAssociation = { kind: "repository" };

    await expect(
      handleCodexServerRequest(
        createRequestContext({ events, pendingInput, respondServerRequest }),
        repositorySession,
        mcpToolApprovalRequest({
          id: 39,
          serverName: "openducktor",
          toolName: "odt_unknown",
          threadId: "thread-repository",
        }),
        new Set(),
      ),
    ).resolves.toBe(false);

    expect(pendingInput.nativeRequest("runtime-live", "thread-repository", 39)).toBeUndefined();
    expect(respondServerRequest).toHaveBeenCalledWith(
      "runtime-live",
      39,
      expect.objectContaining({ action: "decline" }),
      undefined,
    );
  });

  test("rejects producer-shaped OpenDucktor MCP approvals without titles for retained repository sessions", async () => {
    const respondServerRequest = mock(async () => {});
    const pendingInput = new CodexPendingInputState();
    const events: unknown[] = [];
    const repositorySession = createSession(null, "thread-repository");
    repositorySession.summary.sessionAssociation = { kind: "repository" };

    await expect(
      handleCodexServerRequest(
        createRequestContext({ events, pendingInput, respondServerRequest }),
        repositorySession,
        mcpToolApprovalRequest({
          id: 37,
          serverName: "openducktor",
          toolName: "odt_read_task",
          threadId: "thread-repository",
          includeToolTitle: false,
        }),
        new Set(),
      ),
    ).resolves.toBe(false);

    expect(pendingInput.nativeRequest("runtime-live", "thread-repository", 37)).toBeUndefined();
    expect(respondServerRequest).toHaveBeenCalledWith(
      "runtime-live",
      37,
      expect.objectContaining({ action: "decline" }),
      undefined,
    );
  });

  test("rejects producer-shaped OpenDucktor MCP approvals without titles for workflow sessions", async () => {
    const respondServerRequest = mock(async () => {});
    const pendingInput = new CodexPendingInputState();
    const events: unknown[] = [];
    const session = createSession("build");

    await expect(
      handleCodexServerRequest(
        createRequestContext({ events, pendingInput, respondServerRequest }),
        session,
        mcpToolApprovalRequest({
          id: 38,
          serverName: "openducktor",
          toolName: "odt_read_task",
          threadId: session.threadId,
          includeToolTitle: false,
        }),
        new Set(),
      ),
    ).resolves.toBe(false);

    expect(pendingInput.nativeRequest("runtime-live", session.threadId, 38)).toBeUndefined();
    expect(respondServerRequest).toHaveBeenCalledWith(
      "runtime-live",
      38,
      expect.objectContaining({ action: "decline" }),
      undefined,
    );
  });

  test("mirrors child MCP approvals to the linked parent while keeping the child as owner", async () => {
    const parentSession = createSession("build", "parent-thread");
    const childSession = createSession("build", "child-thread");
    const sessions = new Map([
      [parentSession.threadId, parentSession],
      [childSession.threadId, childSession],
    ]);
    const subagents = new CodexSubagentLinkState();
    subagents.upsertLink({
      parentThreadId: "parent-thread",
      childThreadId: "child-thread",
      itemId: "spawn-1",
      status: "running",
    });
    const pendingInput = new CodexPendingInputState();
    const events: unknown[] = [];

    await expect(
      handleCodexServerRequest(
        createRequestContext({ events, pendingInput, sessions, subagents }),
        parentSession,
        mcpToolApprovalRequest({
          id: 40,
          serverName: "semble",
          toolName: "search",
          threadId: "child-thread",
        }),
        new Set(),
      ),
    ).resolves.toBe(true);

    expect(pendingInput.nativeRequest("runtime-live", "child-thread", 40)).toMatchObject({
      kind: "approval",
      entry: {
        threadId: "child-thread",
        route: {
          parentExternalSessionId: "parent-thread",
          childExternalSessionId: "child-thread",
        },
      },
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        emittedExternalSessionId: "child-thread",
        type: "approval_required",
        externalSessionId: "child-thread",
        parentExternalSessionId: "parent-thread",
        childExternalSessionId: "child-thread",
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        emittedExternalSessionId: "parent-thread",
        type: "approval_required",
        externalSessionId: "parent-thread",
        parentExternalSessionId: "parent-thread",
        childExternalSessionId: "child-thread",
      }),
    );
  });

  test("accepts child question requests when parent linkage proves the owner", async () => {
    const parentSession = createSession("build", "parent-thread");
    const sessions = new Map([[parentSession.threadId, parentSession]]);
    const subagents = new CodexSubagentLinkState();
    subagents.upsertLink({
      parentThreadId: "parent-thread",
      childThreadId: "child-thread",
      itemId: "spawn-1",
      status: "running",
    });
    const pendingInput = new CodexPendingInputState();
    const events: unknown[] = [];
    const parentActiveTurn = { session: parentSession };
    const bindActiveTurnId = mock(() => true);
    const flushQueuedUserMessagesLater = mock(() => undefined);

    await expect(
      handleCodexServerRequest(
        createRequestContext({
          events,
          pendingInput,
          sessions,
          subagents,
          activeTurnsBySessionId: new Map([[parentSession.threadId, parentActiveTurn as never]]),
          bindActiveTurnId,
          flushQueuedUserMessagesLater,
        }),
        parentSession,
        {
          id: 41,
          method: CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_TOOL_REQUEST_USER_INPUT,
          params: {
            threadId: "child-thread",
            turnId: "child-turn",
            questions: [
              {
                id: "question-item-1",
                header: "Choose",
                question: "Proceed?",
                options: ["Yes", "No"],
              },
            ],
          },
        },
        new Set(),
      ),
    ).resolves.toBe(true);

    const pending = pendingInput.nativeRequest("runtime-live", "child-thread", 41);
    expect(pending).toMatchObject({
      kind: "question",
      entry: {
        threadId: "child-thread",
        route: {
          parentExternalSessionId: "parent-thread",
          childExternalSessionId: "child-thread",
        },
      },
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        emittedExternalSessionId: "parent-thread",
        type: "question_required",
        requestInstanceId: pending?.entry.request.requestId,
        externalSessionId: "parent-thread",
        parentExternalSessionId: "parent-thread",
        childExternalSessionId: "child-thread",
      }),
    );
    expect(events).not.toContainEqual(
      expect.objectContaining({
        emittedExternalSessionId: "child-thread",
        type: "question_required",
      }),
    );
    expect(bindActiveTurnId).not.toHaveBeenCalled();
    expect(flushQueuedUserMessagesLater).not.toHaveBeenCalled();
  });

  test("scopes synthetic question tool rows to the runtime request instance", async () => {
    const request = {
      id: 41,
      method: CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_TOOL_REQUEST_USER_INPUT,
      params: {
        threadId: "thread-build",
        turnId: "turn-question",
        questions: [
          {
            id: "question-item-1",
            header: "Choose",
            question: "Proceed?",
            options: ["Yes", "No"],
          },
        ],
      },
    } satisfies CodexServerRequestRecord;
    const firstSession = createSession("build");
    firstSession.runtimeId = "runtime-one";
    const secondSession = createSession("build");
    secondSession.runtimeId = "runtime-two";
    const firstEvents: unknown[] = [];
    const secondEvents: unknown[] = [];

    await handleCodexServerRequest(
      createRequestContext({
        events: firstEvents,
        sessions: new Map([[firstSession.threadId, firstSession]]),
      }),
      firstSession,
      request,
      new Set(),
    );
    await handleCodexServerRequest(
      createRequestContext({
        events: secondEvents,
        sessions: new Map([[secondSession.threadId, secondSession]]),
      }),
      secondSession,
      request,
      new Set(),
    );

    const firstPart = firstEvents.find(
      (event) => (event as { type?: string }).type === "assistant_part",
    ) as { part: { messageId: string; partId: string; callId: string; metadata: unknown } };
    const secondPart = secondEvents.find(
      (event) => (event as { type?: string }).type === "assistant_part",
    ) as { part: { messageId: string; partId: string; callId: string; metadata: unknown } };
    expect(firstPart.part.callId).not.toBe(secondPart.part.callId);
    expect(firstPart.part.callId).not.toContain("runtime-one");
    expect(firstPart.part.callId).not.toBe("41");
    expect(firstPart.part.messageId).toBe(`codex-question-${firstPart.part.callId}`);
    expect(firstPart.part.partId).toBe(firstPart.part.messageId);
    expect(firstPart.part.metadata).not.toMatchObject({
      method: expect.anything(),
      requestId: expect.anything(),
      questionIds: expect.anything(),
      turnId: expect.anything(),
    });
  });
});
