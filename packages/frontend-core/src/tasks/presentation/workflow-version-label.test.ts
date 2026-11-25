import { describe, expect, test } from "bun:test";
import { specPlanBuildWorkflow } from "@openducktor/workflows";
import { createReviewTaskWorkflow } from "@openducktor/workflows/test-support";
import { workflowNameAndVersion, workflowVersionLabel } from "./workflow-version-label";

describe("workflow version labels", () => {
  test("names the built-in workflow without a version number", () => {
    expect(workflowVersionLabel(specPlanBuildWorkflow)).toBe("Built-in");
    expect(workflowNameAndVersion(specPlanBuildWorkflow)).toBe(
      `${specPlanBuildWorkflow.definition.label} · Built-in`,
    );
  });

  test("names a custom workflow with its version number", () => {
    const workflow = createReviewTaskWorkflow();
    expect(workflowNameAndVersion(workflow)).toBe(
      `${workflow.definition.label} · v${workflow.reference.revision}`,
    );
  });
});
