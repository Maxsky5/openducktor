import { describe, expect, test } from "bun:test";
import {
  agentSessionScopesEqual,
  describeAgentSessionScope,
  resolveAgentSessionAssociationTransition,
} from "./agent-session-scope";

describe("Agent Session scope policy", () => {
  test("compares exact workflow identity and repository scope", () => {
    expect(
      agentSessionScopesEqual(
        { kind: "repository", workspaceId: "repo" },
        { kind: "repository", workspaceId: "repo" },
      ),
    ).toBe(true);
    expect(
      agentSessionScopesEqual(
        { kind: "workflow", workspaceId: "repo", taskId: "task-1", role: "build" },
        { kind: "workflow", workspaceId: "repo", taskId: "task-1", role: "build" },
      ),
    ).toBe(true);
    expect(
      agentSessionScopesEqual(
        { kind: "workflow", workspaceId: "repo", taskId: "task-1", role: "build" },
        { kind: "workflow", workspaceId: "repo", taskId: "task-2", role: "build" },
      ),
    ).toBe(false);
    expect(
      agentSessionScopesEqual(
        { kind: "workflow", workspaceId: "repo", taskId: "task-1", role: "build" },
        { kind: "repository", workspaceId: "repo" },
      ),
    ).toBe(false);
  });

  test("describes repository and workflow scopes", () => {
    expect(describeAgentSessionScope({ kind: "repository", workspaceId: "repo" })).toBe(
      "repository scope",
    );
    expect(
      describeAgentSessionScope({
        kind: "workflow",
        workspaceId: "repo",
        taskId: "task-1",
        role: "qa",
      }),
    ).toBe("workflow scope for task 'task-1' and role 'qa'");
  });

  test("accepts initial, unbound, and matching association transitions", () => {
    expect(resolveAgentSessionAssociationTransition(undefined, { kind: "unbound" })).toEqual({
      kind: "accepted",
      association: { kind: "unbound" },
    });
    expect(
      resolveAgentSessionAssociationTransition(
        { kind: "unbound" },
        { kind: "repository", workspaceId: "repo" },
      ),
    ).toEqual({ kind: "accepted", association: { kind: "repository", workspaceId: "repo" } });
    expect(
      resolveAgentSessionAssociationTransition(
        { kind: "workflow", workspaceId: "repo", taskId: "task-1", role: "build" },
        { kind: "workflow", workspaceId: "repo", taskId: "task-1", role: "build" },
      ),
    ).toEqual({
      kind: "accepted",
      association: { kind: "workflow", workspaceId: "repo", taskId: "task-1", role: "build" },
    });
  });

  test("retains a bound association when an observation is unbound", () => {
    expect(
      resolveAgentSessionAssociationTransition(
        { kind: "repository", workspaceId: "repo" },
        { kind: "unbound" },
      ),
    ).toEqual({ kind: "accepted", association: { kind: "repository", workspaceId: "repo" } });
  });

  test("reports conflicting bound associations without choosing one", () => {
    expect(
      resolveAgentSessionAssociationTransition(
        { kind: "workflow", workspaceId: "alpha", taskId: "same-id", role: "build" },
        { kind: "workflow", workspaceId: "beta", taskId: "same-id", role: "build" },
      ).kind,
    ).toBe("conflict");
    expect(
      resolveAgentSessionAssociationTransition(
        { kind: "repository", workspaceId: "alpha" },
        { kind: "repository", workspaceId: "beta" },
      ).kind,
    ).toBe("conflict");
    expect(
      resolveAgentSessionAssociationTransition(
        { kind: "workflow", workspaceId: "repo", taskId: "task-1", role: "build" },
        { kind: "repository", workspaceId: "repo" },
      ),
    ).toEqual({
      kind: "conflict",
      previous: { kind: "workflow", workspaceId: "repo", taskId: "task-1", role: "build" },
      incoming: { kind: "repository", workspaceId: "repo" },
    });
  });
});
