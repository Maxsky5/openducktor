import { describe, expect, test } from "bun:test";
import {
  isWorkflowAgentSessionScope,
  requireWorkflowAgentSessionScope,
  workflowAgentSessionScope,
} from "./agent-engine";

describe("agent session scope helpers", () => {
  test("constructs and narrows workflow scope", () => {
    const scope = workflowAgentSessionScope("task-1", "build");

    expect(scope).toEqual({ kind: "workflow", taskId: "task-1", role: "build" });
    expect(isWorkflowAgentSessionScope(scope)).toBe(true);
    expect(requireWorkflowAgentSessionScope(scope, "resolve runtime policy")).toBe(scope);
  });

  test("does not treat repository or unbound association as workflow scope", () => {
    expect(isWorkflowAgentSessionScope({ kind: "repository" })).toBe(false);
    expect(isWorkflowAgentSessionScope({ kind: "unbound" })).toBe(false);
  });

  test("fails clearly for repository, unbound, and missing workflow context", () => {
    expect(() =>
      requireWorkflowAgentSessionScope({ kind: "repository" }, "resolve runtime policy"),
    ).toThrow(
      "Cannot resolve runtime policy with repository session context; workflow session context is required.",
    );
    expect(() =>
      requireWorkflowAgentSessionScope({ kind: "unbound" }, "resolve runtime policy"),
    ).toThrow(
      "Cannot resolve runtime policy with unbound session context; workflow session context is required.",
    );
    expect(() => requireWorkflowAgentSessionScope(null, "resolve runtime policy")).toThrow(
      "Cannot resolve runtime policy without workflow session context.",
    );
  });
});
