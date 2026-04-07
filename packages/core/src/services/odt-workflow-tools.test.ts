import { describe, expect, test } from "bun:test";
import {
  buildRoleScopedOdtToolSelection,
  isOdtWorkflowMutationToolName,
  isOdtWorkflowToolName,
  normalizeOdtWorkflowToolName,
  resolveOdtWorkflowToolNameForAuthorization,
  toOdtWorkflowToolDisplayName,
} from "./odt-workflow-tools";

describe("odt workflow tools", () => {
  test("normalizes plain and namespaced tool names", () => {
    expect(normalizeOdtWorkflowToolName("odt_set_spec")).toBe("odt_set_spec");
    expect(normalizeOdtWorkflowToolName("OpenDucktor_ODT_SET_SPEC")).toBe("odt_set_spec");
    expect(normalizeOdtWorkflowToolName("  openducktor_odt_qa_rejected  ")).toBe("odt_qa_rejected");
    expect(normalizeOdtWorkflowToolName("functions.openducktor_odt_set_spec")).toBe("odt_set_spec");
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
    expect(isOdtWorkflowToolName("functions.openducktor_odt_set_plan")).toBe(true);
    expect(isOdtWorkflowToolName("customprefix_odt_set_plan")).toBe(false);
    expect(isOdtWorkflowToolName("glob")).toBe(false);
    expect(isOdtWorkflowMutationToolName("odt_set_plan")).toBe(true);
    expect(isOdtWorkflowMutationToolName("odt_read_task")).toBe(false);
    expect(isOdtWorkflowMutationToolName("odt_read_task_documents")).toBe(false);
  });

  test("resolves trusted workflow tool ids for authorization with exact case-sensitive matching", () => {
    expect(resolveOdtWorkflowToolNameForAuthorization("odt_set_spec")).toBe("odt_set_spec");
    expect(resolveOdtWorkflowToolNameForAuthorization("openducktor_odt_set_spec")).toBe(
      "odt_set_spec",
    );
    expect(resolveOdtWorkflowToolNameForAuthorization("functions.openducktor_odt_set_spec")).toBe(
      "odt_set_spec",
    );
    expect(resolveOdtWorkflowToolNameForAuthorization("openducktor_odt_set_spec_extra")).toBeNull();
    expect(resolveOdtWorkflowToolNameForAuthorization("OpenDucktor_ODT_SET_SPEC")).toBeNull();
    expect(resolveOdtWorkflowToolNameForAuthorization("odt_SET_SPEC")).toBeNull();
    expect(resolveOdtWorkflowToolNameForAuthorization("customprefix_odt_set_spec")).toBeNull();
  });

  test("builds role-scoped selection with canonical defaults", () => {
    const selection = buildRoleScopedOdtToolSelection("spec");
    expect(selection.odt_read_task).toBe(true);
    expect(selection.odt_read_task_documents).toBe(true);
    expect(selection.odt_set_spec).toBe(true);
    expect(selection.odt_set_plan).toBe(false);
    expect(selection.openducktor_odt_set_spec).toBeUndefined();
    expect(selection.openducktor_odt_build_completed).toBeUndefined();
  });

  test("applies only trusted runtime aliases to role-scoped selection", () => {
    const selection = buildRoleScopedOdtToolSelection("qa", {
      includeCanonicalDefaults: false,
      runtimeToolIds: [
        "openducktor_odt_qa_approved",
        "openducktor_odt_read_task_documents",
        "functions.openducktor_odt_qa_rejected",
        "OpenDucktor_ODT_QA_REJECTED",
        " customprefix_odt_set_spec ",
        " odt_read_task ",
        "glob",
      ],
    });
    expect(selection.openducktor_odt_qa_approved).toBe(true);
    expect(selection.openducktor_odt_read_task_documents).toBe(true);
    expect(selection["functions.openducktor_odt_qa_rejected"]).toBe(true);
    expect(selection.odt_read_task).toBe(true);
    expect(selection.OpenDucktor_ODT_QA_REJECTED).toBeUndefined();
    expect(selection.customprefix_odt_set_spec).toBeUndefined();
    expect(selection.glob).toBeUndefined();
  });

  test("formats tool display name from normalized workflow ids", () => {
    expect(toOdtWorkflowToolDisplayName("odt_set_spec")).toBe("set_spec");
    expect(toOdtWorkflowToolDisplayName("openducktor_odt_set_spec")).toBe("set_spec");
    expect(toOdtWorkflowToolDisplayName("read")).toBe("read");
  });
});
