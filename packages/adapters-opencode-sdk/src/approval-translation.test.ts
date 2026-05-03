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

  test("classifies canonical and aliased mutating ODT approvals as mutating", () => {
    for (const permission of [
      "odt_set_plan",
      "openducktor_odt_set_plan",
      "functions.openducktor_odt_set_plan",
    ]) {
      expect(
        normalizeOpenCodeApprovalRequest({ id: `req-${permission}`, permission })?.mutation,
      ).toBe("mutating");
    }
  });

  test("classifies metadata ODT tool aliases before read-only auto-rejection", () => {
    expect(
      normalizeOpenCodeApprovalRequest({
        id: "req-mutation-tool",
        permission: "tool",
        metadata: { tool: "functions.openducktor_odt_set_plan" },
      })?.mutation,
    ).toBe("mutating");
    expect(
      normalizeOpenCodeApprovalRequest({
        id: "req-read-tool",
        permission: "tool",
        metadata: { tool: "functions.openducktor_odt_read_task" },
      })?.mutation,
    ).toBe("read_only");
  });

  test("classifies mutating commands for unrecognized metadata tools", () => {
    expect(
      normalizeOpenCodeApprovalRequest({
        id: "req-custom-mutating",
        permission: "tool",
        metadata: { tool: "custom_runtime_tool", command: "rm -rf /tmp" },
      })?.mutation,
    ).toBe("mutating");
  });

  test("classifies shell-like metadata tools as mutating for non-read-only commands", () => {
    expect(
      normalizeOpenCodeApprovalRequest({
        id: "req-bash-mutating",
        permission: "tool",
        metadata: { tool: "bash", command: "python build.py" },
      })?.mutation,
    ).toBe("mutating");
  });

  test("keeps unknown custom runtime tools without commands manual", () => {
    expect(
      normalizeOpenCodeApprovalRequest({
        id: "req-unknown-tool",
        permission: "tool",
        metadata: { tool: "custom_runtime_tool" },
      })?.mutation,
    ).toBe("unknown");
  });

  test("keeps quoted separators in read-only shell commands read-only", () => {
    expect(
      normalizeOpenCodeApprovalRequest({
        id: "req-safe-shell",
        permission: "shell command",
        metadata: { tool: "shell", command: `echo "a && b" && printf '%s\n' 'c; d'` },
      })?.mutation,
    ).toBe("read_only");
  });

  test("keeps escaped separators and shell OR separators in read-only commands read-only", () => {
    expect(
      normalizeOpenCodeApprovalRequest({
        id: "req-safe-shell-escaped",
        permission: "shell command",
        metadata: { tool: "shell", command: String.raw`echo a\;b || pwd` },
      })?.mutation,
    ).toBe("read_only");
  });

  test("classifies unterminated shell quotes as mutating", () => {
    expect(
      normalizeOpenCodeApprovalRequest({
        id: "req-unterminated-shell",
        permission: "shell command",
        metadata: { tool: "shell", command: `echo "safe` },
      })?.mutation,
    ).toBe("mutating");
  });
});
