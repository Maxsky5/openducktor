import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadWorkflowContractFixture } from "../../test-support/workflow-contract-fixture";

describe("workflow docs contract", () => {
  test("transition matrix references canonical workflow tools and statuses", () => {
    const fixture = loadWorkflowContractFixture();
    const transitionDocPath = join(
      import.meta.dir,
      "../../../../docs/task-workflow-transition-matrix.md",
    );
    const transitionDoc = readFileSync(transitionDocPath, "utf8");

    for (const status of fixture.statuses) {
      expect(transitionDoc).toContain(`\`${status}\``);
    }

    for (const tool of fixture.tools) {
      expect(transitionDoc).toContain(`\`${tool}\``);
    }

    expect(transitionDoc).toContain(
      "an `artifacts` metadata array of all current workflow and free artifacts",
    );
    expect(transitionDoc).toContain("| `odt_read_task_artifacts` | `taskId`, `codes`,");
    expect(transitionDoc).toContain('"codes": ["spec"]');
    expect(transitionDoc).toContain(
      "collect the relevant IDs and call `odt_read_task_assets` once when their raw total is at most 20 MiB. Split only larger sets.",
    );

    expect(transitionDoc).toMatch(
      /\| `odt_set_task_artifact`, code `plan` \(feature\) \| `spec_ready`, `ready_for_dev`, `in_progress`, `blocked`, `ai_review`, `human_review` \|/,
    );
    expect(transitionDoc).toMatch(
      /\| `odt_set_task_artifact`, code `plan` \(task\/bug\) \| `open`, `spec_ready`, `ready_for_dev`, `in_progress`, `blocked`, `ai_review`, `human_review` \|/,
    );
  });

  test("status model names the stored sourceTool values of new workflow rows", () => {
    const statusModelPath = join(import.meta.dir, "../../../../docs/task-workflow-status-model.md");
    const statusModelDoc = readFileSync(statusModelPath, "utf8");

    expect(statusModelDoc).toContain(
      "`odt_set_task_artifact` or `workflow_artifact_save` as `sourceTool`",
    );
  });
});
