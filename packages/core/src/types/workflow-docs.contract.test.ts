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
  test("transition matrix references canonical mutation tools and statuses", () => {
    const fixture = loadFixture();
    const transitionDocPath = join(
      import.meta.dir,
      "../../../../docs/task-workflow-transition-matrix.md",
    );
    const transitionDoc = readFileSync(transitionDocPath, "utf8");

    for (const status of fixture.statuses) {
      expect(transitionDoc).toContain(`\`${status}\``);
    }

    const readTools = new Set(["odt_read_task", "odt_read_task_documents"]);
    const mutationTools = fixture.tools.filter((tool) => !readTools.has(tool));
    for (const tool of mutationTools) {
      expect(transitionDoc).toContain(`\`${tool}\``);
    }

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
