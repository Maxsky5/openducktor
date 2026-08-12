import { describe, expect, test } from "bun:test";
import {
  ODT_MCP_TOOL_NAMES,
  OPENCODE_RUNTIME_DESCRIPTOR,
  toOpencodeExposedOdtToolIds,
} from "@openducktor/contracts";
import {
  buildRepositoryScopedPermissionRules,
  buildRoleScopedPermissionRules,
} from "./workflow-tool-permissions";

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
  test("asks for approval across the complete trusted ODT catalog for repository scope", () => {
    const rules = buildRepositoryScopedPermissionRules(OPENCODE_RUNTIME_DESCRIPTOR);

    expect(rules).toContainEqual({ permission: "openducktor_*", pattern: "*", action: "deny" });
    expect(rules).toContainEqual({
      permission: "functions.openducktor_*",
      pattern: "*",
      action: "deny",
    });
    expect(rules).toContainEqual({ permission: "task", pattern: "*", action: "allow" });
    expect(rules).not.toContainEqual({ permission: "edit", pattern: "*", action: "deny" });
    for (const toolName of ODT_MCP_TOOL_NAMES) {
      for (const permission of toOpencodeExposedOdtToolIds(toolName)) {
        expect(findFinalExactAction(rules, permission)).toBe("ask");
      }
    }
    expect(findFinalExactAction(rules, "odt_create_task")).toBe("ask");
    expect(findFinalExactAction(rules, "odt_search_tasks")).toBe("ask");
  });

  test("asks for approval for runtime-provided repository ODT aliases", () => {
    const rules = buildRepositoryScopedPermissionRules({
      ...OPENCODE_RUNTIME_DESCRIPTOR,
      workflowToolAliasesByCanonical: {
        ...OPENCODE_RUNTIME_DESCRIPTOR.workflowToolAliasesByCanonical,
        odt_set_plan: ["runtime_plan_alias"],
      },
    });

    expect(findFinalExactAction(rules, "runtime_plan_alias")).toBe("ask");
  });

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
    expect(rules).toContainEqual({ permission: "task", pattern: "*", action: "allow" });
    expect(rules).toContainEqual({ permission: "subtask", pattern: "*", action: "deny" });
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
