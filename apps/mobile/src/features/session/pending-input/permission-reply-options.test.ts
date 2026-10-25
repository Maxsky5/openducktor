import { describe, expect, test } from "bun:test";
import type { AgentApprovalRequest } from "@openducktor/frontend-core/types/agent-orchestrator";
import { approvalMutationLabel, buildPermissionReplyOptions } from "./permission-reply-options";

const approval = (overrides: Partial<AgentApprovalRequest> = {}): AgentApprovalRequest => ({
  requestId: "permission-1",
  requestType: "permission_grant",
  title: "Run tests",
  supportedReplyOutcomes: ["approve_once", "approve_session", "approve_always", "reject"],
  ...overrides,
});

describe("buildPermissionReplyOptions", () => {
  test("offers only the replies that the request and the runtime both support", () => {
    const { options, warning } = buildPermissionReplyOptions(approval(), [
      "approve_once",
      "approve_always",
      "reject",
    ]);
    expect(options).toEqual([
      { outcome: "approve_once", label: "Approve once", variant: "default" },
      { outcome: "approve_always", label: "Always allow", variant: "outline" },
      { outcome: "reject", label: "Reject", variant: "destructive" },
    ]);
    expect(warning).toBeNull();
  });

  test("uses the runtime replies when the request names none", () => {
    const { options } = buildPermissionReplyOptions(
      approval({ supportedReplyOutcomes: undefined }),
      ["approve_session", "reject"],
    );
    expect(options.map((option) => option.label)).toEqual(["Approve for session", "Reject"]);
  });

  test("names a project grant as Allow for project", () => {
    const { options } = buildPermissionReplyOptions(
      approval({ persistentGrant: { scope: "project", projectDirectory: "/repo" } }),
      ["approve_always"],
    );
    expect(options[0]?.label).toBe("Allow for project");
  });

  test("explains a request without a supported reply", () => {
    expect(buildPermissionReplyOptions(approval(), ["approve_turn"]).warning).toBe(
      "This runtime does not support any declared approval outcomes for this request.",
    );
    const unknownRuntime = buildPermissionReplyOptions(approval(), null);
    expect(unknownRuntime.options).toEqual([]);
    expect(unknownRuntime.warning).toContain("Runtime approval capabilities are unavailable");
  });

  test("labels what the operation can change", () => {
    expect(approvalMutationLabel("read_only")).toBe("Read only");
    expect(approvalMutationLabel("mutating")).toBe("Can change files or state");
    expect(approvalMutationLabel(undefined)).toBeNull();
  });
});
