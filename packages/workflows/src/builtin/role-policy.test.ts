import { describe, expect, test } from "bun:test";
import { codexRuntimeConfigSchema } from "@openducktor/contracts";
import {
  getMissingRequiredRuntimeSupportedScopes,
  isCodexSandboxModeSelectableForRole,
  resolveCodexRolePolicy,
} from "./role-policy";

describe("built-in role policy", () => {
  test("requires the workspace, task, and build scopes from runtimes", () => {
    expect(getMissingRequiredRuntimeSupportedScopes([])).toEqual(["workspace", "task", "build"]);
    expect(getMissingRequiredRuntimeSupportedScopes(["workspace", "build"])).toEqual(["task"]);
  });

  test("lets only write roles leave an inherited read-only Codex sandbox", () => {
    const config = codexRuntimeConfigSchema.parse({
      enabled: true,
      executablePath: "/bin/codex",
      defaults: {
        sandboxMode: "read-only",
        approvalPolicy: "untrusted",
        approvalsReviewer: "auto_review",
        commandNetworkAccess: true,
      },
    });

    expect(resolveCodexRolePolicy(config, "build")).toMatchObject({
      sandboxMode: "workspace-write",
      adjustmentReason:
        "Build role requires workspace-write when sandboxMode is inherited from read-only.",
    });
    for (const role of ["spec", "planner", "qa", null] as const) {
      const policy = resolveCodexRolePolicy(config, role);
      expect(policy.sandboxMode).toBe("read-only");
      expect(policy.adjustmentReason).toBeUndefined();
    }
  });

  test("hides the read-only sandbox choice only for write roles", () => {
    expect(isCodexSandboxModeSelectableForRole("build", "read-only")).toBe(false);
    expect(isCodexSandboxModeSelectableForRole("build", "workspace-write")).toBe(true);
    expect(isCodexSandboxModeSelectableForRole("qa", "read-only")).toBe(true);
  });
});
