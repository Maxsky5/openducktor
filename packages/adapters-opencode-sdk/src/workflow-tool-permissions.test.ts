import { describe, expect, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import { buildRoleScopedPermissionRules } from "./workflow-tool-permissions";

describe("workflow-tool-permissions", () => {
  test("builds runtime-provided read-only permission rules plus allow-specific odt permissions for spec role", () => {
    const rules = buildRoleScopedPermissionRules({
      role: "spec",
      runtimeDescriptor: OPENCODE_RUNTIME_DESCRIPTOR,
    });

    expect(rules).toContainEqual({ permission: "edit", pattern: "*", action: "deny" });
    expect(rules).toContainEqual({ permission: "write", pattern: "*", action: "deny" });
    expect(rules).toContainEqual({ permission: "apply_patch", pattern: "*", action: "deny" });
    expect(rules).toContainEqual({
      permission: "ast_grep_replace",
      pattern: "*",
      action: "deny",
    });
    expect(rules).toContainEqual({ permission: "lsp_rename", pattern: "*", action: "deny" });
    expect(rules).not.toContainEqual({ permission: "bash", pattern: "*", action: "deny" });
    expect(rules).toContainEqual({
      permission: "openducktor_odt_*",
      pattern: "*",
      action: "deny",
    });
    expect(rules).toContainEqual({
      permission: "openducktor_odt_read_task",
      pattern: "*",
      action: "allow",
    });
    expect(rules).toContainEqual({
      permission: "openducktor_odt_set_spec",
      pattern: "*",
      action: "allow",
    });
    expect(rules).not.toContainEqual({
      permission: "openducktor_odt_set_plan",
      pattern: "*",
      action: "allow",
    });
  });

  test("does not inject read-only native tool denies for build role", () => {
    const rules = buildRoleScopedPermissionRules({
      role: "build",
      runtimeDescriptor: OPENCODE_RUNTIME_DESCRIPTOR,
    });

    expect(rules).not.toContainEqual({ permission: "edit", pattern: "*", action: "deny" });
    expect(rules).not.toContainEqual({ permission: "write", pattern: "*", action: "deny" });
    expect(rules).not.toContainEqual({ permission: "apply_patch", pattern: "*", action: "deny" });
    expect(rules).toContainEqual({
      permission: "openducktor_odt_build_completed",
      pattern: "*",
      action: "allow",
    });
  });
});
