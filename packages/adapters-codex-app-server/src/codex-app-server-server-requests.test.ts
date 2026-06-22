import { describe, expect, mock, test } from "bun:test";
import { CODEX_APP_SERVER_SERVER_REQUEST_METHOD } from "@openducktor/contracts";
import { handleCodexServerRequest } from "./codex-app-server-server-requests";
import { CodexPendingInputState } from "./codex-pending-input-state";
import type { CodexServerRequestRecord, CodexSessionState } from "./types";

const createSession = (
  role: CodexSessionState["role"],
  threadId = role ? `thread-${role}` : "thread-unknown-role",
): CodexSessionState => ({
  summary: {
    externalSessionId: threadId,
    role,
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
}: {
  events: unknown[];
  pendingInput?: CodexPendingInputState;
  respondServerRequest?: ReturnType<typeof mock>;
}) => ({
  respondServerRequest,
  pendingInput,
  activeTurnsBySessionId: new Map(),
  bindActiveTurnId: () => false,
  flushQueuedUserMessagesLater: () => {},
  emitSessionEvent: (_externalSessionId: string, event: unknown) => events.push(event),
});

const mcpToolApprovalRequest = ({
  id,
  serverName,
  toolName,
}: {
  id: number;
  serverName: string;
  toolName: string;
}): CodexServerRequestRecord => ({
  id,
  method: CODEX_APP_SERVER_SERVER_REQUEST_METHOD.MCP_SERVER_ELICITATION_REQUEST,
  params: {
    threadId: "thread-spec",
    turnId: "turn-spec",
    serverName,
    mode: "form",
    message: `Allow the ${serverName} MCP server to run tool "${toolName}"?`,
    requestedSchema: { type: "object", properties: {} },
    _meta: {
      codex_approval_kind: "mcp_tool_call",
      tool_name: toolName,
      persist: ["session"],
    },
  },
});

describe("handleCodexServerRequest", () => {
  test("rejects mutating requests when the session role is unknown", async () => {
    const respondServerRequest = mock(async () => {});
    const events: unknown[] = [];

    await expect(
      handleCodexServerRequest(
        createRequestContext({ events, respondServerRequest }),
        createSession(null),
        {
          id: 29,
          method: "approval/request",
          params: {
            threadId: "thread-unknown-role",
            turnId: "turn-unknown-role",
            tool: "network",
            url: "https://example.com",
          },
        },
        new Set(),
      ),
    ).resolves.toBe(false);

    expect(respondServerRequest).toHaveBeenCalledWith(
      "runtime-live",
      29,
      expect.objectContaining({
        approved: false,
        outcome: "reject",
        message: expect.stringContaining("session role is unknown"),
      }),
      undefined,
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "session_error",
        message: expect.stringContaining("session role is unknown"),
      }),
    );
  });

  test("does not call non-mutating unknown-role rejections mutating", async () => {
    const respondServerRequest = mock(async () => {});
    const events: unknown[] = [];

    await handleCodexServerRequest(
      createRequestContext({ events, respondServerRequest }),
      createSession(null),
      {
        id: 30,
        method: "status/check",
        params: { threadId: "thread-unknown-role", turnId: "turn-unknown-role" },
      },
      new Set(),
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "session_error",
        message: "Rejected Codex request 'status/check' because the session role is unknown.",
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
    expect(pendingInput.approval("31")?.request.tool?.name).toBe("search");
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "approval_required",
        requestId: "31",
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
    expect(pendingInput.approval("33")?.request.tool?.name).toBe("odt_set_plan");
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

    expect(pendingInput.approval("32")).toBeUndefined();
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
});
