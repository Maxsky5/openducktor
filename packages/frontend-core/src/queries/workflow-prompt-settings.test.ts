import { describe, expect, test } from "bun:test";
import { builtinCompiledCatalogFixture } from "../test-support/workflow-fixtures";
import { workflowPromptSettings } from "./workflow-prompt-settings";
import { workflowSettingsData } from "./workflow-settings";
import { NAMING_PROMPT_KEYS, NAMING_PROMPT_PLACEHOLDERS } from "@openducktor/workflows";

describe("workflowPromptSettings", () => {
  const prompts = workflowPromptSettings(builtinCompiledCatalogFixture);

  test("gives each prompt the placeholders that the prompt builder fills", () => {
    const { latestWorkflows } = workflowSettingsData(builtinCompiledCatalogFixture);
    expect(prompts.templates.length).toBeGreaterThan(0);
    for (const template of prompts.templates) {
      if (NAMING_PROMPT_KEYS.has(template.key)) {
        expect(template.placeholders).toEqual(NAMING_PROMPT_PLACEHOLDERS);
        continue;
      }
      const workflow = latestWorkflows.find(({ prompts: built }) =>
        built.templates.some(({ key }) => key === template.key),
      );
      if (!workflow) throw new Error(`No workflow builds the prompt ${template.key}.`);
      expect(template.placeholders).toEqual(workflow.prompts.placeholdersOf(template.key));
    }
  });

  test("shows each prompt once: role instructions, or one group of a workflow", () => {
    const shownKeys = [
      ...prompts.roleTemplates.map(({ key }) => key),
      ...prompts.workflows.flatMap(({ groups }) =>
        groups.flatMap(({ templates }) => templates.map(({ key }) => key)),
      ),
    ];
    expect(shownKeys.toSorted()).toEqual(prompts.templates.map(({ key }) => key).toSorted());
    const goalGroup = prompts.workflows
      .flatMap(({ groups }) => groups)
      .find(({ templates }) => templates.some(({ id }) => id === "workflow.goal"));
    expect(goalGroup?.title).toBe("Goal mode");
  });

  test("shows the naming prompts as their own section after the workflows", () => {
    const naming = prompts.workflows.at(-1);
    expect(naming?.title).toBe("Naming");
    expect(naming?.groups.flatMap(({ templates }) => templates.map(({ label }) => label))).toEqual([
      "Branch name",
      "Workspace session title",
    ]);
  });
});
