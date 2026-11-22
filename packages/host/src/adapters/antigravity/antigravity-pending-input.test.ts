import { describe, expect, test } from "bun:test";
import type { CreateElicitationRequest, ToolCallUpdate } from "@agentclientprotocol/sdk/unstable";
import {
  isManagedMcpPermission,
  toAntigravityApprovalRequest,
  toAntigravityQuestionForm,
  toAntigravityQuestionResponse,
} from "./antigravity-pending-input";

const questionRequest: CreateElicitationRequest = {
  sessionId: "session-1",
  mode: "form",
  message: "Questions",
  requestedSchema: {
    type: "object",
    properties: {
      q1: {
        type: "string",
        title: "Which database?",
        oneOf: [
          { const: "1", title: "SQLite" },
          { const: "2", title: "Postgres" },
        ],
      },
      q1_other: { type: "string", title: "Other" },
      q2: {
        type: "array",
        title: "Which checks?",
        items: {
          anyOf: [
            { const: "1", title: "Lint" },
            { const: "2", title: "Tests" },
          ],
        },
      },
      q3: { type: "string", title: "Anything else?" },
    },
  },
};

describe("Antigravity questions", () => {
  test("reads each qN field as one question with its answer mode", () => {
    const form = toAntigravityQuestionForm("request-1", questionRequest);

    expect(form?.request).toEqual({
      requestId: "request-1",
      canCancel: true,
      questions: [
        {
          header: "Question 1",
          question: "Which database?",
          options: [
            { label: "SQLite", description: "", value: "1" },
            { label: "Postgres", description: "", value: "2" },
          ],
          custom: true,
        },
        {
          header: "Question 2",
          question: "Which checks?",
          options: [
            { label: "Lint", description: "", value: "1" },
            { label: "Tests", description: "", value: "2" },
          ],
          multiple: true,
        },
        { header: "Question 3", question: "Anything else?", options: [], custom: true },
      ],
    });
  });

  test("answers with the choice values and puts a custom answer in qN_other", () => {
    const form = toAntigravityQuestionForm("request-1", questionRequest);
    if (!form) throw new Error("Expected a question form.");

    expect(toAntigravityQuestionResponse(form, [["MySQL"], ["Lint", "Tests"], ["No"]])).toEqual({
      action: "accept",
      content: { q1_other: "MySQL", q2: ["1", "2"], q3: "No" },
    });
  });

  test("cancels the form for Cancel Question and skips a question with no answer", () => {
    const form = toAntigravityQuestionForm("request-1", questionRequest);
    if (!form) throw new Error("Expected a question form.");

    expect(toAntigravityQuestionResponse(form, [])).toEqual({ action: "cancel" });
    expect(toAntigravityQuestionResponse(form, [[], [], ["No"]])).toEqual({
      action: "accept",
      content: { q3: "No" },
    });
  });

  test("refuses a custom answer for a question without an Other field", () => {
    const form = toAntigravityQuestionForm("request-1", questionRequest);
    if (!form) throw new Error("Expected a question form.");

    expect(() => toAntigravityQuestionResponse(form, [[], ["Docs"]])).toThrow(
      "Question 2 accepts only its listed choices.",
    );
  });
});

describe("toAntigravityApprovalRequest", () => {
  test("shows the server, tool, and arguments of a global MCP call", () => {
    const approval = toAntigravityApprovalRequest("request-1", {
      sessionId: "session-1",
      toolCall: {
        toolCallId: "call-1",
        title: "semble.search",
        name: "call_mcp_tool",
        rawInput: { ServerName: "semble", ToolName: "search", Arguments: { query: "auth" } },
      },
      options: [
        { optionId: "allow", name: "Allow", kind: "allow_once" },
        { optionId: "deny", name: "Deny", kind: "reject_once" },
      ],
    });

    expect(approval).toMatchObject({
      requestType: "runtime_tool",
      summary: "semble: search",
      tool: { name: "semble.search", input: { query: "auth" } },
      mutation: "unknown",
      supportedReplyOutcomes: ["approve_once", "reject"],
    });
    // The ACP title names the call, so the tool keeps only its name.
    expect(approval.tool?.title).toBeUndefined();
  });
});

describe("isManagedMcpPermission", () => {
  const permission = (name: string, rawInput: ToolCallUpdate["rawInput"]) => ({
    sessionId: "session-1",
    toolCall: { toolCallId: "call-1", name, rawInput },
    options: [],
  });

  test("passes only an OpenDucktor tool of the managed session server", () => {
    expect(
      isManagedMcpPermission(permission("mcp_openducktor_session_odt_read_task", { taskId: "t" })),
    ).toBe(true);
    // A global server can have the managed server name, but it is not the session server.
    expect(
      isManagedMcpPermission(
        permission("call_mcp_tool", {
          ServerName: "openducktor_session",
          ToolName: "odt_read_task",
          Arguments: {},
        }),
      ),
    ).toBe(false);
  });
});
