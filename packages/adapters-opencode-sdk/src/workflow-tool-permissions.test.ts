import { describe, expect, test } from "bun:test";
import { buildRoleScopedOdtPermissionRules } from "./workflow-tool-permissions";

describe("workflow-tool-permissions", () => {
  test("builds deny-first, allow-specific permissions for spec role", () => {
    const rules = buildRoleScopedOdtPermissionRules("spec");

    expect(rules[0]).toEqual({ permission: "openducktor_odt_*", pattern: "*", action: "deny" });

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
});
