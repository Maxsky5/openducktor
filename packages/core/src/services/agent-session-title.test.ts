import { describe, expect, test } from "bun:test";
import {
  agentSessionTitle,
  formatWorkflowAgentSessionTitle,
  withAgentSessionTitle,
} from "./agent-session-title";

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
  test("reads the repository title from the scope and formats a workflow title", () => {
    expect(agentSessionTitle({ kind: "repository", title: "My session" })).toBe("My session");
    expect(agentSessionTitle({ kind: "repository" })).toBeUndefined();
    expect(agentSessionTitle({ kind: "workflow", taskId: "task-1", role: "build" })).toBe(
      "BUILD task-1",
    );
  });

  test("adds the scope title to a value and leaves the value unchanged without one", () => {
    const value = { kind: "repository" } as const;
    const titled = withAgentSessionTitle(value, { kind: "repository", title: "My session" });
    expect(titled).toEqual({ kind: "repository", title: "My session" });
    expect(titled).not.toBe(value);
    expect(value).toEqual({ kind: "repository" });
    expect(withAgentSessionTitle(value, { kind: "repository" })).toBe(value);
  });
});
