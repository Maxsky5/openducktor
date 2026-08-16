import { describe, expect, test } from "bun:test";
import {
  agentSessionScopesEqual,
  describeAgentSessionScope,
  resolveAgentSessionAssociationTransition,
} from "./agent-session-scope";

describe("Agent Session scope policy", () => {
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

  test("accepts initial, unbound, and matching association transitions", () => {
    expect(resolveAgentSessionAssociationTransition(undefined, { kind: "unbound" })).toEqual({
      kind: "accepted",
      association: { kind: "unbound" },
    });
    expect(
      resolveAgentSessionAssociationTransition({ kind: "unbound" }, { kind: "repository" }),
    ).toEqual({ kind: "accepted", association: { kind: "repository" } });
    expect(
      resolveAgentSessionAssociationTransition(
        { kind: "workflow", taskId: "task-1", role: "build" },
        { kind: "workflow", taskId: "task-1", role: "build" },
      ),
    ).toEqual({
      kind: "accepted",
      association: { kind: "workflow", taskId: "task-1", role: "build" },
    });
  });

  test("retains a bound association when an observation is unbound", () => {
    expect(
      resolveAgentSessionAssociationTransition({ kind: "repository" }, { kind: "unbound" }),
    ).toEqual({ kind: "accepted", association: { kind: "repository" } });
  });

  test("reports conflicting bound associations without choosing one", () => {
    expect(
      resolveAgentSessionAssociationTransition(
        { kind: "workflow", taskId: "task-1", role: "build" },
        { kind: "repository" },
      ),
    ).toEqual({
      kind: "conflict",
      previous: { kind: "workflow", taskId: "task-1", role: "build" },
      incoming: { kind: "repository" },
    });
  });
});
