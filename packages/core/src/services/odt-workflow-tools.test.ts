import { describe, expect, test } from "bun:test";
import { ODT_BROWSER_TOOL_NAMES, OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import {
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
