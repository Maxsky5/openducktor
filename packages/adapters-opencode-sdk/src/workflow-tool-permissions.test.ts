import { describe, expect, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import { buildRoleScopedPermissionRules } from "./workflow-tool-permissions";

type PermissionRule = ReturnType<typeof buildRoleScopedPermissionRules>[number];

const findFinalExactAction = (rules: PermissionRule[], permission: string): string | null => {
  for (let index = rules.length - 1; index >= 0; index -= 1) {
    const rule = rules[index];
    if (!rule) {
      continue;
    }
    if (rule.permission === permission) {
      return rule.action;
    }
  }

  return null;
};

describe("workflow-tool-permissions", () => {
  test("builds runtime-provided read-only permission rules plus allow-specific odt permissions for spec role", () => {
    const rules = buildRoleScopedPermissionRules({
      role: "spec",
      runtimeDescriptor: OPENCODE_RUNTIME_DESCRIPTOR,
    });

    const deniedNativeTools = [
      "edit",
      "write",
      "apply_patch",
      "ast_grep_replace",
      "lsp_rename",
    ] as const;
    for (const toolName of deniedNativeTools) {
      expect(rules).toContainEqual({
        permission: toolName,
        pattern: "*",
        action: "deny",
      });
    }
    expect(rules).not.toContainEqual({ permission: "bash", pattern: "*", action: "deny" });
    expect(rules).toContainEqual({ permission: "openducktor_*", pattern: "*", action: "deny" });
    expect(rules).toContainEqual({
      permission: "functions.openducktor_*",
      pattern: "*",
      action: "deny",
    });
    expect(rules).toContainEqual({ permission: "odt_create_task", pattern: "*", action: "deny" });
    expect(rules).toContainEqual({ permission: "odt_search_tasks", pattern: "*", action: "deny" });
    expect(rules).toContainEqual({
      permission: "odt_get_workspaces",
      pattern: "*",
      action: "deny",
    });
    expect(rules).toContainEqual({
      permission: "openducktor_odt_create_task",
      pattern: "*",
      action: "deny",
    });
    expect(rules).toContainEqual({
      permission: "functions.openducktor_odt_create_task",
      pattern: "*",
      action: "deny",
    });
    expect(rules).toContainEqual({
      permission: "openducktor_odt_search_tasks",
      pattern: "*",
      action: "deny",
    });
    expect(rules).toContainEqual({
      permission: "functions.openducktor_odt_search_tasks",
      pattern: "*",
      action: "deny",
    });
    expect(rules).toContainEqual({
      permission: "openducktor_odt_get_workspaces",
      pattern: "*",
      action: "deny",
    });
    expect(rules).toContainEqual({
      permission: "functions.openducktor_odt_get_workspaces",
      pattern: "*",
      action: "deny",
    });
    expect(rules).toContainEqual({ permission: "odt_read_task", pattern: "*", action: "allow" });
    expect(rules).toContainEqual({
      permission: "odt_read_task_documents",
      pattern: "*",
      action: "allow",
    });
    expect(rules).toContainEqual({ permission: "odt_set_spec", pattern: "*", action: "allow" });
    expect(rules).toContainEqual({ permission: "odt_set_plan", pattern: "*", action: "deny" });
    expect(findFinalExactAction(rules, "functions.openducktor_odt_set_spec")).toBe("allow");
    expect(findFinalExactAction(rules, "functions.openducktor_odt_set_plan")).toBe("deny");
    expect(rules).toContainEqual({
      permission: "openducktor_odt_read_task",
      pattern: "*",
      action: "allow",
    });
    expect(rules).toContainEqual({
      permission: "openducktor_odt_read_task_documents",
      pattern: "*",
      action: "allow",
    });
    expect(rules).toContainEqual({
      permission: "functions.openducktor_odt_read_task",
      pattern: "*",
      action: "allow",
    });
    expect(rules).toContainEqual({
      permission: "functions.openducktor_odt_read_task_documents",
      pattern: "*",
      action: "allow",
    });
    expect(rules).toContainEqual({
      permission: "openducktor_odt_set_spec",
      pattern: "*",
      action: "allow",
    });
    expect(rules).toContainEqual({
      permission: "functions.openducktor_odt_set_spec",
      pattern: "*",
      action: "allow",
    });
    expect(rules).not.toContainEqual({
      permission: "openducktor_odt_set_plan",
      pattern: "*",
      action: "allow",
    });
    expect(rules).toContainEqual({
      permission: "openducktor_odt_set_plan",
      pattern: "*",
      action: "deny",
    });
    expect(rules).toContainEqual({
      permission: "functions.openducktor_odt_set_plan",
      pattern: "*",
      action: "deny",
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
      permission: "odt_build_completed",
      pattern: "*",
      action: "allow",
    });
    expect(rules).toContainEqual({
      permission: "openducktor_odt_build_completed",
      pattern: "*",
      action: "allow",
    });
    expect(rules).toContainEqual({
      permission: "functions.openducktor_odt_build_completed",
      pattern: "*",
      action: "allow",
    });
    expect(rules).toContainEqual({
      permission: "odt_qa_approved",
      pattern: "*",
      action: "deny",
    });
    expect(rules).toContainEqual({
      permission: "openducktor_odt_qa_approved",
      pattern: "*",
      action: "deny",
    });
    expect(rules).toContainEqual({
      permission: "functions.openducktor_odt_qa_approved",
      pattern: "*",
      action: "deny",
    });
    expect(rules).not.toContainEqual({
      permission: "openducktor_odt_qa_approved",
      pattern: "*",
      action: "allow",
    });
    expect(findFinalExactAction(rules, "functions.openducktor_odt_build_completed")).toBe("allow");
    expect(findFinalExactAction(rules, "functions.openducktor_odt_qa_approved")).toBe("deny");
  });
});
