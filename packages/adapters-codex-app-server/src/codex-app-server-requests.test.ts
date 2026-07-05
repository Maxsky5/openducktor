import { describe, expect, test } from "bun:test";
import { CODEX_APP_SERVER_SERVER_REQUEST_METHOD } from "@openducktor/contracts";
import { codexServerRequestKey } from "./codex-app-server-approvals";
import {
  classifyCodexRequestMutation,
  codexApprovalResponseForRequest,
  extractThreadIdFromParams,
  parseNotificationRecord,
  parseQuestionRequest,
  parseServerRequestRecord,
  toApprovalRequest,
  toMcpElicitationApprovalRequest,
} from "./codex-app-server-requests";

const codexMcpToolApprovalRequest = (persist: unknown) => ({
  id: 7,
  method: CODEX_APP_SERVER_SERVER_REQUEST_METHOD.MCP_SERVER_ELICITATION_REQUEST,
  params: {
    threadId: "thread-1",
    turnId: "turn-1",
    serverName: "semble",
    mode: "form" as const,
    message: 'Allow the semble MCP server to run tool "search"?',
    requestedSchema: { type: "object", properties: {} },
    _meta: {
      codex_approval_kind: "mcp_tool_call",
      tool_name: "search",
      persist,
    },
  },
});

describe("Codex App Server request parsing", () => {
  test("preserves string request ids from the Codex protocol", () => {
    expect(
      parseServerRequestRecord({
        id: "permission-request-1",
        method: CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_PERMISSIONS_REQUEST_APPROVAL,
        params: { threadId: "thread-1" },
      }),
    ).toEqual({
      id: "permission-request-1",
      method: CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_PERMISSIONS_REQUEST_APPROVAL,
      params: { threadId: "thread-1" },
    });
  });

  test("keeps numeric string request ids distinct from numeric request ids", () => {
    const numericApproval = toApprovalRequest({
      id: 53,
      method: CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_COMMAND_EXECUTION_REQUEST_APPROVAL,
      params: { threadId: "thread-1", turnId: "turn-1" },
    });
    const stringApproval = toApprovalRequest({
      id: "53",
      method: CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_COMMAND_EXECUTION_REQUEST_APPROVAL,
      params: { threadId: "thread-1", turnId: "turn-1" },
    });
    const stringQuestion = parseQuestionRequest({
      id: "53",
      method: CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_TOOL_REQUEST_USER_INPUT,
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        questions: [
          {
            id: "question-1",
            header: "Proceed",
            question: "Continue?",
            options: ["Yes", "No"],
          },
        ],
      },
    });

    expect(numericApproval.requestId).toBe(codexServerRequestKey(53));
    expect(stringApproval.requestId).toBe(codexServerRequestKey("53"));
    expect(stringQuestion.request.requestId).toBe(codexServerRequestKey("53"));
    expect(numericApproval.requestId).not.toBe(stringApproval.requestId);
  });

  test("extracts legacy conversation ids as thread identifiers", () => {
    expect(extractThreadIdFromParams({ conversationId: "thread-legacy" })).toBe("thread-legacy");
  });
});

