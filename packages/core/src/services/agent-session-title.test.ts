import { describe, expect, test } from "bun:test";
import {
  agentSessionTitle,
  formatWorkflowAgentSessionTitle,
  withAgentSessionTitle,
  withoutSummaryTitle,
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

describe("withoutSummaryTitle", () => {
  const repositorySummary = {
    externalSessionId: "session-1",
    runtimeKind: "claude",
    workingDirectory: "/repo",
    title: "Fairnest",
    sessionAssociation: { kind: "repository", title: "Fairnest" },
    startedAt: "2026-09-24T10:00:00.000Z",
    status: "idle",
  } as const;

  test("removes the summary title and the repository association title", () => {
    const cleared = withoutSummaryTitle(repositorySummary);

    expect(cleared.title).toBeUndefined();
    expect(cleared.sessionAssociation).toEqual({ kind: "repository" });
    expect(cleared.externalSessionId).toBe("session-1");
  });

  test("keeps a workflow association unchanged", () => {
    const cleared = withoutSummaryTitle({
      ...repositorySummary,
      title: "BUILD task-1",
      sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
    });

    expect(cleared.title).toBeUndefined();
    expect(cleared.sessionAssociation).toEqual({
      kind: "workflow",
      taskId: "task-1",
      role: "build",
    });
  });
});
