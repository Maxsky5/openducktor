import { describe, expect, test } from "bun:test";
import { columnWorkflowsText } from "./kanban-column-workflows";

describe("columnWorkflowsText", () => {
  test("names the workflows that use a column", () => {
    expect(columnWorkflowsText(["Bug triage"])).toBe("Used by Bug triage");
    expect(columnWorkflowsText(["Bug triage", "Spec, Plan, Build"])).toBe(
      "Used by Bug triage and Spec, Plan, Build",
    );
    expect(columnWorkflowsText(["A", "B", "C"])).toBe("Used by A, B and C");
  });
});
