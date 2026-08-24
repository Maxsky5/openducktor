import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadWorkflowContractFixture } from "./workflow-contract-fixture.test-support";

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
      "Call `odt_read_task` first for the returned `task` summary object, including task state, `qaVerdict`, and document presence booleans.",
    );
    expect(transitionDoc).toContain(
      "Call `odt_read_task_documents` only when spec, implementation plan, or latest QA markdown bodies are needed.",
    );
    expect(transitionDoc).toContain(
      "collect the relevant IDs and call `odt_read_task_assets` once when their raw total is at most 20 MiB. Split only larger sets.",
    );

    expect(transitionDoc).toMatch(
      /\| `odt_set_plan` \(feature\/epic\) \| `spec_ready`, `ready_for_dev`, `in_progress`, `blocked`, `ai_review`, `human_review` \|/,
    );
    expect(transitionDoc).toMatch(
      /\| `odt_set_plan` \(task\/bug\) \| `open`, `spec_ready`, `ready_for_dev`, `in_progress`, `blocked`, `ai_review`, `human_review` \|/,
    );
  });

  test("status model examples use canonical odt sourceTool names", () => {
    const statusModelPath = join(import.meta.dir, "../../../../docs/task-workflow-status-model.md");
    const statusModelDoc = readFileSync(statusModelPath, "utf8");

    expect(statusModelDoc).toContain('"sourceTool": "odt_set_spec"');
    expect(statusModelDoc).toContain('"sourceTool": "odt_set_plan"');
    expect(statusModelDoc).toContain('"sourceTool": "odt_qa_approved"');
  });
});
