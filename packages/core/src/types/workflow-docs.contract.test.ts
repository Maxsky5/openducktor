import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type WorkflowContractFixture = {
  tools: string[];
  statuses: string[];
};

const loadFixture = (): WorkflowContractFixture => {
  const fixturePath = join(
    import.meta.dir,
    "../../../../docs/contracts/workflow-contract-fixture.json",
  );
  return JSON.parse(readFileSync(fixturePath, "utf8")) as WorkflowContractFixture;
};

describe("workflow docs contract", () => {
  test("transition matrix references canonical workflow tools and statuses", () => {
    const fixture = loadFixture();
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

    expect(transitionDoc).toMatch(
      /\| `odt_set_plan` \(feature\/epic\) \| `spec_ready`, `ready_for_dev` \|/,
    );
    expect(transitionDoc).toMatch(
      /\| `odt_set_plan` \(task\/bug\) \| `open`, `spec_ready`, `ready_for_dev` \|/,
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
