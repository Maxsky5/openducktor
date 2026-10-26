import { describe, expect, test } from "bun:test";
import type { AgentApprovalRequest } from "../../types/agent-orchestrator";
import {
  approvalCapabilityWarning,
  approvalOutcomeEmphasis,
  approvalOutcomeLabel,
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
