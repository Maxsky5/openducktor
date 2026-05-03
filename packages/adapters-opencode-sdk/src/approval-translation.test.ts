import { describe, expect, test } from "bun:test";
import {
  normalizeOpenCodeApprovalRequest,
  toOpenCodePermissionReply,
} from "./approval-translation";

describe("OpenCode approval translation", () => {
  test("maps runtime-neutral outcomes to OpenCode permission replies", () => {
    expect(toOpenCodePermissionReply("approve_once")).toBe("once");
    expect(toOpenCodePermissionReply("approve_session")).toBe("always");
    expect(toOpenCodePermissionReply("reject")).toBe("reject");
  });

  test("fails explicitly for unsupported turn-scoped approvals", () => {
    expect(() => toOpenCodePermissionReply("approve_turn")).toThrow(
      "OpenCode runtime does not support approval outcome 'approve_turn'. Supported outcomes: approve_once, approve_session, reject.",
    );
  });

  test("normalizes an OpenCode permission request into a neutral approval request", () => {
    const request = normalizeOpenCodeApprovalRequest({
      id: "req-shell",
      permission: "tool",
      patterns: ["src/app.ts"],
      metadata: {
        tool: "bash",
        command: "python build.py",
        workingDirectory: "/repo",
      },
    });

    expect(request).toMatchObject({
      requestId: "req-shell",
      requestType: "runtime_tool",
      title: "Approve runtime tool: bash",
      affectedPaths: ["src/app.ts"],
      command: { command: "python build.py", workingDirectory: "/repo" },
      action: { name: "tool" },
      tool: { name: "bash" },
      mutation: "mutating",
      supportedReplyOutcomes: ["approve_once", "approve_session", "reject"],
      metadata: {
        opencode: {
          permission: "tool",
          patterns: ["src/app.ts"],
          metadata: {
            tool: "bash",
            command: "python build.py",
            workingDirectory: "/repo",
          },
        },
      },
    });
  });
});
