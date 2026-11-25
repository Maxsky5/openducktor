import { describe, expect, test } from "bun:test";
import { specPlanBuildWorkflow } from "@openducktor/workflows";
import { newTaskSteps } from "./new-task-steps";

const shown = (issueType: "feature" | "bug") =>
  newTaskSteps(specPlanBuildWorkflow, issueType).map(
    ({ label, roleId, optional }) => `${label}:${roleId}${optional ? ":optional" : ""}`,
  );

describe("newTaskSteps", () => {
  test("lists the steps of a new task of the type, with their roles, in workflow order", () => {
    expect(shown("feature")).toEqual(["Spec:spec", "Planner:planner", "Builder:build", "QA:qa"]);
  });

  test("marks the steps that a new task of the type can skip", () => {
    expect(shown("bug")).toEqual([
      "Spec:spec:optional",
      "Planner:planner:optional",
      "Builder:build",
      "QA:qa",
    ]);
  });
});
