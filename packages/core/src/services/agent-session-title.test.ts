import { describe, expect, test } from "bun:test";
import {
  AGENT_REPOSITORY_SESSION_TITLE,
  agentSessionScopesEqual,
  describeAgentSessionScope,
  formatAgentSessionTitle,
  formatWorkflowAgentSessionTitle,
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
  test("formats repository and workflow titles", () => {
    expect(formatAgentSessionTitle({ kind: "repository" })).toBe(AGENT_REPOSITORY_SESSION_TITLE);
    expect(formatAgentSessionTitle({ kind: "workflow", taskId: "task-1", role: "build" })).toBe(
      "BUILD task-1",
    );
  });

  test("compares exact workflow identity and repository scope", () => {
    expect(agentSessionScopesEqual({ kind: "repository" }, { kind: "repository" })).toBe(true);
    expect(
      agentSessionScopesEqual(
        { kind: "workflow", taskId: "task-1", role: "build" },
        { kind: "workflow", taskId: "task-1", role: "build" },
      ),
    ).toBe(true);
    expect(
      agentSessionScopesEqual(
        { kind: "workflow", taskId: "task-1", role: "build" },
        { kind: "workflow", taskId: "task-2", role: "build" },
      ),
    ).toBe(false);
    expect(
      agentSessionScopesEqual(
        { kind: "workflow", taskId: "task-1", role: "build" },
        { kind: "workflow", taskId: "task-1", role: "qa" },
      ),
    ).toBe(false);
    expect(
      agentSessionScopesEqual(
        { kind: "workflow", taskId: "task-1", role: "build" },
        { kind: "repository" },
      ),
    ).toBe(false);
  });

  test("describes repository and workflow scopes", () => {
    expect(describeAgentSessionScope({ kind: "repository" })).toBe("repository scope");
    expect(describeAgentSessionScope({ kind: "workflow", taskId: "task-1", role: "qa" })).toBe(
      "workflow scope for task 'task-1' and role 'qa'",
    );
  });
});
