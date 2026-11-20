import { describe, expect, test } from "bun:test";
import {
  LAYER_LABELS,
  QA_KICKOFF,
  QA_KICKOFF_CARD,
  QA_KICKOFF_PLACEHOLDERS,
  SECTION_LABELS,
  ROLE_PROMPTS,
  STATUS_LABELS,
  WORKFLOW_SECTION,
} from "./scenes/prompts/sample";
import { importProduct } from "./test-support/product-source";

type PromptTemplate = {
  label: string;
  ownerTitle: string;
  usage: string;
  roleIds: readonly string[];
  description: string;
  template: string;
  placeholders: readonly string[];
};
/** The compiled workflow catalog of the app. The test passes it on as it is. */
type CompiledCatalog = { roles: readonly { id: string; label: string }[] };
type PromptSettings = {
  templates: PromptTemplate[];
  roleTemplates: PromptTemplate[];
  workflows: {
    title: string;
    groups: { title: string; description: string; templates: PromptTemplate[] }[];
  }[];
};

// SAFETY: settings-modal-constants.ts exports these values, and a missing export fails the test.
const { SETTINGS_SECTIONS, WORKFLOW_PROMPTS_DESCRIPTION } = await importProduct<{
  SETTINGS_SECTIONS: readonly { label: string }[];
  WORKFLOW_PROMPTS_DESCRIPTION: string;
}>("packages/frontend/src/components/features/settings/settings-modal-constants.ts");
// SAFETY: settings-prompt-layers.ts exports these labels, and a missing export fails the test.
const { PROMPT_STATUS_LABELS } = await importProduct<{
  PROMPT_STATUS_LABELS: Record<string, string>;
}>("packages/frontend/src/components/features/settings/settings-prompt-layers.ts");
// SAFETY: prompt-layers.ts exports these labels, and a missing export fails the test.
const { PROMPT_LAYER_LABELS } = await importProduct<{
  PROMPT_LAYER_LABELS: Record<string, string>;
}>("packages/workflows/src/task-workflow/prompt-layers.ts");
// SAFETY: workflow-prompt-settings.ts exports this function, and a missing export fails the test.
const { workflowPromptSettings } = await importProduct<{
  workflowPromptSettings: (catalog: CompiledCatalog) => PromptSettings;
}>("packages/frontend-core/src/queries/workflow-prompt-settings.ts");
// SAFETY: workflow-fixtures.ts exports the compiled built-in catalog.
const { builtinCompiledCatalogFixture } = await importProduct<{
  builtinCompiledCatalogFixture: CompiledCatalog;
}>("packages/frontend-core/src/test-support/workflow-fixtures.ts");

const prompts = workflowPromptSettings(builtinCompiledCatalogFixture);

describe("settings copied from the app", () => {
  test("the section list is the list of the Settings dialog", () => {
    expect(SETTINGS_SECTIONS.map((section) => section.label)).toEqual([...SECTION_LABELS]);
  });

  test("the role instructions are the role prompts of the app", () => {
    expect(
      prompts.roleTemplates.map((template) => ({
        role: template.roleIds[0],
        description: template.description,
      })),
    ).toEqual(JSON.parse(JSON.stringify(ROLE_PROMPTS)));
  });

  test("the workflow page has the groups and rows of the app", () => {
    const [workflow] = prompts.workflows;
    expect({
      title: workflow?.title,
      description: WORKFLOW_PROMPTS_DESCRIPTION,
      groups: workflow?.groups.map((group) => ({
        title: group.title,
        description: group.description,
        rows: group.templates.map((template) => ({
          label: template.label,
          description: template.description,
          roles: template.roleIds,
        })),
      })),
    }).toEqual(JSON.parse(JSON.stringify(WORKFLOW_SECTION)));
  });

  test("the editor shows the QA Kickoff prompt of the app", () => {
    const template = prompts.templates.find((entry) => entry.label === QA_KICKOFF_CARD.label);
    if (template === undefined) throw new Error(`The app has no prompt ${QA_KICKOFF_CARD.label}.`);
    expect({
      label: template.label,
      // The back link of the editor names the workflow of the prompt.
      owner: template.ownerTitle,
      usage: template.usage,
      description: template.description,
    }).toEqual(QA_KICKOFF_CARD);
    expect(template.placeholders).toEqual([...QA_KICKOFF_PLACEHOLDERS]);
    expect(template.template).toBe(QA_KICKOFF);
  });

  test("the badges and the final text labels are the labels of the app", () => {
    expect({
      appended: PROMPT_STATUS_LABELS.appended,
    }).toEqual(STATUS_LABELS);
    expect({
      builtin: PROMPT_LAYER_LABELS.builtin,
      global_append: PROMPT_LAYER_LABELS.global_append,
    }).toEqual(LAYER_LABELS);
  });
});
