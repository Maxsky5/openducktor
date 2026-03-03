import { describe, expect, test } from "bun:test";
import {
  buildRoleScopedOdtToolSelection,
  isOdtWorkflowMutationToolName,
  isOdtWorkflowToolName,
  normalizeOdtWorkflowToolName,
  toOdtWorkflowToolDisplayName,
} from "./odt-workflow-tools";

describe("odt workflow tools", () => {
  test("normalizes plain and namespaced tool names", () => {
    expect(normalizeOdtWorkflowToolName("odt_set_spec")).toBe("odt_set_spec");
    expect(normalizeOdtWorkflowToolName("OpenDucktor_ODT_SET_SPEC")).toBe("odt_set_spec");
    expect(normalizeOdtWorkflowToolName("  openducktor_odt_qa_rejected  ")).toBe("odt_qa_rejected");
    expect(normalizeOdtWorkflowToolName("customprefix_odt_set_plan")).toBeNull();
    expect(normalizeOdtWorkflowToolName("customprefix_odt_")).toBeNull();
    expect(normalizeOdtWorkflowToolName("customprefix_odt_set_plan_extra")).toBeNull();
    expect(normalizeOdtWorkflowToolName("ODT_")).toBeNull();
    expect(normalizeOdtWorkflowToolName("read")).toBeNull();
    expect(normalizeOdtWorkflowToolName("openducktor_odt_set_spec_extra")).toBeNull();
  });

  test("detects workflow tool ids", () => {
    expect(isOdtWorkflowToolName("odt_set_plan")).toBe(true);
    expect(isOdtWorkflowToolName("openducktor_odt_set_plan")).toBe(true);
    expect(isOdtWorkflowToolName("customprefix_odt_set_plan")).toBe(false);
    expect(isOdtWorkflowToolName("glob")).toBe(false);
    expect(isOdtWorkflowMutationToolName("odt_set_plan")).toBe(true);
    expect(isOdtWorkflowMutationToolName("odt_read_task")).toBe(false);
  });

  test("builds role-scoped selection with plain and namespaced aliases", () => {
    const selection = buildRoleScopedOdtToolSelection("spec");
    expect(selection.odt_read_task).toBe(true);
    expect(selection.odt_set_spec).toBe(true);
    expect(selection.odt_set_plan).toBe(false);
    expect(selection.openducktor_odt_set_spec).toBe(true);
    expect(selection.openducktor_odt_build_completed).toBe(false);
  });

  test("applies only trusted runtime aliases to role-scoped selection", () => {
    const selection = buildRoleScopedOdtToolSelection("qa", {
      runtimeToolIds: [
        "openducktor_odt_qa_approved",
        " customprefix_odt_set_spec ",
        " odt_read_task ",
        "glob",
      ],
    });
    expect(selection.openducktor_odt_qa_approved).toBe(true);
    expect(selection.odt_read_task).toBe(true);
    expect(selection.customprefix_odt_set_spec).toBeUndefined();
    expect(selection.glob).toBeUndefined();
  });

  test("formats tool display name from normalized workflow ids", () => {
    expect(toOdtWorkflowToolDisplayName("odt_set_spec")).toBe("set_spec");
    expect(toOdtWorkflowToolDisplayName("openducktor_odt_set_spec")).toBe("set_spec");
    expect(toOdtWorkflowToolDisplayName("read")).toBe("read");
  });
});
