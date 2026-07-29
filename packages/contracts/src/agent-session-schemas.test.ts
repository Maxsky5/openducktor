import { describe, expect, test } from "bun:test";
import {
  agentSessionAssociationSchema,
  agentSessionScopeSchema,
  agentSessionWorkflowScopeSchema,
} from "./agent-session-schemas";

describe("agent session scope contracts", () => {
  test("keeps the workflow scope shape unchanged", () => {
    const workflowScope = { kind: "workflow", taskId: "task-1", role: "build" } as const;

    expect(agentSessionWorkflowScopeSchema.parse(workflowScope)).toEqual(workflowScope);
    expect(agentSessionScopeSchema.parse(workflowScope)).toEqual(workflowScope);
    expect(JSON.stringify(agentSessionScopeSchema.parse(workflowScope))).toBe(
      '{"kind":"workflow","taskId":"task-1","role":"build"}',
    );
  });

  test("accepts strict repository and unbound associations", () => {
    expect(agentSessionScopeSchema.parse({ kind: "repository" })).toEqual({
      kind: "repository",
    });
    expect(agentSessionAssociationSchema.parse({ kind: "unbound" })).toEqual({
      kind: "unbound",
    });
  });

  test("rejects invalid workflow field combinations", () => {
    expect(
      agentSessionScopeSchema.safeParse({
        kind: "workflow",
        taskId: " ",
        role: "build",
      }).success,
    ).toBe(false);
    expect(
      agentSessionScopeSchema.safeParse({
        kind: "workflow",
        taskId: "task-1",
      }).success,
    ).toBe(false);
  });

  test("rejects workflow fields on repository and unbound associations", () => {
    expect(
      agentSessionScopeSchema.safeParse({
        kind: "repository",
        taskId: "task-1",
      }).success,
    ).toBe(false);
    expect(
      agentSessionAssociationSchema.safeParse({
        kind: "unbound",
        role: "build",
      }).success,
    ).toBe(false);
  });

  test("does not allow unbound associations as startable scope", () => {
    expect(agentSessionScopeSchema.safeParse({ kind: "unbound" }).success).toBe(false);
  });
});
