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

  test("keeps unknown runtime tools manual instead of guessing read-only", () => {
    expect(
      normalizeOpenCodeApprovalRequest({
        id: "req-unknown-tool",
        permission: "tool",
        metadata: { tool: "custom_runtime_tool" },
      })?.mutation,
    ).toBe("unknown");
  });
});
