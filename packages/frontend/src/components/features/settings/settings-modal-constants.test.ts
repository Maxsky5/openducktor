import { specPlanBuildPromptKey, rolePromptKey } from "@openducktor/workflows/test-support";
import { workflowSettingsData } from "@openducktor/frontend-core/queries/workflow-settings";
import { builtinCompiledCatalogFixture } from "@openducktor/frontend-core/test-support/workflow-fixtures";
import { describe, expect, test } from "bun:test";
import { countPromptErrorsByRoleTab, REPOSITORY_SECTIONS } from "./settings-modal-constants";

describe("settings-modal-constants", () => {
  test("lists the goal prompt with the shared prompts, not with a role", () => {
    const tabs = workflowSettingsData(builtinCompiledCatalogFixture).promptTabs;
    const tabsWithGoalPrompt = tabs
      .filter((tab) => tab.templates.some(({ id }) => id === "workflow.goal"))
      .map(({ id }) => id);
    expect(tabsWithGoalPrompt).toEqual(["shared"]);
  });

  test("counts validation errors per prompt role tab", () => {
    const counts = countPromptErrorsByRoleTab(
      {
        [specPlanBuildPromptKey("workflow.rules")]: "bad",
        [rolePromptKey("spec")]: "bad",
        [specPlanBuildPromptKey("messages.build_start")]: "bad",
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
