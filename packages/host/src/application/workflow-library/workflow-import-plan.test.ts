import { describe, expect, test } from "bun:test";
import type { WorkflowFile, WorkflowRoleInput } from "@openducktor/contracts";
import {
  BUILTIN_ROLES,
  BUILTIN_WORKFLOW_ID,
  newWorkflowDocument,
  roleFromInput,
  roleInputOf,
} from "@openducktor/workflows";
import {
  planWorkflowImport,
  previewWorkflowImport,
  type WorkflowImportHostState,
} from "./workflow-import-plan";

const designer = (instructions = "Design the screens."): WorkflowRoleInput => ({
  id: "designer",
  label: "Designer",
  tools: [],
  workspaceAccess: "read",
  runtimeScopes: ["workspace"],
  instructions,
});

const fileFixture = (id = "design-flow", roles = [designer()]): WorkflowFile => {
  const document = newWorkflowDocument(id, "Design flow");
  document.definition.roles = roles.map((role) => ({ id: role.id, writes: [] }));
  return {
    formatVersion: 1,
    workflow: document.definition,
    prompts: document.prompts,
    roles,
    layout: { states: { open: { x: 0, y: 0 } } },
  };
};

const hostState = (
  overrides: {
    customWorkflows?: [string, { hasDraft: boolean }][];
    deletedWorkflowIds?: string[];
    customRoles?: WorkflowRoleInput[];
  } = {},
): WorkflowImportHostState => ({
  builtinWorkflowId: BUILTIN_WORKFLOW_ID,
  customWorkflows: new Map(overrides.customWorkflows ?? []),
  deletedWorkflowIds: new Set(overrides.deletedWorkflowIds ?? []),
  roles: [
    ...BUILTIN_ROLES.map((role) => ({ role, source: "builtin" as const })),
    ...(overrides.customRoles ?? []).map((input) => ({
      role: roleFromInput(input),
      source: "custom" as const,
    })),
  ],
});

const planned = (result: ReturnType<typeof planWorkflowImport>) => {
  if (result.outcome === "rejected") throw new Error(result.message);
  return result.plan;
};

describe("previewWorkflowImport", () => {
  test("keeps a free workflow ID and creates unknown roles", () => {
    expect(previewWorkflowImport(fileFixture(), hostState())).toEqual({
      outcome: "ready",
      name: "Design flow",
      workflowId: "design-flow",
      match: "none",
      existingDraft: false,
      roles: [{ id: "designer", status: "create" }],
    });
  });

  test("reports a custom match with its draft, reused roles, and conflicts", () => {
    const builtinRole = roleInputOf(BUILTIN_ROLES[0]!);
    const preview = previewWorkflowImport(
      fileFixture("design-flow", [designer(), { ...builtinRole }]),
      hostState({
        customWorkflows: [["design-flow", { hasDraft: true }]],
        customRoles: [designer()],
      }),
    );
    expect(preview).toMatchObject({ match: "custom", existingDraft: true });
    expect(preview.roles).toEqual([
      { id: "designer", status: "reuse" },
      { id: builtinRole.id, status: "conflict" },
    ]);
  });

  test("reports a role with different content as a conflict", () => {
    const preview = previewWorkflowImport(
      fileFixture(),
      hostState({ customRoles: [designer("Other instructions.")] }),
    );
    expect(preview.roles).toEqual([{ id: "designer", status: "conflict" }]);
  });

  test("reports the built-in workflow ID", () => {
    expect(previewWorkflowImport(fileFixture(BUILTIN_WORKFLOW_ID), hostState()).match).toBe(
      "builtin",
    );
  });
});

describe("planWorkflowImport", () => {
  test("updates a custom workflow with the same ID and name", () => {
    const plan = planned(
      planWorkflowImport(
        fileFixture(),
        hostState({ customWorkflows: [["design-flow", { hasDraft: false }]] }),
        { target: "update", roleChoices: {} },
      ),
    );
    expect(plan.workflowId).toBe("design-flow");
    expect(plan.updatesExisting).toBe(true);
    expect(plan.document.definition.label).toBe("Design flow");
    expect(plan.newRoles.map(({ id }) => id)).toEqual(["designer"]);
  });

  test("imports a custom match as new with a new ID and a copy name", () => {
    const plan = planned(
      planWorkflowImport(
        fileFixture(),
        hostState({ customWorkflows: [["design-flow", { hasDraft: false }]] }),
        { target: "new", roleChoices: {} },
      ),
    );
    expect(plan.updatesExisting).toBe(false);
    expect(plan.workflowId).toBe("design-flow-copy");
    expect(plan.document.definition).toMatchObject({
      id: "design-flow-copy",
      label: "Design flow copy",
    });
  });

  test("gives the built-in workflow ID a new ID", () => {
    const plan = planned(
      planWorkflowImport(fileFixture(BUILTIN_WORKFLOW_ID), hostState(), {
        target: "new",
        roleChoices: {},
      }),
    );
    expect(plan.workflowId).not.toBe(BUILTIN_WORKFLOW_ID);
    expect(plan.document.definition.label).toBe("Design flow copy");
  });

  test("gives the ID of a deleted workflow a new ID and keeps the name", () => {
    const state = hostState({ deletedWorkflowIds: ["design-flow"] });
    const preview = previewWorkflowImport(fileFixture(), state);
    const plan = planned(
      planWorkflowImport(fileFixture(), state, { target: "new", roleChoices: {} }),
    );
    expect(preview).toMatchObject({ match: "none", workflowId: "design-flow-2" });
    expect(plan.workflowId).toBe("design-flow-2");
    expect(plan.document.definition).toMatchObject({ id: "design-flow-2", label: "Design flow" });
  });

  test("rejects an update without a custom workflow of that ID", () => {
    const result = planWorkflowImport(fileFixture(BUILTIN_WORKFLOW_ID), hostState(), {
      target: "update",
      roleChoices: {},
    });
    expect(result).toMatchObject({ outcome: "rejected" });
  });

  test("rejects a role conflict without a choice", () => {
    const result = planWorkflowImport(
      fileFixture(),
      hostState({ customRoles: [designer("Other instructions.")] }),
      { target: "new", roleChoices: {} },
    );
    expect(result.outcome).toBe("rejected");
    if (result.outcome === "rejected") expect(result.message).toContain('Role "designer"');
  });

  test("keeps the host role for the host choice", () => {
    const plan = planned(
      planWorkflowImport(fileFixture(), hostState({ customRoles: [designer("Other.")] }), {
        target: "new",
        roleChoices: { designer: "host" },
      }),
    );
    expect(plan.newRoles).toEqual([]);
    expect(plan.document.definition.roles.map(({ id }) => id)).toEqual(["designer"]);
  });

  test("creates the file role with a new ID and binds it for the new choice", () => {
    const plan = planned(
      planWorkflowImport(fileFixture(), hostState({ customRoles: [designer("Other.")] }), {
        target: "new",
        roleChoices: { designer: "new" },
      }),
    );
    expect(plan.newRoles.map(({ id, systemPrompt }) => [id, systemPrompt.template])).toEqual([
      ["designer_2", "Design the screens."],
    ]);
    expect(plan.document.definition.roles.map(({ id }) => id)).toEqual(["designer_2"]);
  });

  test("rejects a new role with a problem", () => {
    const result = planWorkflowImport(
      fileFixture("design-flow", [{ ...designer(), label: " " }]),
      hostState(),
      { target: "new", roleChoices: {} },
    );
    expect(result.outcome).toBe("rejected");
  });
});
