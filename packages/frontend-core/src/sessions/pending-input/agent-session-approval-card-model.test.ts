import { describe, expect, test } from "bun:test";
import type { AgentApprovalRequest } from "../../types/agent-orchestrator";
import {
  approvalCapabilityWarning,
  approvalOutcomeEmphasis,
  approvalOutcomeLabel,
  approvalRejectScope,
  approvalRequestDescription,
  approvalToolInputText,
  hasApprovalRequestContent,
  resolveApprovalReplyOutcomes,
} from "./agent-session-approval-card-model";

const approval = (overrides: Partial<AgentApprovalRequest> = {}): AgentApprovalRequest => ({
  requestId: "permission-1",
  requestType: "permission_grant",
  title: "",
  ...overrides,
});

describe("approval reply outcomes", () => {
  test("keeps request order and drops outcomes that the runtime does not support", () => {
    expect(
      resolveApprovalReplyOutcomes({
        requestSupportedReplyOutcomes: ["reject", "approve_once", "approve_turn", "reject"],
        runtimeSupportedReplyOutcomes: ["approve_once", "reject"],
      }),
    ).toEqual(["reject", "approve_once"]);
    expect(
      resolveApprovalReplyOutcomes({
        requestSupportedReplyOutcomes: ["approve_once"],
        runtimeSupportedReplyOutcomes: null,
      }),
    ).toEqual([]);
  });

  test("labels each outcome and a project grant", () => {
    expect(approvalOutcomeLabel("approve_turn", approval())).toBe("Approve for turn");
    expect(approvalOutcomeLabel("approve_always", approval())).toBe("Always allow");
    expect(
      approvalOutcomeLabel(
        "approve_always",
        approval({ persistentGrant: { scope: "project", projectDirectory: "/repo" } }),
      ),
    ).toBe("Allow for project");
  });

  test("makes approve once the main action and reject destructive", () => {
    expect(approvalOutcomeEmphasis("approve_once")).toBe("primary");
    expect(approvalOutcomeEmphasis("approve_session")).toBe("secondary");
    expect(approvalOutcomeEmphasis("reject")).toBe("destructive");
  });

  test("warns only when no outcome remains", () => {
    expect(
      approvalCapabilityWarning({
        supportedOutcomes: ["reject"],
        runtimeSupportedReplyOutcomes: ["reject"],
      }),
    ).toBeNull();
    expect(
      approvalCapabilityWarning({ supportedOutcomes: [], runtimeSupportedReplyOutcomes: [] }),
    ).toBe("This runtime does not support any declared approval outcomes for this request.");
  });
});

describe("approval request content", () => {
  test("describes a request by its first non-empty field", () => {
    expect(approvalRequestDescription(approval({ command: { command: "bun test" } }))).toBe(
      "bun test",
    );
    expect(approvalRequestDescription(approval({ affectedPaths: ["src/a.ts"] }))).toBe("src/a.ts");
    expect(approvalRequestDescription(approval())).toBeUndefined();
  });

  test("shows no card for a request without content", () => {
    expect(hasApprovalRequestContent(approval())).toBe(false);
    expect(hasApprovalRequestContent(approval({ tool: { name: "edit" } }))).toBe(true);
  });

  test("shows tool input only for a request without a command", () => {
    const tool = { name: "edit", input: { path: "a.ts" } };
    expect(approvalToolInputText(approval({ tool }))).toBe('{\n  "path": "a.ts"\n}');
    expect(approvalToolInputText(approval({ tool, command: { command: "ls" } }))).toBeNull();
  });
});

describe("approval reject scope", () => {
  test("counts the other pending approvals that a reject also cancels", () => {
    const first = approval({ requestId: "permission-1", rejectGroupId: "ses:msg_1" });
    const second = approval({ requestId: "permission-2", rejectGroupId: "ses:msg_1" });
    const third = approval({ requestId: "permission-3", rejectGroupId: "ses:msg_1" });
    const otherStep = approval({ requestId: "permission-4", rejectGroupId: "ses:msg_2" });
    expect(approvalRejectScope(first, [first, otherStep])).toBeNull();
    expect(approvalRejectScope(first, [first, second, otherStep])).toBe(
      "Reject also cancels the other pending approval of this step.",
    );
    expect(approvalRejectScope(first, [first, second, third, otherStep])).toBe(
      "Reject also cancels the 2 other pending approvals of this step.",
    );
  });

  test("tells nothing for a request without a reject group", () => {
    const request = approval();
    expect(approvalRejectScope(request, [request, approval({ requestId: "permission-2" })])).toBe(
      null,
    );
  });
});
