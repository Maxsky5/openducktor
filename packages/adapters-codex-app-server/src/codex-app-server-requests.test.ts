import { describe, expect, test } from "bun:test";
import { CODEX_APP_SERVER_SERVER_REQUEST_METHOD } from "@openducktor/contracts";
import {
  codexApprovalResponseForRequest,
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
});
