import { describe, expect, test } from "bun:test";
import { ODT_BROWSER_TOOL_NAMES, OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import {
  buildRoleScopedOdtToolSelection,
  isOdtWorkflowMutationToolName,
  isOdtWorkflowToolName,
  normalizeOdtWorkflowToolName,
  resolveOdtWorkflowToolNameForAuthorization,
  toOdtWorkflowToolDisplayName,
} from "./odt-workflow-tools";

describe("odt workflow tools", () => {
  const workflowToolAliasesByCanonical = OPENCODE_RUNTIME_DESCRIPTOR.workflowToolAliasesByCanonical;

  test("normalizes canonical tool names without assuming runtime aliases", () => {
    expect(normalizeOdtWorkflowToolName("odt_set_task_artifact")).toBe("odt_set_task_artifact");
    expect(normalizeOdtWorkflowToolName("  odt_delete_task_artifact  ")).toBe(
      "odt_delete_task_artifact",
    );
    expect(normalizeOdtWorkflowToolName("OpenDucktor_ODT_SET_TASK_ARTIFACT")).toBeNull();
    expect(normalizeOdtWorkflowToolName("functions.openducktor_odt_set_task_artifact")).toBeNull();
    expect(normalizeOdtWorkflowToolName("customprefix_odt_build_completed")).toBeNull();
    expect(normalizeOdtWorkflowToolName("customprefix_odt_")).toBeNull();
    expect(normalizeOdtWorkflowToolName("customprefix_odt_build_completed_extra")).toBeNull();
    expect(normalizeOdtWorkflowToolName("ODT_")).toBeNull();
    expect(normalizeOdtWorkflowToolName("read")).toBeNull();
  });

  test("normalizes trusted runtime aliases only when runtime metadata is provided", () => {
    expect(
      normalizeOdtWorkflowToolName(
        "  openducktor_odt_delete_task_artifact  ",
        workflowToolAliasesByCanonical,
      ),
    ).toBe("odt_delete_task_artifact");
    expect(
      normalizeOdtWorkflowToolName(
        "functions.openducktor_odt_set_task_artifact",
        workflowToolAliasesByCanonical,
      ),
    ).toBe("odt_set_task_artifact");
    expect(normalizeOdtWorkflowToolName("openducktor_odt_set_task_artifact_extra")).toBeNull();
    expect(
      normalizeOdtWorkflowToolName(
        "OpenDucktor_ODT_SET_TASK_ARTIFACT",
        workflowToolAliasesByCanonical,
      ),
    ).toBeNull();
  });

  test("detects workflow tool ids", () => {
    expect(isOdtWorkflowToolName("odt_build_completed")).toBe(true);
    expect(isOdtWorkflowToolName("openducktor_odt_build_completed")).toBe(false);
    expect(isOdtWorkflowToolName("functions.openducktor_odt_build_completed")).toBe(false);
    expect(
      isOdtWorkflowToolName("openducktor_odt_build_completed", workflowToolAliasesByCanonical),
    ).toBe(true);
    expect(
      isOdtWorkflowToolName(
        "functions.openducktor_odt_build_completed",
        workflowToolAliasesByCanonical,
      ),
    ).toBe(true);
    expect(isOdtWorkflowToolName("customprefix_odt_build_completed")).toBe(false);
    expect(isOdtWorkflowToolName("glob")).toBe(false);
    expect(isOdtWorkflowMutationToolName("odt_build_completed")).toBe(true);
    expect(isOdtWorkflowMutationToolName("odt_read_task")).toBe(false);
    expect(isOdtWorkflowMutationToolName("odt_read_task_assets")).toBe(false);
    expect(isOdtWorkflowMutationToolName("odt_read_task_artifacts")).toBe(false);
    expect(isOdtWorkflowMutationToolName("odt_search_tasks")).toBe(false);
    expect(isOdtWorkflowMutationToolName("odt_create_task")).toBe(true);
    expect(isOdtWorkflowMutationToolName("odt_update_task")).toBe(true);
  });

  test("keeps browser tools out of the workflow mutation set", () => {
    for (const toolName of ODT_BROWSER_TOOL_NAMES) {
      expect(isOdtWorkflowMutationToolName(toolName)).toBe(false);
      expect(isOdtWorkflowToolName(toolName)).toBe(true);
    }
  });

  test("grants free artifact access to every role without granting other workflow actions", () => {
    for (const role of ["spec", "planner", "build", "qa"] as const) {
      const selection = buildRoleScopedOdtToolSelection(role, { workflowToolAliasesByCanonical });
      for (const tool of [
        "odt_read_task_artifacts",
        "odt_set_task_artifact",
        "odt_delete_task_artifact",
      ]) {
        expect(selection[tool]).toBe(true);
        expect(selection[`openducktor_${tool}`]).toBe(true);
      }
      expect(selection.odt_build_completed).toBe(role === "build");
    }
  });

  test("grants browser tools to every role, with runtime aliases", () => {
    for (const role of ["spec", "planner", "build", "qa"] as const) {
      const selection = buildRoleScopedOdtToolSelection(role, { workflowToolAliasesByCanonical });
      for (const toolName of ODT_BROWSER_TOOL_NAMES) {
        expect(selection[toolName]).toBe(true);
        expect(selection[`openducktor_${toolName}`]).toBe(true);
        expect(selection[`functions.openducktor_${toolName}`]).toBe(true);
      }
    }
  });

  test("resolves trusted workflow tool ids for authorization with exact case-sensitive matching", () => {
    expect(resolveOdtWorkflowToolNameForAuthorization("odt_set_task_artifact")).toBe(
      "odt_set_task_artifact",
    );
    expect(
      resolveOdtWorkflowToolNameForAuthorization("openducktor_odt_set_task_artifact"),
    ).toBeNull();
    expect(
      resolveOdtWorkflowToolNameForAuthorization(
        "openducktor_odt_set_task_artifact",
        workflowToolAliasesByCanonical,
      ),
    ).toBe("odt_set_task_artifact");
    expect(
      resolveOdtWorkflowToolNameForAuthorization(
        "functions.openducktor_odt_set_task_artifact",
        workflowToolAliasesByCanonical,
      ),
    ).toBe("odt_set_task_artifact");
    expect(
      resolveOdtWorkflowToolNameForAuthorization("openducktor_odt_set_task_artifact_extra"),
    ).toBeNull();
    expect(
      resolveOdtWorkflowToolNameForAuthorization("OpenDucktor_ODT_SET_TASK_ARTIFACT"),
    ).toBeNull();
    expect(resolveOdtWorkflowToolNameForAuthorization("odt_SET_TASK_ARTIFACT")).toBeNull();
    expect(
      resolveOdtWorkflowToolNameForAuthorization("customprefix_odt_set_task_artifact"),
    ).toBeNull();
  });

  test("builds role-scoped selection with canonical defaults", () => {
    const selection = buildRoleScopedOdtToolSelection("spec");
    expect(selection.odt_read_task).toBe(true);
    expect(selection.odt_read_task_assets).toBe(true);
    expect(selection.odt_read_task_artifacts).toBe(true);
    expect(selection.odt_search_tasks).toBe(true);
    expect(selection.odt_create_task).toBe(true);
    expect(selection.odt_set_task_artifact).toBe(true);
    expect(selection.odt_build_completed).toBe(false);
    expect(selection.openducktor_odt_set_task_artifact).toBeUndefined();
    expect(selection.openducktor_odt_build_completed).toBeUndefined();
  });

  test("builds role-scoped selection with trusted aliases when metadata is provided", () => {
    const selection = buildRoleScopedOdtToolSelection("planner", {
      workflowToolAliasesByCanonical,
    });

    for (const tool of [
      "odt_read_task",
      "odt_read_task_assets",
      "odt_search_tasks",
      "odt_create_task",
      "odt_set_task_artifact",
    ]) {
      expect(selection[tool]).toBe(true);
      expect(selection[`openducktor_${tool}`]).toBe(true);
      expect(selection[`functions.openducktor_${tool}`]).toBe(true);
    }
    expect(selection.odt_build_completed).toBe(false);
    expect(selection.openducktor_odt_build_completed).toBe(false);
    expect(selection["functions.openducktor_odt_build_completed"]).toBe(false);
  });

  test("applies only trusted runtime aliases to role-scoped selection", () => {
    const selection = buildRoleScopedOdtToolSelection("qa", {
      includeCanonicalDefaults: false,
      runtimeToolIds: [
        "openducktor_odt_set_task_artifact",
        "openducktor_odt_read_task_artifacts",
        "functions.openducktor_odt_delete_task_artifact",
        "OpenDucktor_ODT_DELETE_TASK_ARTIFACT",
        " customprefix_odt_set_task_artifact ",
        " odt_read_task ",
        "glob",
      ],
      workflowToolAliasesByCanonical,
    });
    expect(selection.openducktor_odt_set_task_artifact).toBe(true);
    expect(selection.openducktor_odt_read_task_artifacts).toBe(true);
    expect(selection["functions.openducktor_odt_delete_task_artifact"]).toBe(true);
    expect(selection.odt_read_task).toBe(true);
    expect(selection.OpenDucktor_ODT_DELETE_TASK_ARTIFACT).toBeUndefined();
    expect(selection.customprefix_odt_set_task_artifact).toBeUndefined();
    expect(selection.glob).toBeUndefined();
  });

  test("formats tool display name from normalized workflow ids", () => {
    expect(toOdtWorkflowToolDisplayName("odt_set_task_artifact")).toBe("set_task_artifact");
    expect(toOdtWorkflowToolDisplayName("openducktor_odt_set_task_artifact")).toBe(
      "openducktor_odt_set_task_artifact",
    );
    expect(
      toOdtWorkflowToolDisplayName(
        "openducktor_odt_set_task_artifact",
        workflowToolAliasesByCanonical,
      ),
    ).toBe("set_task_artifact");
    expect(toOdtWorkflowToolDisplayName("read")).toBe("read");
  });
});
