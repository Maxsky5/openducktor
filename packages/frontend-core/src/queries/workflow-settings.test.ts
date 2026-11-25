import { describe, expect, test } from "bun:test";
import { compileWorkflowCatalog, taskWorkflowDescriptor } from "@openducktor/workflows";
import { createSharedBoardWorkflows } from "@openducktor/workflows/test-support";
import { workflowPromptSettings } from "./workflow-prompt-settings";
import { workflowSettingsData } from "./workflow-settings";

/** A host catalog with two custom workflows, where alpha has a second version. */
const catalogWithVersions = () => {
  const { alpha, beta, catalog } = createSharedBoardWorkflows();
  const alpha2 = taskWorkflowDescriptor(alpha);
  alpha2.definition.revision = 2;
  alpha2.definition.label = "alpha publishing v2";
  return {
    alpha,
    beta,
    compiled: compileWorkflowCatalog({ ...catalog, workflows: [...catalog.workflows, alpha2] }),
  };
};

describe("Settings data of custom workflows", () => {
  test("lists the latest version of each workflow and every catalog role", () => {
    const { compiled, beta } = catalogWithVersions();
    const data = workflowSettingsData(compiled);
    expect(data.latestWorkflows.map(({ reference }) => reference)).toEqual([
      { id: "alpha", revision: 2 },
      beta.reference,
    ]);
    expect(data.roles.map(({ role }) => role)).toEqual([
      "alpha_writer",
      "alpha_editor",
      "beta_writer",
      "beta_editor",
    ]);
    expect(data.workflowNotifications.map(({ kind }) => kind)).toEqual([
      "workflow.alpha.review",
      "workflow.beta.review",
    ]);
  });

  test("shows the prompts of the latest version under the workflow ID", () => {
    const { compiled } = catalogWithVersions();
    const prompts = workflowPromptSettings(compiled);
    expect(prompts.workflows.map(({ id, title }) => [id, title])).toEqual([
      ["alpha", "alpha publishing v2"],
      ["beta", "beta publishing"],
    ]);
    expect(prompts.roleTemplates.map(({ ownerTitle }) => ownerTitle)).toContain("beta Editor");
  });
});
