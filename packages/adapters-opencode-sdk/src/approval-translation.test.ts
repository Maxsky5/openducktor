import { describe, expect, test } from "bun:test";
import { toOpenCodePermissionReply } from "./approval-translation";

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
});
