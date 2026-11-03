import { workflowSettingsData } from "@openducktor/frontend-core/queries/workflow-settings";
import { builtinCompiledCatalogFixture } from "@openducktor/frontend-core/test-support/workflow-fixtures";
import { describe, expect, test } from "bun:test";
import { countPromptErrorsByRoleTab, REPOSITORY_SECTIONS } from "./settings-modal-constants";

describe("settings-modal-constants", () => {
  test("counts validation errors per prompt role tab", () => {
    const counts = countPromptErrorsByRoleTab(
      {
        "system.shared.workflow_guards": "bad",
        "system.role.spec.base": "bad",
        "kickoff.build_implementation_start": "bad",
      },
      workflowSettingsData(builtinCompiledCatalogFixture).promptTabs,
    );

    expect(
      Object.fromEntries(
        Object.entries(counts).map(([id, count]) => [id.split(":").at(-1), count]),
      ),
    ).toEqual({
      shared: 1,
      spec: 1,
      planner: 0,
      build: 1,
      qa: 0,
    });
  });

  test("lists Scripts directly after repository Configuration", () => {
    expect(REPOSITORY_SECTIONS.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: "configuration", label: "Configuration" },
      { id: "scripts", label: "Scripts" },
      { id: "git", label: "Git" },
      { id: "agents", label: "Agents" },
      { id: "prompts", label: "Repository prompts" },
    ]);
  });
});
