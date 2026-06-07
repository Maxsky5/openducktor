import { describe, expect, test } from "bun:test";
import { formatWorkflowAgentSessionTitle } from "./agent-session-title";

describe("formatWorkflowAgentSessionTitle", () => {
  test("formats workflow session titles from role and task id", () => {
    expect(formatWorkflowAgentSessionTitle("build", "task-1")).toBe("BUILD task-1");
  });

  test("formats every workflow role", () => {
    expect(formatWorkflowAgentSessionTitle("spec", "task-2")).toBe("SPEC task-2");
    expect(formatWorkflowAgentSessionTitle("planner", "task-3")).toBe("PLANNER task-3");
    expect(formatWorkflowAgentSessionTitle("qa", "task-4")).toBe("QA task-4");
  });

  test("preserves caller-provided task id text", () => {
    expect(formatWorkflowAgentSessionTitle("build", "")).toBe("BUILD ");
    expect(formatWorkflowAgentSessionTitle("build", "task-!@#")).toBe("BUILD task-!@#");
  });
});
