import { describe, expect, test } from "bun:test";
import { formatAgentSessionTitle, formatWorkflowAgentSessionTitle } from "./agent-session-title";

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

describe("Agent Session scope presentation", () => {
  test("uses the repository session name from the scope", () => {
    expect(formatAgentSessionTitle({ kind: "repository", title: "My session" })).toBe("My session");
    expect(formatAgentSessionTitle({ kind: "repository" })).toBeUndefined();
    expect(formatAgentSessionTitle({ kind: "workflow", taskId: "task-1", role: "build" })).toBe(
      "BUILD task-1",
    );
  });
});