describe("Codex MCP approval requests", () => {
  test("exposes session and always outcomes when Codex advertises both persist modes", () => {
    const approval = toMcpElicitationApprovalRequest(
      codexMcpToolApprovalRequest(["session", "always"]),
    );

    expect(approval).toMatchObject({
      requestId: "7",
      requestType: "runtime_tool",
      supportedReplyOutcomes: ["approve_once", "approve_session", "approve_always", "reject"],
      tool: { name: "search", title: "search" },
    });
  });

  test("exposes only the matching persistent outcome for a string persist mode", () => {
    const approval = toMcpElicitationApprovalRequest(codexMcpToolApprovalRequest("session"));

    expect(approval?.supportedReplyOutcomes).toEqual(["approve_once", "approve_session", "reject"]);
  });

  test("maps persistent MCP approval outcomes to Codex elicitation response metadata", () => {
    const request = codexMcpToolApprovalRequest(["session", "always"]);

    expect(
      codexApprovalResponseForRequest({
        outcome: "approve_session",
        request,
      }),
    ).toEqual({ action: "accept", content: null, _meta: { persist: "session" } });
    expect(
      codexApprovalResponseForRequest({
        outcome: "approve_always",
        request,
      }),
    ).toEqual({ action: "accept", content: null, _meta: { persist: "always" } });
  });

  test("maps persistent command approvals to Codex session approval decisions", () => {
    const commandRequest = {
      id: 11,
      method: CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_COMMAND_EXECUTION_REQUEST_APPROVAL,
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "item-1",
        startedAtMs: 1,
      },
    };
    const legacyCommandRequest = {
      id: 12,
      method: CODEX_APP_SERVER_SERVER_REQUEST_METHOD.EXEC_COMMAND_APPROVAL,
      params: {
        conversationId: "thread-1",
        callId: "call-1",
        approvalId: null,
        command: ["true"],
        cwd: "/repo",
        reason: null,
        parsedCmd: [],
      },
    };

    expect(
      codexApprovalResponseForRequest({
        outcome: "approve_session",
        request: commandRequest,
      }),
    ).toEqual({ decision: "acceptForSession" });
    expect(
      codexApprovalResponseForRequest({
        outcome: "approve_session",
        request: legacyCommandRequest,
      }),
    ).toEqual({ decision: "approved_for_session" });
  });

  test("exposes session approvals for Codex command decisions that support them", () => {
    const approval = toApprovalRequest(
      {
        id: 15,
        method: CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_COMMAND_EXECUTION_REQUEST_APPROVAL,
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "item-1",
          startedAtMs: 1,
          availableDecisions: ["accept", "acceptForSession", "cancel"],
        },
      },
      "build",
    );

    expect(approval.supportedReplyOutcomes).toEqual(["approve_once", "approve_session", "reject"]);
  });

  test("exposes session approvals for file and permission approval requests", () => {
    const fileApproval = toApprovalRequest(
      {
        id: 16,
        method: CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_FILE_CHANGE_REQUEST_APPROVAL,
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "item-1",
          startedAtMs: 1,
          reason: "Allow this edit?",
        },
      },
      "build",
    );
    const permissionApproval = toApprovalRequest(
      {
        id: 17,
        method: CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_PERMISSIONS_REQUEST_APPROVAL,
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "item-1",
          startedAtMs: 1,
          cwd: "/repo",
          reason: "Allow network?",
          permissions: {
            network: { enabled: true },
            fileSystem: null,
          },
        },
      },
      "build",
    );

    expect(fileApproval.supportedReplyOutcomes).toEqual([
      "approve_once",
      "approve_session",
      "reject",
    ]);
    expect(permissionApproval.supportedReplyOutcomes).toEqual([
      "approve_once",
      "approve_session",
      "reject",
    ]);
    expect(
      codexApprovalResponseForRequest({
        outcome: "approve_session",
        request: {
          id: 16,
          method: CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_FILE_CHANGE_REQUEST_APPROVAL,
        },
      }),
    ).toEqual({ decision: "acceptForSession" });
  });

  test("projects structured network command approvals as network access requests", () => {
    const request = {
      id: "network-request-1",
      method: CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_COMMAND_EXECUTION_REQUEST_APPROVAL,
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "item-1",
        startedAtMs: 1,
        reason: "Allow a shell network check?",
        networkApprovalContext: { host: "example.com" },
      },
    };

    expect(toApprovalRequest(request, "build")).toMatchObject({
      requestId: "network-request-1",
      requestType: "command_execution",
      title: "Network access approval requested",
      summary: "Allow a shell network check?",
      action: { name: "Network access" },
      mutation: "unknown",
    });
    expect(
      classifyCodexRequestMutation({
        ...request,
        params: {
          ...request.params,
          commandActions: [],
        },
      }),
    ).toBe("unknown");
  });

  test("classifies unparsed command approvals as mutating", () => {
    expect(
      classifyCodexRequestMutation({
        id: 13,
        method: CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_COMMAND_EXECUTION_REQUEST_APPROVAL,
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "item-1",
          startedAtMs: 1,
          commandActions: [],
        },
      }),
    ).toBe("mutating");
  });

  test("classifies known read-only command approvals as read-only", () => {
    expect(
      classifyCodexRequestMutation({
        id: 14,
        method: CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_COMMAND_EXECUTION_REQUEST_APPROVAL,
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "item-1",
          startedAtMs: 1,
          commandActions: [
            {
              type: "read",
              command: "Get-Content README.md",
              name: "README.md",
              path: "README.md",
            },
          ],
        },
      }),
    ).toBe("read_only");
  });

  test("rejects approval requests without a request id", () => {
    expect(() =>
      toApprovalRequest(
        {
          method: CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_COMMAND_EXECUTION_REQUEST_APPROVAL,
          params: {},
        },
        "spec",
      ),
    ).toThrow("Codex app-server approval request is missing an id.");
  });
});

describe("Codex App Server notification parsing", () => {
  test("preserves receivedAt when reparsing materialized notification records", () => {
    expect(
      parseNotificationRecord({
        method: "thread/tokenUsage/updated",
        params: { threadId: "thread-1" },
        receivedAt: "2026-06-23T10:00:00.000Z",
      }),
    ).toEqual({
      method: "thread/tokenUsage/updated",
      params: { threadId: "thread-1" },
      receivedAt: "2026-06-23T10:00:00.000Z",
    });
  });

  test("uses an explicit receivedAt argument when provided", () => {
    expect(
      parseNotificationRecord(
        {
          method: "thread/tokenUsage/updated",
          receivedAt: "2026-06-23T10:00:00.000Z",
        },
        "2026-06-23T10:00:01.000Z",
      ).receivedAt,
    ).toBe("2026-06-23T10:00:01.000Z");
  });
});
